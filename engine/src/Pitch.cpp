#include "gf/Pitch.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <limits>

#include "signalsmith-dsp/fft.h"

namespace gf {
namespace {

using cf = std::complex<float>;
constexpr int kW = 512;              // YIN integration window at the decimated rate (~43 ms)
constexpr int kFrame = 1024;         // samples per frame: window + longest period
constexpr int kFft = 2 * kFrame;     // zero-padded, so the correlation doesn't wrap
constexpr int kThresholds = 100;     // librosa.pyin defaults from here on
constexpr float kBoltzmann = 2.f, kNoTrough = 0.01f, kSwitch = 0.01f, kMaxOctPerSec = 35.92f;
constexpr int kBinsPerSemitone = 4;  // ¼ semitone (librosa's default is 1/10; notes only need semitones)

/** Beta(2, 18) CDF: for integer a, b it is a binomial tail, I_x(2, 18) = 1 − (1 − x)¹⁹ − 19x(1 − x)¹⁸. */
float beta218(float x) { return 1.f - std::pow(1.f - x, 19.f) - 19.f * x * std::pow(1.f - x, 18.f); }

/** Windowed-sinc low-pass (Hann, 63 taps) at 0.4 × the decimated rate, then every `d`th sample. */
std::vector<float> decimate(const float* x, int n, int d) {
  constexpr int kTaps = 63, kHalf = kTaps / 2;
  const float fc = 0.4f / d;  // cycles per input sample
  float h[kTaps], sum = 0;
  for (int i = 0; i < kTaps; ++i) {
    const float k = static_cast<float>(i - kHalf);
    const float sinc = k == 0 ? 2 * fc : std::sin(2 * static_cast<float>(M_PI) * fc * k) / (static_cast<float>(M_PI) * k);
    sum += h[i] = sinc * (0.5f - 0.5f * std::cos(2 * static_cast<float>(M_PI) * i / (kTaps - 1)));
  }
  std::vector<float> y(n / d + 1);
  for (size_t m = 0; m < y.size(); ++m) {
    float acc = 0;
    const int c = static_cast<int>(m) * d;
    for (int i = 0; i < kTaps; ++i) {
      const int j = c + i - kHalf;
      if (j >= 0 && j < n) acc += h[i] * x[j];
    }
    y[m] = acc / sum;
  }
  return y;
}

}  // namespace

std::vector<float> pyin(const float* x, int n, float sampleRate) {
  const int frames = n / kPitchHop + 1;
  std::vector<float> f0(frames, 0.f);
  if (n <= 0) return f0;
  const int d = std::max(1, static_cast<int>(std::lround(sampleRate / 12000.f)));
  const float sr = sampleRate / d;
  const int hop = kPitchHop / d;
  const auto y = decimate(x, n, d);
  const int ny = static_cast<int>(y.size());
  const int minP = static_cast<int>(std::floor(sr / kPitchMaxHz));
  const int maxP = std::min(static_cast<int>(std::ceil(sr / kPitchMinHz)), kFrame - kW - 1);
  const int bins = static_cast<int>(std::floor(12 * kBinsPerSemitone * std::log2(kPitchMaxHz / kPitchMinHz))) + 1;

  float betaProb[kThresholds];
  for (int t = 0; t < kThresholds; ++t) betaProb[t] = beta218((t + 1.f) / kThresholds) - beta218(static_cast<float>(t) / kThresholds);

  // observation probabilities: voiced pitch bins [0, bins), plus how likely the frame is voiced at all
  std::vector<float> obs(static_cast<size_t>(frames) * bins, 0.f), voiced(frames, 0.f);
  signalsmith::fft::RealFFT<float> fft(kFft);
  std::vector<float> buf(kFft), corr(kFft), cmnd(maxP + 2), energy(kFrame + 1);
  std::vector<cf> A(kFft / 2), B(kFft / 2);
  std::vector<int> troughs;
  std::vector<float> prob;
  for (int f = 0; f < frames; ++f) {
    const int start = f * hop - kFrame / 2;
    auto at = [&](int i) { const int j = start + i; return j >= 0 && j < ny ? y[j] : 0.f; };
    // difference d(τ) = Σ_{j<W} (x_j − x_{j+τ})² = e(0) + e(τ) − 2 r(τ), with r by FFT cross-correlation
    for (int i = 0; i < kFft; ++i) buf[i] = i < kFrame ? at(i) : 0.f;
    fft.fft(buf.data(), A.data());
    for (int i = 0; i < kFft; ++i) buf[i] = i < kW ? at(i) : 0.f;
    fft.fft(buf.data(), B.data());
    // DC and Nyquist are packed in bin 0's real and imaginary parts
    const cf dcNy{A[0].real() * B[0].real(), A[0].imag() * B[0].imag()};
    for (int k = 0; k < kFft / 2; ++k) A[k] *= std::conj(B[k]);
    A[0] = dcNy;
    fft.ifft(A.data(), corr.data());
    energy[0] = 0;
    for (int i = 0; i < kFrame; ++i) energy[i + 1] = energy[i] + at(i) * at(i);
    auto e = [&](int tau) { return energy[tau + kW] - energy[tau]; };
    if (e(0) < 1e-9f) continue;  // silence: unvoiced
    cmnd[0] = 1.f;
    double run = 0;
    for (int tau = 1; tau <= maxP; ++tau) {
      const float dt = std::max(0.f, e(0) + e(tau) - 2.f * corr[tau] / kFft);  // ifft gain is N
      run += dt;
      cmnd[tau] = run > 0 ? static_cast<float>(dt * tau / run) : 1.f;
    }
    // troughs (local minima) in [minP, maxP]
    troughs.clear();
    for (int tau = minP; tau <= maxP; ++tau) {
      const bool left = tau == minP || cmnd[tau] < cmnd[tau - 1];
      const bool right = tau == maxP || cmnd[tau] <= cmnd[tau + 1];
      if (left && right) troughs.push_back(tau);
    }
    if (troughs.empty()) continue;
    // per threshold: probability on each trough below it, earlier (shorter period) troughs favoured (Boltzmann)
    prob.assign(troughs.size(), 0.f);
    int globalMin = 0;
    for (size_t k = 1; k < troughs.size(); ++k) if (cmnd[troughs[k]] < cmnd[troughs[globalMin]]) globalMin = static_cast<int>(k);
    float belowMin = 0;
    for (int t = 0; t < kThresholds; ++t) {
      const float thr = (t + 1.f) / kThresholds;
      int below = 0;
      for (int tau : troughs) below += cmnd[tau] < thr;
      if (!below) { belowMin += betaProb[t]; continue; }
      const float norm = (1 - std::exp(-kBoltzmann)) / (1 - std::exp(-kBoltzmann * below));
      int rank = 0;
      for (size_t k = 0; k < troughs.size(); ++k) {
        if (cmnd[troughs[k]] >= thr) continue;
        prob[k] += betaProb[t] * norm * std::exp(-kBoltzmann * rank++);
      }
    }
    prob[globalMin] += kNoTrough * belowMin;
    float sum = 0;
    for (size_t k = 0; k < troughs.size(); ++k) {
      if (prob[k] <= 0) continue;
      // parabolic interpolation of the trough, then its pitch bin
      const int tau = troughs[k];
      float shift = 0;
      if (tau > 1 && tau < maxP) {
        const float a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1], den = a - 2 * b + c;
        if (std::fabs(den) > 1e-9f) shift = std::clamp(0.5f * (a - c) / den, -1.f, 1.f);
      }
      const float hz = sr / (tau + shift);
      const int bin = std::clamp(static_cast<int>(std::lround(12 * kBinsPerSemitone * std::log2(hz / kPitchMinHz))), 0, bins - 1);
      obs[static_cast<size_t>(f) * bins + bin] = prob[k];
      sum += prob[k];
    }
    voiced[f] = std::min(1.f, sum);
  }

  // Viterbi over 2 × bins states (voiced pitch, unvoiced "pitch"): pitch moves at most kMaxOctPerSec (triangular),
  // voicing switches with probability kSwitch. Log domain.
  const int maxStep = static_cast<int>(std::lround(kMaxOctPerSec * 12 * kPitchHop / sampleRate));
  const int half = maxStep * kBinsPerSemitone;  // transition width 2·half + 1, as librosa's transition_local
  std::vector<float> tri(2 * half + 1), logTri(2 * half + 1);
  for (int k = -half; k <= half; ++k) logTri[k + half] = std::log(tri[k + half] = 1.f - std::fabs(static_cast<float>(k)) / (half + 1));
  std::vector<float> rowNorm(bins);  // the triangle cut at the edges, renormalised per source row
  for (int i = 0; i < bins; ++i) {
    float s = 0;
    for (int k = -half; k <= half; ++k) if (i + k >= 0 && i + k < bins) s += tri[k + half];
    rowNorm[i] = std::log(s);
  }
  const int S = 2 * bins;
  constexpr float kNeg = -std::numeric_limits<float>::infinity();
  std::vector<float> cost(S), next(S);
  std::vector<int> back(static_cast<size_t>(frames) * S);
  auto logObs = [&](int f, int s) {
    const float p = s < bins ? obs[static_cast<size_t>(f) * bins + s] : (1 - voiced[f]) / bins;
    return p > 0 ? std::log(p) : -1e4f;
  };
  for (int s = 0; s < S; ++s) cost[s] = (s < bins ? kNeg : std::log(1.f / bins)) + logObs(0, s);
  const float stay = std::log(1 - kSwitch), swap = std::log(kSwitch);
  for (int f = 1; f < frames; ++f) {
    for (int s = 0; s < S; ++s) {
      const int b = s % bins, v = s / bins;
      float best = kNeg;
      int arg = s;
      for (int k = -half; k <= half; ++k) {
        const int src = b - k;  // source bin: moves to b by +k
        if (src < 0 || src >= bins) continue;
        const float tr = logTri[k + half] - rowNorm[src];
        for (int sv = 0; sv < 2; ++sv) {
          const int from = sv * bins + src;
          const float c = cost[from] + tr + (sv == v ? stay : swap);
          if (c > best) best = c, arg = from;
        }
      }
      next[s] = best + logObs(f, s);
      back[static_cast<size_t>(f) * S + s] = arg;
    }
    std::swap(cost, next);
  }
  int s = static_cast<int>(std::max_element(cost.begin(), cost.end()) - cost.begin());
  for (int f = frames - 1; f >= 0; --f) {
    if (s < bins) f0[f] = kPitchMinHz * std::pow(2.f, s / (12.f * kBinsPerSemitone));
    if (f > 0) s = back[static_cast<size_t>(f) * S + s];
  }
  return f0;
}

}  // namespace gf
