#pragma once
// Shared by the host tests.
#undef NDEBUG  // the checks are asserts; keep them in every build type
#include <algorithm>
#include <cassert>
#include <cmath>
#include <vector>

#include "gf/Engine.h"

namespace {
constexpr float kSr = 48000.f;
constexpr int64_t kLoop = 256000;  // 2 bars at 90 BPM

struct Stereo {
  std::vector<float> l, r;
};

Stereo render(gf::Engine& e, int frames, const float* in = nullptr, int block = 128) {
  Stereo o{std::vector<float>(frames), std::vector<float>(frames)};
  for (int i = 0; i < frames; i += block) {
    const int n = std::min(block, frames - i);
    e.process(in ? in + i : nullptr, o.l.data() + i, o.r.data() + i, n);
  }
  return o;
}

float peak(const std::vector<float>& v, size_t a, size_t b) {
  float p = 0;
  for (size_t i = a; i < b; ++i) p = std::max(p, std::fabs(v[i]));
  return p;
}

}  // namespace
