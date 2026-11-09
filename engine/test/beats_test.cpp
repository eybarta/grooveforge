// Tempo and beats of a take with no click (gf/Beats.h through analyzeTake): synthetic Boom Bap, Trap, drifting and
// swung grooves with a known beat grid. Each must give the right tempo (±2 %, right octave from the mood's centre)
// and beats within ±25 ms of the true ones, none in the silence before the first hit.
#undef NDEBUG
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <vector>

#include "gf/Analysis.h"

namespace {
constexpr float kSr = 48000.f;

struct Rng {
  uint32_t s = 4242;
  float next() {
    s = s * 1664525u + 1013904223u;
    return static_cast<float>(s >> 8) / 8388608.f - 1.f;
  }
};

enum Sound { Kick, Snare, Hat };

/** Mouth-like hits: a kick is a falling low tone with a click, a snare a noise burst, a hat a short quiet hiss. */
void add(std::vector<float>& x, double t, Sound s, Rng& rng) {
  const int at = static_cast<int>(t * kSr), len = static_cast<int>((s == Kick ? 0.6 : s == Snare ? 0.25 : 0.08) * kSr);
  double phase = 0;
  for (int i = 0; i < len && at + i < static_cast<int>(x.size()); ++i) {
    const double u = i / kSr, attack = std::min(1.0, u / 0.001);
    float v = 0;
    if (s == Kick) {
      phase += 2 * M_PI * (55 + 90 * std::exp(-u / 0.03)) / kSr;
      v = static_cast<float>(0.8 * std::sin(phase) * std::exp(-u / 0.07) + 0.2 * rng.next() * std::exp(-u / 0.004));
    } else if (s == Snare) {
      v = static_cast<float>(0.5 * rng.next() * std::exp(-u / 0.03));
    } else {
      v = static_cast<float>(0.15 * rng.next() * std::exp(-u / 0.008));
    }
    x[at + i] += static_cast<float>(attack) * v;
  }
}

struct Groove {
  const char* name;
  double centreBpm, trueBpm;
  std::vector<double> beats;  // true beat times
};

/**
 * A groove of `bars` bars after `lead` s of silence: beat k at beatAt(k); within a beat, 16th s (0–3) sits at
 * s / 4 of the way to the next beat, except the off-8th (s = 2) at `swing`. `pattern(step)` picks the sounds per 16th.
 */
Groove make(const char* name, double centre, double bpm, int bars, double lead, double swing, const std::function<double(int)>& beatLen,
            const std::function<std::vector<Sound>(int)>& pattern, std::vector<float>& x) {
  Groove g{name, centre, bpm, {}};
  double t = lead;
  for (int k = 0; k <= bars * 4; ++k) g.beats.push_back(t), t += beatLen(k);
  x.assign(static_cast<size_t>((t + 1.0) * kSr), 0.f);
  Rng rng;
  for (int k = 0; k < bars * 4; ++k)
    for (int s = 0; s < 4; ++s) {
      const double frac = s == 2 ? swing : s / 4.0;
      for (Sound snd : pattern((k % 4) * 4 + s)) add(x, g.beats[k] + frac * (g.beats[k + 1] - g.beats[k]), snd, rng);
    }
  g.beats.pop_back();  // the beat after the last bar has no hits
  return g;
}

std::vector<Sound> boomBap(int step) {  // kick 1, 2-and-a… snare 2 and 4, hats on 8ths
  std::vector<Sound> s;
  if (step == 0 || step == 7 || step == 10) s.push_back(Kick);
  if (step == 4 || step == 12) s.push_back(Snare);
  if (step % 2 == 0) s.push_back(Hat);
  return s;
}

std::vector<Sound> trap(int step) {  // half-time: kick 1 and syncopated, snare on 3, hats on every 16th
  std::vector<Sound> s;
  if (step == 0 || step == 6 || step == 11) s.push_back(Kick);
  if (step == 8) s.push_back(Snare);
  s.push_back(Hat);
  return s;
}

void check(const Groove& g, const std::vector<float>& x) {
  gf::AnalysisOptions o;
  o.beatCentreBpm = g.centreBpm;
  const auto b = gf::analyzeTake(x.data(), static_cast<int>(x.size()), kSr, o).beats;
  int found = 0, extra = 0;
  double worst = 0;
  for (double t : g.beats) {
    double best = 1e9;
    for (double d : b.times) best = std::min(best, std::fabs(d - t));
    if (best <= 0.025) ++found, worst = std::max(worst, best);
  }
  for (double d : b.times) {
    double best = 1e9;
    for (double t : g.beats) best = std::min(best, std::fabs(d - t));
    if (best > 0.025) ++extra;
  }
  std::printf("%s: %.1f BPM (true %.1f); %d of %zu beats within 25 ms (worst %.1f ms), %d off the grid, first at %.2f s (hits from %.2f)\n",
              g.name, b.bpm, g.trueBpm, found, g.beats.size(), worst * 1000, extra, b.times.empty() ? -1 : b.times[0], g.beats[0]);
  assert(std::fabs(b.bpm / g.trueBpm - 1) < 0.02);
  assert(found >= 0.95 * g.beats.size());
  assert(extra <= 1);
  assert(!b.times.empty() && b.times[0] > g.beats[0] - 0.03);  // nothing in the silence before the first hit
}

}  // namespace

int main() {
  std::vector<float> x;
  check(make("boom bap 90", 90, 90, 8, 1.3, 0.5, [](int) { return 60 / 90.0; }, boomBap, x), x);
  check(make("boom bap 84, swung 62 %", 90, 84, 8, 0.6, 0.62, [](int) { return 60 / 84.0; }, boomBap, x), x);
  check(make("trap 140", 140, 140, 4, 0.8, 0.5, [](int) { return 60 / 140.0; }, trap, x), x);
  // drifting: 86 → 96 BPM across 8 bars (an untrained performer speeding up); the median spacing is ~91
  check(make("boom bap drifting 86→96", 90, 91, 8, 0.5, 0.5, [](int k) { return 60 / (86 + 10.0 * k / 32); }, boomBap, x), x);
  std::printf("beats_test: ok\n");
}
