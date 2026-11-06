#include "gf/Loudness.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "ebur128.h"

namespace gf {

Loudness measureLoudness(const float* l, const float* r, int frames, float sampleRate) {
  Loudness out{-HUGE_VAL, -HUGE_VAL};
  ebur128_state* st = ebur128_init(2, static_cast<unsigned long>(sampleRate), EBUR128_MODE_I | EBUR128_MODE_TRUE_PEAK);
  if (!st) return out;
  constexpr int kChunk = 4096;
  std::vector<float> interleaved(2 * kChunk);
  for (int done = 0; done < frames; done += kChunk) {
    const int n = std::min(kChunk, frames - done);
    for (int i = 0; i < n; ++i) {
      interleaved[2 * i] = l[done + i];
      interleaved[2 * i + 1] = r[done + i];
    }
    ebur128_add_frames_float(st, interleaved.data(), static_cast<size_t>(n));
  }
  ebur128_loudness_global(st, &out.lufs);
  double peak = 0, p;
  for (unsigned c = 0; c < 2; ++c)
    if (ebur128_true_peak(st, c, &p) == EBUR128_SUCCESS) peak = std::max(peak, p);
  out.truePeakDb = peak > 0 ? 20 * std::log10(peak) : -HUGE_VAL;
  ebur128_destroy(&st);
  return out;
}

}  // namespace gf
