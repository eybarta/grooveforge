// Take analysis: HPSS reconstructs exactly and separates tones from hits; onsets land within ±2 ms of synthetic hits;
// metronome tones in an ignored band don't count as hits.
#undef NDEBUG
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <vector>

#include "gf/Analysis.h"

namespace {
constexpr float kSr = 48000.f;

struct Rng {
  uint32_t s = 12345;
  float next() {  // white noise in [−1, 1]
    s = s * 1664525u + 1013904223u;
    return static_cast<float>(s >> 8) / 8388608.f - 1.f;
  }
};

/** A beatbox-like hit: a 40 ms burst of noise with a fast attack (1 ms) and exponential decay. */
void addHit(std::vector<float>& x, double t, float amp, Rng& rng) {
  const int at = static_cast<int>(t * kSr);
  for (int i = 0; i < static_cast<int>(0.04f * kSr) && at + i < static_cast<int>(x.size()); ++i) {
    const float env = std::min(1.f, i / (0.001f * kSr)) * std::exp(-i / (0.008f * kSr));
    x[at + i] += amp * env * rng.next();
  }
}

double energy(const std::vector<float>& v, int a, int b) {
  double e = 0;
  for (int i = a; i < b; ++i) e += double(v[i]) * v[i];
  return e;
}
}  // namespace

int main() {
  Rng rng;
  const int n = static_cast<int>(4 * kSr);

  // 1 · percussive + harmonic = the (normalised) input
  {
    std::vector<float> x(n);
    for (int i = 0; i < n; ++i) x[i] = 0.3f * std::sin(2 * M_PI * 220 * i / kSr) + 0.1f * rng.next();
    float peak = 0;
    for (float v : x) peak = std::max(peak, std::fabs(v));
    const auto a = gf::analyzeTake(x.data(), n, kSr);
    float err = 0;
    for (int i = 0; i < n; ++i) err = std::max(err, std::fabs(a.percussive[i] + a.harmonic[i] - x[i] * 0.708f / peak));
    std::printf("reconstruction: max error %.2e\n", err);
    assert(err < 1e-4f);
  }

  // 2 · a held tone goes to the harmonic part, short noise hits to the percussive part
  {
    std::vector<float> x(n);
    for (int i = 0; i < n; ++i) x[i] = 0.3f * std::sin(2 * M_PI * 110 * i / kSr);
    for (double t = 0.5; t < 3.6; t += 0.5) addHit(x, t, 0.8f, rng);
    const auto a = gf::analyzeTake(x.data(), n, kSr);
    // between hits (where only the tone sounds), the harmonic part holds nearly all the energy
    const int qa = static_cast<int>(0.7 * kSr), qb = static_cast<int>(0.95 * kSr);
    const double harmShare = energy(a.harmonic, qa, qb) / (energy(a.harmonic, qa, qb) + energy(a.percussive, qa, qb));
    // the percussive part is loud on a hit and quiet between hits (what onset detection needs): ≥ 30 dB apart,
    // per sample (the 2048-point window smears a hit, so the harmonic part keeps some of it: that's fine)
    const int ha = static_cast<int>(1.0 * kSr), hb = static_cast<int>(1.02 * kSr);
    const double onHit = energy(a.percussive, ha, hb) / (hb - ha), between = energy(a.percussive, qa, qb) / (qb - qa);
    const double contrastDb = 10 * std::log10(onHit / std::max(between, 1e-20));
    std::printf("separation: harmonic share between hits %.3f, percussive on-hit vs between %.1f dB\n", harmShare, contrastDb);
    assert(harmShare > 0.95 && contrastDb > 30);
  }

  // 3 · onsets within ±2 ms of each hit, including a fast pair 70 ms apart and quiet ones, on a noise floor
  {
    std::vector<float> x(n);
    for (int i = 0; i < n; ++i) x[i] = 0.002f * rng.next();
    const std::vector<double> times = {0.25, 0.6, 0.67, 1.1, 1.5, 1.9, 2.2, 2.6, 3.0, 3.4};
    for (size_t i = 0; i < times.size(); ++i) addHit(x, times[i], i % 3 == 2 ? 0.25f : 0.8f, rng);
    const auto a = gf::analyzeTake(x.data(), n, kSr);
    std::printf("onsets: %zu found for %zu hits\n", a.onsets.size(), times.size());
    assert(a.onsets.size() == times.size());
    double worst = 0;
    for (size_t i = 0; i < times.size(); ++i) worst = std::max(worst, std::fabs(a.onsets[i].time - times[i]));
    std::printf("onsets: worst timing error %.2f ms\n", worst * 1000);
    assert(worst <= 0.002);
  }

  // 4 · the metronome bleeding into the mic isn't counted, given what the engine played: the click as the engine
  //     makes it (src/song/metronome.ts on the sine voice: 1760 / 2637 Hz, 2 ms attack, −43 dB over 17 ms), heard
  //     through a coloured path (a short echo + a one-pole low-pass); one hit lands exactly on a click
  {
    std::vector<float> ref(n, 0.f), x(n);
    const int len = static_cast<int>(0.017 * kSr);
    for (double t = 0.25; t < 3.8; t += 0.5) {
      const double hz = std::fmod(t, 2.0) < 0.3 ? 2637 : 1760;
      for (int i = 0; i < len; ++i) {
        const float env = std::min(1.f, i / (0.002f * kSr)) * std::exp(-5.f * i / len);
        ref[static_cast<int>(t * kSr) + i] += 0.5f * env * std::sin(2 * M_PI * hz * i / kSr);
      }
    }
    float lp = 0;
    for (int i = 0; i < n; ++i) {
      lp += 0.6f * ((0.7f * ref[i] + (i >= 30 ? 0.3f * ref[i - 30] : 0.f)) - lp);
      x[i] = lp + 0.002f * rng.next();
    }
    addHit(x, 1.0, 0.8f, rng);
    addHit(x, 2.25, 0.8f, rng);  // on a click
    const auto heard = gf::analyzeTake(x.data(), n, kSr);
    gf::AnalysisOptions o;
    o.reference = ref.data();
    const auto a = gf::analyzeTake(x.data(), n, kSr, o);
    std::printf("metronome bleed: %zu onsets without the reference, %zu with it (2 hits)\n", heard.onsets.size(), a.onsets.size());
    assert(a.onsets.size() == 2 && std::fabs(a.onsets[0].time - 1.0) < 0.002 && std::fabs(a.onsets[1].time - 2.25) < 0.002);
  }
  std::printf("analysis_test: ok\n");
}
