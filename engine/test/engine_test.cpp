// Host-side checks for gf::Engine. Run: npm run test:engine
#undef NDEBUG  // the checks below are asserts; keep them in every build type
#include <atomic>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <memory>
#include <thread>
#include <vector>

#include "gf/Engine.h"

namespace {
constexpr float kSr = 48000.f;
constexpr int64_t kLoop = 256000;  // 2 bars at 90 BPM

struct Stereo {
  std::vector<float> l, r;
};

Stereo render(gf::Engine& e, int frames, const float* in = nullptr) {
  Stereo o{std::vector<float>(frames), std::vector<float>(frames)};
  for (int i = 0; i < frames; i += 128) {
    const int n = std::min(128, frames - i);
    e.process(in ? in + i : nullptr, o.l.data() + i, o.r.data() + i, n);
  }
  return o;
}

float peak(const std::vector<float>& v, size_t a, size_t b) {
  float p = 0;
  for (size_t i = a; i < b; ++i) p = std::max(p, std::fabs(v[i]));
  return p;
}

const float kHatNote = 69.f + 12.f * std::log2(2400.f / 440.f);  // 2.4 kHz, as src/song/time.ts produces it

// the spike loop (src/audio/spikeSongs.ts loopSong): a 55 Hz boop (note 33) on every beat + a hat on each off-beat 8th
std::vector<float> spikeLoop() {
  std::vector<float> ev;
  for (int b = 0; b < 8; ++b) {
    ev.insert(ev.end(), {b * 32000.f, 0, 0.8f, 33.f, 12000.f, -1.f});
    ev.insert(ev.end(), {b * 32000.f + 16000.f, 0, 0.5f, kHatNote, 1920.f, -1.f});
  }
  return ev;
}
int rowsOf(const std::vector<float>& ev) { return static_cast<int>(ev.size() / gf::kEventStride); }
}  // namespace

int main() {
  const auto ev = spikeLoop();
  const int rows = rowsOf(ev);

  // plays the loop: sound on the beat, silence just before the next one, seamless loop seam
  gf::Engine e(kSr);
  e.setEvents(ev.data(), rows, kLoop);
  e.play();
  const auto two = render(e, 2 * kLoop);
  assert(peak(two.l, 0, 2000) > 0.3f);
  assert(peak(two.l, 31000, 32000) < 0.01f);
  for (int64_t i = 0; i < kLoop; ++i) assert(two.l[i] == two.l[i + kLoop]);
  // centred instruments are unity on both channels
  for (int64_t i = 0; i < kLoop; ++i) assert(two.l[i] == two.r[i]);

  // Drive: louder RMS once saturated, never above 1
  {
    gf::Engine d(kSr);
    d.setEvents(ev.data(), rows, kLoop);
    d.setDrive(1.f);
    d.play();
    const auto driven = render(d, kLoop);
    double rmsDry = 0, rmsDriven = 0;
    for (int64_t i = 0; i < kLoop; ++i) { rmsDry += two.l[i] * two.l[i]; rmsDriven += driven.l[i] * driven.l[i]; }
    assert(rmsDriven > 1.5 * rmsDry);
    assert(peak(driven.l, 0, kLoop) <= 1.0001f);
  }

  // capture: input and output share one frame clock, so a loopback delayed by L frames shows up L frames later
  constexpr int kLag = 1234;
  std::vector<float> loopIn(kLoop, 0.f);
  for (int64_t i = kLag; i < kLoop; ++i) loopIn[i] = two.l[i - kLag];
  {
    gf::Engine c(kSr);
    c.setEvents(ev.data(), rows, kLoop);
    c.play();
    c.startCapture();
    render(c, kLoop, loopIn.data());
    assert(c.captured() == kLoop);
    for (int i = 0; i < 1000; ++i) assert(c.captureIn()[kLag + i] == c.captureOut()[i]);
  }

  // in-place processing (react-native-audio-api hands nodes one buffer for input and the left output)
  {
    gf::Engine ip(kSr);
    ip.setEvents(ev.data(), rows, kLoop);
    ip.play();
    ip.startCapture();
    std::vector<float> io(loopIn.begin(), loopIn.begin() + 4096), right(4096);
    for (int i = 0; i < 4096; i += 128) ip.process(io.data() + i, io.data() + i, right.data() + i, 128);
    for (int i = 0; i < 4096; ++i) assert(ip.captureIn()[i] == loopIn[i] && io[i] == two.l[i]);
  }

  // clock: frames processed since play(), loop length, play/stop state
  {
    gf::Engine k(kSr);
    auto clock = k.clock();
    k.setEvents(ev.data(), rows, kLoop);
    assert(clock->loopFrames.load() == kLoop && !clock->playing.load());
    k.play();
    render(k, 1000);
    assert(clock->playing.load() && clock->frame.load() == 1000);
    k.stop();
    render(k, 128);
    assert(!clock->playing.load());
  }

  // polyphony: overlapping notes sum instead of cutting each other
  {
    const float both[] = {0, 0, 0.5f, 60, 4800, -1, 0, 0, 0.5f, 67, 4800, -1};
    gf::Engine p(kSr);
    p.setEvents(both, 2, kLoop);
    p.play();
    const auto o = render(p, 4800);
    gf::Engine single(kSr);
    single.setEvents(both, 1, kLoop);
    single.play();
    const auto s = render(single, 4800);
    assert(peak(o.l, 0, 4800) > 1.3f * peak(s.l, 0, 4800));
  }

  // choke group: a closed hat cuts a ringing open hat within ~5 ms; pan sends instrument 1 hard left
  {
    const float insts[] = {0, 1, 1.f, 0.f, 0, 1, 1.f, -1.f};  // [kind, chokeGroup, gain, pan] × 2
    const float hats[] = {0, 0, 0.8f, 90, 48000, -1, 4800, 1, 0.8f, 95, 480, -1};  // open at 0, closed at 100 ms
    gf::Engine h(kSr);
    h.setInstruments(insts, 2);
    h.setEvents(hats, 2, kLoop);
    h.play();
    const auto o = render(h, 9600);
    assert(peak(o.l, 4000, 4800) > 0.1f);               // open hat ringing before the choke
    assert(peak(o.r, 4800 + 480, 9600) < 1e-6f);        // open hat gone on the right (closed hat is hard left)
    assert(peak(o.l, 4800 + 480 + 300, 9600) < 1e-6f);  // and everything has ended after the closed hat
  }

  // live edit: new events land at the next block while playing, from the same loop position
  {
    gf::Engine live(kSr);
    live.setEvents(ev.data(), rows, kLoop);
    live.play();
    render(live, 20000);
    const float later[] = {30000, 0, 0.9f, 72, 2000, -1};  // one note later in the loop
    live.setEvents(later, 1, kLoop);
    const auto after = render(live, 12000);      // frames 20000..32000
    assert(peak(after.l, 0, 9000) < 0.01f);      // no old notes left in this stretch
    assert(peak(after.l, 10000, 12000) > 0.3f);  // the new note at 30000 played
  }

  // lock-free stress: a control thread hammers setEvents/setInstruments while audio renders (also run under TSan)
  {
    gf::Engine s(kSr);
    s.setEvents(ev.data(), rows, kLoop);
    s.play();
    std::atomic<bool> done{false};
    std::thread writer([&] {
      const float insts[] = {0, -1, 1.f, 0.f};
      for (int i = 0; !done.load(); ++i) {
        s.setEvents(ev.data(), rows - (i % 4), kLoop - (i % 3) * 1000);
        s.setInstruments(insts, 1);
      }
    });
    float l[128], r[128];
    for (int b = 0; b < 4000; ++b) s.process(nullptr, l, r, 128);
    done = true;
    writer.join();
  }

  // sampler: velocity picks the layer, round-robins cycle, note pitches by playback rate, sample rate is corrected
  {
    constexpr int kSmp = 4800;
    std::vector<float> soft(kSmp, 0.25f), hard(kSmp, 1.f), hard2(kSmp, 0.75f);  // constant "samples" = easy to identify
    const float insts[] = {1, -1, 1.f, 0.f};                      // instrument 0 = sampler, centred, gain 1
    const float zones[] = {0, 0.5f, 0, 0, 1.f, 1, 0, 1.f, 2};     // layer ≤0.5: slot 0; layer ≤1: slots 1, 2 (round-robin)
    auto make = [&](const std::vector<float>& ev) {
      auto s = std::make_unique<gf::Engine>(kSr);
      assert(s->loadSample(0, soft.data(), nullptr, kSmp, kSr));
      assert(s->loadSample(1, hard.data(), nullptr, kSmp, kSr));
      assert(s->loadSample(2, hard2.data(), nullptr, kSmp, 24000.f));  // recorded at half the engine rate
      assert(!s->loadSample(1, soft.data(), nullptr, kSmp, kSr));       // slots are write-once
      s->setInstruments(insts, 1);
      s->setZones(zones, 3);
      s->setEvents(ev.data(), static_cast<int>(ev.size() / gf::kEventStride), kLoop);
      s->play();
      return s;
    };
    // one note per 0.5 s: velocity 0.3 (soft layer), then 1.0 twice (round-robin slot 1, then slot 2)
    const std::vector<float> ev = {0, 0, 0.3f, 60, 0, -1, 24000, 0, 1.f, 60, 0, -1, 48000, 0, 1.f, 60, 0, -1};
    auto s = make(ev);
    const auto o = render(*s, 72000 + 2 * kSmp + 100);
    assert(std::fabs(o.l[2000] - 0.25f * 0.3f) < 1e-4f);           // soft layer × velocity
    assert(std::fabs(o.l[24000 + 2000] - 1.f) < 1e-4f);            // hard layer, round-robin 1
    assert(std::fabs(o.l[48000 + 2000] - 0.75f) < 1e-4f);          // hard layer, round-robin 2
    assert(o.l[24000 + kSmp + 10] == 0.f);                         // one-shot ends with the sample
    assert(std::fabs(o.l[48000 + 2 * kSmp - 50] - 0.75f) < 1e-4f);  // the 24 kHz sample lasts twice as long at 48 kHz
    assert(o.l[48000 + 2 * kSmp + 10] == 0.f);
    // note 72 = one octave up = half the length
    auto up = make({0, 0, 1.f, 72, 0, -1});
    const auto u = render(*up, kSmp);
    assert(std::fabs(u.l[kSmp / 2 - 10] - 1.f) < 1e-4f && u.l[kSmp / 2 + 10] == 0.f);
    // a sampler instrument whose slot was never loaded stays silent instead of crashing
    gf::Engine empty(kSr);
    empty.setInstruments(insts, 1);
    empty.setZones(zones, 3);
    empty.setEvents(ev.data(), 3, kLoop);
    empty.play();
    assert(peak(render(empty, 30000).l, 0, 30000) == 0.f);
  }

  // reference fingerprint for the device offline-render comparison (mean |x| and peak of one dry loop, left)
  double sumAbs = 0;
  for (int64_t i = 0; i < kLoop; ++i) sumAbs += std::fabs(two.l[i]);
  std::printf("engine_test OK  ref: meanAbs=%.6f peak=%.6f frames=%lld\n", sumAbs / kLoop, peak(two.l, 0, kLoop),
              static_cast<long long>(kLoop));
  return 0;
}
