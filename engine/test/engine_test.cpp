// Host-side checks for gf::Engine. Run: cmake -S engine -B engine/build && cmake --build engine/build && ctest --test-dir engine/build
#undef NDEBUG  // the checks below are asserts; keep them in every build type
#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

#include "gf/Engine.h"

namespace {
constexpr float kSr = 48000.f;
constexpr int64_t kLoop = 256000;  // 2 bars at 90 BPM

std::vector<float> render(gf::Engine& e, int frames, const float* in = nullptr) {
  std::vector<float> out(frames);
  for (int i = 0; i < frames; i += 128) e.process(in ? in + i : nullptr, out.data() + i, std::min(128, frames - i));
  return out;
}

float peak(const std::vector<float>& v, size_t a, size_t b) {
  float p = 0;
  for (size_t i = a; i < b; ++i) p = std::max(p, std::fabs(v[i]));
  return p;
}
}  // namespace

int main() {
  // the spike loop (src/audio/spikeSongs.ts loopSong): a 55 Hz boop on every beat + a 2.4 kHz hat on each off-beat 8th
  std::vector<float> ev;
  for (int b = 0; b < 8; ++b) {
    ev.insert(ev.end(), {b * 32000.f, 55.f, 0.8f, 12000.f});
    ev.insert(ev.end(), {b * 32000.f + 16000.f, 2400.f, 0.5f, 1920.f});
  }
  const int rows = static_cast<int>(ev.size() / gf::kEventStride);

  gf::Engine e(kSr);
  assert(e.setEvents(ev.data(), rows, kLoop));
  e.play();
  assert(!e.setEvents(ev.data(), rows, kLoop) && "setEvents must refuse while playing");
  const auto two = render(e, 2 * kLoop);

  // the voice sounds on the beat and is silent just before the next one
  assert(peak(two, 0, 2000) > 0.3f);
  assert(peak(two, 31000, 32000) < 0.01f);
  // the loop is seamless: pass 2 equals pass 1 sample for sample
  for (int64_t i = 0; i < kLoop; ++i) assert(two[i] == two[i + kLoop]);

  // Drive: same input, louder RMS once saturated, never above 1
  gf::Engine d(kSr);
  d.setEvents(ev.data(), rows, kLoop);
  d.setDrive(1.f);
  d.play();
  const auto driven = render(d, kLoop);
  double rmsDry = 0, rmsDriven = 0;
  for (int64_t i = 0; i < kLoop; ++i) { rmsDry += two[i] * two[i]; rmsDriven += driven[i] * driven[i]; }
  assert(rmsDriven > 1.5 * rmsDry);
  assert(peak(driven, 0, kLoop) <= 1.0001f);

  // capture: input and output share one frame clock, so a loopback delayed by L frames shows up L frames later
  constexpr int kLag = 1234;
  gf::Engine c(kSr);
  c.setEvents(ev.data(), rows, kLoop);
  c.play();
  c.startCapture();
  std::vector<float> loopIn(kLoop, 0.f);
  // feed the engine its own (known) output delayed by kLag: render once with a probe to know the output
  gf::Engine probe(kSr);
  probe.setEvents(ev.data(), rows, kLoop);
  probe.play();
  const auto expected = render(probe, kLoop);
  for (int64_t i = kLag; i < kLoop; ++i) loopIn[i] = expected[i - kLag];
  render(c, kLoop, loopIn.data());
  assert(c.captured() == kLoop);
  for (int i = 0; i < 1000; ++i) assert(c.captureIn()[kLag + i] == c.captureOut()[i]);

  // in-place processing (react-native-audio-api hands nodes one buffer for input and output)
  gf::Engine ip(kSr);
  ip.setEvents(ev.data(), rows, kLoop);
  ip.play();
  ip.startCapture();
  std::vector<float> io(loopIn.begin(), loopIn.begin() + 4096);
  for (int i = 0; i < 4096; i += 128) ip.process(io.data() + i, io.data() + i, 128);
  for (int i = 0; i < 4096; ++i) assert(ip.captureIn()[i] == loopIn[i] && io[i] == expected[i]);

  // reference checksum for the offline-render comparison on devices (mean |x| and peak of one dry loop)
  double sumAbs = 0;
  for (int64_t i = 0; i < kLoop; ++i) sumAbs += std::fabs(two[i]);
  std::printf("engine_test OK  ref: meanAbs=%.6f peak=%.6f frames=%lld\n", sumAbs / kLoop, peak(two, 0, kLoop),
              static_cast<long long>(kLoop));
  return 0;
}
