#include "gf/Analysis.h"
#include "gf/Pitch.h"

#include <algorithm>
#include <cmath>
#include <complex>

#include "signalsmith-dsp/fft.h"

namespace gf {
namespace {

using cf = std::complex<float>;
constexpr int N = kStftSize, HOP = kStftHop, BINS = N / 2 + 1;
constexpr int kMedian = 17;          // HPSS median kernels: 17 frames (~90 ms) across time, 17 bins (~400 Hz) across frequency
constexpr float kInt16 = 32768.f;    // SuperFlux's thresholds are for int16-scaled audio (as madmom reads WAVs)
constexpr float kGateDb = 35.f;      // a hit's percussive energy is within this of the take's loudest frame (room noise isn't)

struct Stft {
  int frames = 0;
  std::vector<cf> X;  // frame-major, BINS per frame
  cf* frame(int f) { return X.data() + static_cast<size_t>(f) * BINS; }
  const cf* frame(int f) const { return X.data() + static_cast<size_t>(f) * BINS; }
};

std::vector<float> hann() {
  std::vector<float> w(N);
  for (int i = 0; i < N; ++i) w[i] = 0.5f - 0.5f * std::cos(2.f * static_cast<float>(M_PI) * i / N);
  return w;
}

/** Centred frames: frame f covers samples [f·HOP − N/2, f·HOP + N/2). */
Stft stft(const float* x, int n, const std::vector<float>& w, signalsmith::fft::RealFFT<float>& fft) {
  Stft s;
  s.frames = n / HOP + 1;
  s.X.resize(static_cast<size_t>(s.frames) * BINS);
  std::vector<float> buf(N);
  std::vector<cf> out(N / 2);
  for (int f = 0; f < s.frames; ++f) {
    const int start = f * HOP - N / 2;
    for (int i = 0; i < N; ++i) {
      const int j = start + i;
      buf[i] = j >= 0 && j < n ? x[j] * w[i] : 0.f;
    }
    fft.fft(buf.data(), out.data());
    cf* X = s.frame(f);
    X[0] = {out[0].real(), 0.f};      // the real FFT packs DC and Nyquist into bin 0
    X[N / 2] = {out[0].imag(), 0.f};
    std::copy(out.begin() + 1, out.end(), X + 1);
  }
  return s;
}

/**
 * Weighted overlap-add (the same Hann for synthesis), normalised by Σw², so istft(stft(x)) = x. With `mask`, each bin
 * is scaled by mask (or 1 − mask when `invert`) on the way, so a masked spectrogram needn't be stored.
 */
std::vector<float> istft(const Stft& s, int n, const std::vector<float>& w, signalsmith::fft::RealFFT<float>& fft,
                         const std::vector<float>* mask = nullptr, bool invert = false) {
  std::vector<float> y(n, 0.f), norm(n, 0.f), buf(N);
  std::vector<cf> in(N / 2);
  std::vector<cf> frame(BINS);
  for (int f = 0; f < s.frames; ++f) {
    const cf* X = s.frame(f);
    if (mask) {
      const float* m = mask->data() + static_cast<size_t>(f) * BINS;
      for (int k = 0; k < BINS; ++k) frame[k] = X[k] * (invert ? 1.f - m[k] : m[k]);
      X = frame.data();
    }
    in[0] = {X[0].real(), X[N / 2].real()};
    std::copy(X + 1, X + N / 2, in.begin() + 1);
    fft.ifft(in.data(), buf.data());
    const int start = f * HOP - N / 2;
    for (int i = 0; i < N; ++i) {
      const int j = start + i;
      if (j < 0 || j >= n) continue;
      y[j] += buf[i] * w[i];
      norm[j] += w[i] * w[i];
    }
  }
  for (int j = 0; j < n; ++j) y[j] = norm[j] > 1e-6f ? y[j] / (norm[j] * N) : 0.f;  // N: the FFT round trip's gain
  return y;
}

/** Soft percussive mask P²/(P²+H²), from medians across frequency (P) and across time (H) of the magnitudes. */
std::vector<float> percussiveMask(const Stft& s) {
  const int F = s.frames, h = kMedian / 2;
  std::vector<float> mag(static_cast<size_t>(F) * BINS), mask(mag.size());
  for (size_t i = 0; i < mag.size(); ++i) mag[i] = std::abs(s.X[i]);
  std::vector<float> win(kMedian);
  auto median = [&](int count) {
    std::nth_element(win.begin(), win.begin() + count / 2, win.begin() + count);
    return win[count / 2];
  };
  for (int f = 0; f < F; ++f) {
    for (int k = 0; k < BINS; ++k) {
      int c = 0;
      for (int d = -h; d <= h; ++d) win[c++] = mag[static_cast<size_t>(std::clamp(f + d, 0, F - 1)) * BINS + k];
      const float H = median(c);
      c = 0;
      for (int d = -h; d <= h; ++d) win[c++] = mag[static_cast<size_t>(f) * BINS + std::clamp(k + d, 0, BINS - 1)];
      const float P = median(c);
      mask[static_cast<size_t>(f) * BINS + k] = P * P + H * H > 1e-20f ? (P * P) / (P * P + H * H) : 0.5f;
    }
  }
  return mask;
}

/** SuperFlux's filterbank: triangular, 24 bands per octave from 30 Hz to 17 kHz, each normalised to sum 1. */
struct Band {
  int lo;
  std::vector<float> w;
  float hz;
};
std::vector<Band> logBands(float sr) {
  const float binHz = sr / N;
  std::vector<int> centres;
  for (float f = 30.f; f <= std::min(17000.f, sr / 2); f *= std::pow(2.f, 1.f / 24)) {
    const int b = static_cast<int>(std::lround(f / binHz));
    if (centres.empty() || b > centres.back()) centres.push_back(b);
  }
  std::vector<Band> bands;
  for (size_t i = 1; i + 1 < centres.size(); ++i) {
    const int lo = centres[i - 1], mid = centres[i], hi = centres[i + 1];
    Band b{lo, {}, mid * binHz};
    for (int k = lo; k <= hi; ++k) b.w.push_back(k <= mid ? (mid == lo ? 1.f : float(k - lo) / (mid - lo)) : float(hi - k) / (hi - mid));
    float sum = 0;
    for (float v : b.w) sum += v;
    for (float& v : b.w) v /= sum;
    bands.push_back(std::move(b));
  }
  return bands;
}

std::vector<float> superFlux(const Stft& p, float sr) {
  const auto bands = logBands(sr);
  const int F = p.frames, B = static_cast<int>(bands.size()), mu = 2;  // μ: where the 2048-Hann drops below half, in hops
  std::vector<float> S(static_cast<size_t>(F) * B);
  for (int f = 0; f < F; ++f) {
    const cf* X = p.frame(f);
    for (int b = 0; b < B; ++b) {
      float e = 0;
      for (size_t k = 0; k < bands[b].w.size(); ++k) e += bands[b].w[k] * std::abs(X[bands[b].lo + k]);
      S[static_cast<size_t>(f) * B + b] = std::log10(1.f + kInt16 * e);
    }
  }
  std::vector<float> flux(F, 0.f);
  for (int f = mu; f < F; ++f) {
    const float* now = &S[static_cast<size_t>(f) * B];
    const float* before = &S[static_cast<size_t>(f - mu) * B];
    float sum = 0;
    for (int b = 0; b < B; ++b) {
      const float mx = std::max({before[std::max(b - 1, 0)], before[b], before[std::min(b + 1, B - 1)]});  // max filter
      sum += std::max(0.f, now[b] - mx);
    }
    flux[f] = sum;
  }
  return flux;
}

/** Percussive energy per frame (for the level gate). */
std::vector<float> frameEnergy(const Stft& p) {
  std::vector<float> e(p.frames, 0.f);
  for (int f = 0; f < p.frames; ++f) {
    const cf* X = p.frame(f);
    for (int k = 0; k < BINS; ++k) e[f] += std::norm(X[k]);
  }
  return e;
}

/**
 * madmom's SuperFlux peak picking (offline): local max over [−10, +30] ms, ≥ mean over the last 150 ms + 1.1,
 * ≥ 30 ms apart; plus a level gate (kGateDb), since the fixed threshold assumes a silent background.
 */
std::vector<int> pickPeaks(const std::vector<float>& flux, const std::vector<float>& energy, float sr) {
  const float fps = sr / HOP;
  // post-max 30 ms, not madmom's 50: a 1/32 hat roll at 140 BPM is 54 ms apart and gets louder, and each hit
  // would otherwise swallow the one before it
  const int preMax = static_cast<int>(std::lround(0.01f * fps)), postMax = static_cast<int>(std::lround(0.03f * fps));
  const int preAvg = static_cast<int>(std::lround(0.15f * fps));
  const int combine = static_cast<int>(std::lround(0.03f * fps));
  const float threshold = 1.1f;
  const int F = static_cast<int>(flux.size());
  const float gate = *std::max_element(energy.begin(), energy.end()) * std::pow(10.f, -kGateDb / 10);
  std::vector<int> peaks;
  for (int f = 0; f < F; ++f) {
    float mx = 0, avg = 0;
    for (int d = -preMax; d <= postMax; ++d) mx = std::max(mx, flux[std::clamp(f + d, 0, F - 1)]);
    for (int d = -preAvg; d <= 0; ++d) avg += flux[std::clamp(f + d, 0, F - 1)];
    avg /= preAvg + 1;
    if (flux[f] <= 0 || flux[f] < mx || flux[f] < avg + threshold || energy[f] < gate) continue;
    if (!peaks.empty() && f - peaks.back() <= combine) continue;
    peaks.push_back(f);
  }
  // and a relative floor: a hit reaches 10 % of the take's strong ones (90th percentile); flickers in a hum or the
  // room's noise don't (measured: real hits ≥ 23, such flickers 4–5 on the golden takes)
  if (peaks.size() >= 4) {
    std::vector<float> heights;
    for (int f : peaks) heights.push_back(flux[f]);
    std::nth_element(heights.begin(), heights.begin() + heights.size() * 9 / 10, heights.end());
    const float floor = 0.1f * heights[heights.size() * 9 / 10];
    std::erase_if(peaks, [&](int f) { return flux[f] < floor; });
  }
  return peaks;
}

/** The attack on the waveform near a detected frame: back from the loudest point to where it was 15 % as loud. */
int refine(const std::vector<float>& env, int centre, int floor, float sr) {
  const int n = static_cast<int>(env.size());
  const int a = std::max(floor, centre - static_cast<int>(0.03f * sr)), b = std::min(n - 1, centre + static_cast<int>(0.02f * sr));
  if (a >= b) return std::clamp(centre, 0, n - 1);
  int peak = a;
  for (int i = a; i <= b; ++i) if (env[i] > env[peak]) peak = i;
  int i = peak;
  while (i > a && env[i - 1] > 0.15f * env[peak]) --i;
  return i;
}

/**
 * Spectral subtraction of the engine's own output (the metronome bleeding into the mic): per bin, the least-squares
 * gain from the reference's magnitude to the take's, over the frames where the reference sounds; then each bin keeps
 * max(0, 1 − 1.5·g·|R|/|X|) of itself (1.5: over-subtract a little; phase kept).
 */
void removeReference(Stft& x, const float* ref, int n, float takeGain, const std::vector<float>& w,
                     signalsmith::fft::RealFFT<float>& fft) {
  std::vector<double> xr(BINS, 0.0), rr(BINS, 0.0);
  std::vector<float> buf(N);
  std::vector<cf> out(N / 2), R(BINS);
  auto refFrame = [&](int f) {  // the reference's spectrum at frame f, computed on demand (no stored spectrogram)
    const int start = f * HOP - N / 2;
    for (int i = 0; i < N; ++i) {
      const int j = start + i;
      buf[i] = j >= 0 && j < n ? ref[j] * w[i] : 0.f;
    }
    fft.fft(buf.data(), out.data());
    R[0] = {out[0].real(), 0.f};
    R[N / 2] = {out[0].imag(), 0.f};
    std::copy(out.begin() + 1, out.end(), R.begin() + 1);
  };
  float rmax = 0;
  for (int f = 0; f < x.frames; ++f) {
    refFrame(f);
    for (const cf& v : R) rmax = std::max(rmax, std::abs(v));
  }
  if (rmax <= 0) return;
  for (int f = 0; f < x.frames; ++f) {
    const cf* X = x.frame(f);
    refFrame(f);
    for (int k = 0; k < BINS; ++k) {
      const float a = std::abs(R[k]) * takeGain;  // the take was normalised: put the reference on the same scale
      if (a < 1e-3f * rmax * takeGain) continue;
      xr[k] += double(std::abs(X[k])) * a;
      rr[k] += double(a) * a;
    }
  }
  for (int f = 0; f < x.frames; ++f) {
    cf* X = x.frame(f);
    refFrame(f);
    for (int k = 0; k < BINS; ++k) {
      if (rr[k] <= 0) continue;
      const float g = static_cast<float>(xr[k] / rr[k]);
      const float m = std::abs(X[k]);
      if (m > 0) X[k] *= std::max(0.f, 1.f - 1.5f * g * std::abs(R[k]) * takeGain / m);
    }
  }
}

/** The hit's sound (gf::kHitFeatures, see Analysis.h), from `x` (the normalised take) at sample `at`, up to `end`. */
void hitFeatures(const std::vector<float>& x, int at, int end, float sr, float* out) {
  constexpr int M = 1024, H = 256, MEL = 40, CEPS = 13;
  static thread_local signalsmith::fft::RealFFT<float> fft(M);
  static thread_local std::vector<float> win = [] {
    std::vector<float> w(M);
    for (int i = 0; i < M; ++i) w[i] = 0.5f - 0.5f * std::cos(2.f * static_cast<float>(M_PI) * i / M);
    return w;
  }();
  const int n = static_cast<int>(x.size());
  const float binHz = sr / M;
  // every spectral feature looks at 30 Hz–16 kHz: what's above depends on the sample rate and the mic (an upsampled
  // 44.1 kHz recording is empty from 22 kHz up, which moved the flatness by ~0.65 std on the AVP takes)
  const float topHz = std::min(16000.f, sr / 2);
  const int top = std::min(M / 2, static_cast<int>(topHz / binHz) + 1);
  auto mel = [](float hz) { return 2595.f * std::log10(1.f + hz / 700.f); };
  const float m0 = mel(30.f), m1 = mel(topHz);
  std::vector<float> edges(MEL + 2);
  for (int i = 0; i < MEL + 2; ++i) edges[i] = 700.f * (std::pow(10.f, (m0 + (m1 - m0) * i / (MEL + 1)) / 2595.f) - 1.f);

  const int len = std::max(H, std::min(static_cast<int>(0.06f * sr), end - at));  // 60 ms, or up to the next hit
  const int frames = std::max(1, (len - M / 2) / H + 1);
  std::vector<float> melAcc(MEL, 0.f), power(M / 2 + 1, 0.f), buf(M);
  std::vector<std::complex<float>> spec(M / 2);
  for (int f = 0; f < frames; ++f) {
    const int start = at + f * H - M / 4;  // the first frame sits mostly on the attack
    for (int i = 0; i < M; ++i) {
      const int j = start + i;
      buf[i] = j >= at && j < std::min(n, at + len) ? x[j] * win[i] : 0.f;
    }
    fft.fft(buf.data(), spec.data());
    for (int k = 1; k < M / 2; ++k) power[k] += std::norm(spec[k]);
  }
  float total = 0, centroid = 0, logSum = 0, low = 0, high = 0;
  int bins = 0;
  for (int k = 1; k < top; ++k) {
    const float hz = k * binHz, p = power[k] + 1e-12f;
    total += p;
    centroid += p * hz;
    logSum += std::log(p);
    ++bins;
    if (hz < 300) low += p;
    if (hz > 3000) high += p;
    for (int b = 0; b < MEL; ++b) {  // triangular mel bands
      if (hz <= edges[b] || hz >= edges[b + 2]) continue;
      melAcc[b] += p * (hz < edges[b + 1] ? (hz - edges[b]) / (edges[b + 1] - edges[b]) : (edges[b + 2] - hz) / (edges[b + 2] - edges[b + 1]));
    }
  }
  for (float& m : melAcc) m = std::log(m / frames + 1e-10f);
  for (int c = 0; c < CEPS; ++c) {  // DCT-II
    float sum = 0;
    for (int b = 0; b < MEL; ++b) sum += melAcc[b] * std::cos(static_cast<float>(M_PI) * c * (b + 0.5f) / MEL);
    out[c] = sum / MEL;
  }
  out[13] = std::log2(centroid / total + 1.f);
  out[14] = std::exp(logSum / bins) / (total / bins);  // flatness: geometric / arithmetic mean of the power
  auto energy = [&](float a, float b) {
    double e = 0;
    for (int i = at + static_cast<int>(a * sr); i < std::min({n, end, at + static_cast<int>(b * sr)}); ++i) e += double(x[i]) * x[i];
    return e;
  };
  out[15] = static_cast<float>(std::log10((energy(0.02f, 0.08f) + 1e-9) / (energy(0.f, 0.02f) + 1e-9)));
  int crossings = 0;
  const int zEnd = std::min({n - 1, end, at + static_cast<int>(0.03f * sr)});
  for (int i = at; i < zEnd; ++i) crossings += (x[i] >= 0) != (x[i + 1] >= 0);
  out[16] = crossings / std::max(1.f, (zEnd - at) / (0.001f * sr));
  out[17] = std::log10((low + 1e-9f) / (high + 1e-9f));
}

}  // namespace

TakeAnalysis analyzeTake(const float* x, int n, float sampleRate, const AnalysisOptions& options) {
  TakeAnalysis out;
  if (n <= 0) return out;
  float peak = 0;
  for (int i = 0; i < n; ++i) peak = std::max(peak, std::fabs(x[i]));
  const float gain = peak > 0 ? 0.708f / peak : 1.f;  // −3 dBFS
  std::vector<float> in(x, x + n);
  for (float& v : in) v *= gain;

  const auto w = hann();
  signalsmith::fft::RealFFT<float> fft(N);
  Stft s = stft(in.data(), n, w, fft);
  if (options.reference) removeReference(s, options.reference, n, gain, w, fft);
  // onsets from the whole spectrogram, as SuperFlux is designed: a kick's low tone lasts ~100 ms, and HPSS calls
  // much of it harmonic, so the percussive part alone hears the kick late or not at all (measured on the golden takes)
  const auto flux = superFlux(s, sampleRate);
  const auto energy = frameEnergy(s);
  const auto mask = percussiveMask(s);
  out.harmonic = istft(s, n, w, fft, &mask, true);
  Stft& p = s;  // from here on the spectrogram is the percussive one (one spectrogram in memory, not three)
  for (size_t i = 0; i < s.X.size(); ++i) p.X[i] *= mask[i];
  out.percussive = istft(p, n, w, fft);

  // attack envelope: |percussive| with a 2 ms release, instant rise
  std::vector<float> env(n);
  const float rel = std::exp(-1.f / (0.002f * sampleRate));
  float e = 0;
  for (int i = 0; i < n; ++i) env[i] = e = std::max(std::fabs(out.percussive[i]), e * rel);

  int last = 0;
  for (int f : pickPeaks(flux, energy, sampleRate)) {
    const int at = refine(env, f * HOP, last, sampleRate);
    out.onsets.push_back({at / static_cast<double>(sampleRate), flux[f], {}});
    last = at + static_cast<int>(0.005f * sampleRate);
  }
  for (size_t i = 0; i < out.onsets.size(); ++i) {
    const int at = static_cast<int>(out.onsets[i].time * sampleRate);
    const int end = i + 1 < out.onsets.size() ? static_cast<int>(out.onsets[i + 1].time * sampleRate) : n;
    hitFeatures(out.percussive, at, end, sampleRate, out.onsets[i].features);
  }
  out.f0 = pyin(out.harmonic.data(), n, sampleRate);
  // tempo from every hit (trap's dense hats are its grid), beats where the loud ones are (√ frame energy): SuperFlux's
  // log bands make a quiet broadband "ts" as strong as a kick, which put a swung groove's beats on its off-beat hats
  std::vector<float> loud(flux.size());
  const float maxEnergy = std::max(1e-20f, *std::max_element(energy.begin(), energy.end()));
  for (size_t f = 0; f < flux.size(); ++f) loud[f] = std::sqrt(energy[f] / maxEnergy);
  std::vector<double> hitTimes;
  for (const auto& o : out.onsets) hitTimes.push_back(o.time);
  out.beats = trackBeats(flux, sampleRate / HOP, options.beatCentreBpm, hitTimes, loud);
  return out;
}

}  // namespace gf
