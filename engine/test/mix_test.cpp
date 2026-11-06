// Host checks for the mix chain (engine/src/Mixer.cpp). Run: npm run test:engine
#include <cstdio>
#include <cstring>

#include "helpers.h"

namespace {
constexpr int64_t kLen = 96000;  // 2 s

/** The flat layout setMix() takes (Engine.h): buses, then one row per strip. */
std::vector<float> mixOf(const gf::Buses& b, const std::vector<gf::Strip>& strips) {
  std::vector<float> f(gf::kBusParams);
  std::memcpy(f.data(), &b, sizeof b);
  for (const auto& s : strips)
    f.insert(f.end(), {static_cast<float>(s.bus), s.hpfHz, s.lowHz, s.lowDb, s.midHz, s.midDb, s.highHz, s.highDb,
                       s.lpfHz, s.attackDb, s.sustainDb, s.satDrive, s.satToneHz, s.satCutHz, s.reverbSend,
                       s.delaySend});
  return f;
}

float hzNote(float hz) { return 69.f + 12.f * std::log2(hz / 440.f); }

double rms(const std::vector<float>& v, size_t a, size_t b) {
  double e = 0;
  for (size_t i = a; i < b; ++i) e += double(v[i]) * v[i];
  return std::sqrt(e / double(b - a));
}

/** Magnitude of one frequency over [a, b) (Goertzel). */
double tone(const std::vector<float>& v, size_t a, size_t b, double hz) {
  const double w = 2 * M_PI * hz / kSr, c = 2 * std::cos(w);
  double s1 = 0, s2 = 0;
  for (size_t i = a; i < b; ++i) {
    const double s0 = v[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return std::sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / double(b - a);
}

/** One instrument (row of 8), one note at frame 0, the given mix; renders kLen frames. */
Stereo play1(const std::vector<float>& inst, float note, float durFrames, const std::vector<float>& mix,
             int block = 128, float velocity = 1.f) {
  gf::Engine e(kSr);
  e.setInstruments(inst.data(), 1);
  const float ev[] = {0, 0, velocity, note, durFrames, -1};
  e.setEvents(ev, 1, 4 * kLen);
  e.setMix(mix.data(), static_cast<int>(mix.size()));
  e.play();
  return render(e, kLen, nullptr, block);
}

const std::vector<float> kSine = {0, -1, 1.f, 0, 0, 0, 0, 0};
const std::vector<float> k808 = {2, -1, 1.f, 0, 0, 1, 10, 0};  // no punch, 10 s decay: a steady sine
}  // namespace

int main() {
  const gf::Buses off;

  // high-pass: a 40 Hz tone through a 300 Hz HPF loses > 26 dB
  {
    gf::Strip s;
    s.hpfHz = 300;
    const auto dry = play1(k808, hzNote(40), kLen, mixOf(off, {}));
    const auto hp = play1(k808, hzNote(40), kLen, mixOf(off, {s}));
    const double ratio = rms(hp.l, 24000, 72000) / rms(dry.l, 24000, 72000);
    std::printf("hpf 40 Hz through 300 Hz: %.4f\n", ratio);
    assert(ratio < 0.05);
  }

  // low shelf +6 dB at 100 Hz lifts a 40 Hz tone by ~6 dB
  {
    gf::Strip s;
    s.lowDb = 6;
    const auto dry = play1(k808, hzNote(40), kLen, mixOf(off, {}));
    const auto eq = play1(k808, hzNote(40), kLen, mixOf(off, {s}));
    const double ratio = rms(eq.l, 24000, 72000) / rms(dry.l, 24000, 72000);
    std::printf("low shelf +6 dB at 40 Hz: x%.3f\n", ratio);
    assert(ratio > 1.7 && ratio < 2.05);
  }

  // saturation: a clean 55 Hz 808 has no 3rd harmonic; driven, it gains one (and stays bounded)
  {
    gf::Strip s;
    s.satDrive = 8;
    s.satToneHz = 8000;
    const auto clean = play1(k808, hzNote(55), kLen, mixOf(off, {}));
    const auto sat = play1(k808, hzNote(55), kLen, mixOf(off, {s}));
    const double h3Clean = tone(clean.l, 24000, 72000, 165) / tone(clean.l, 24000, 72000, 55);
    const double h3Sat = tone(sat.l, 24000, 72000, 165) / tone(sat.l, 24000, 72000, 55);
    std::printf("3rd harmonic: clean %.5f, saturated %.4f, peak %.3f\n", h3Clean, h3Sat, peak(sat.l, 0, kLen));
    assert(h3Clean < 0.001 && h3Sat > 0.05);
    assert(peak(sat.l, 0, kLen) < 2.f);
  }

  // transient shaper: +9 dB attack lifts the first 15 ms, leaves the body (200–300 ms) alone
  {
    gf::Strip s;
    s.attackDb = 9;
    const auto dry = play1(kSine, hzNote(440), 48000, mixOf(off, {}));
    const auto shaped = play1(kSine, hzNote(440), 48000, mixOf(off, {s}));
    const double hit = peak(shaped.l, 0, 720) / peak(dry.l, 0, 720);
    const double body = rms(shaped.l, 9600, 14400) / rms(dry.l, 9600, 14400);
    std::printf("transient shaper: attack x%.2f, body x%.3f\n", hit, body);
    assert(hit > 1.8 && body > 0.9 && body < 1.12);
  }

  // reverb send: a tail after a 10 ms note; without the send, silence after the note
  {
    gf::Buses b;
    b.reverbReturn = 1;
    b.reverbRt20 = 1.5f;
    gf::Strip s;
    s.reverbSend = 0.5f;
    const auto dry = play1(kSine, hzNote(880), 480, mixOf(b, {}));
    const auto wet = play1(kSine, hzNote(880), 480, mixOf(b, {s}));
    const double tail = rms(wet.l, 14400, 28800);
    std::printf("reverb tail rms 0.3–0.6 s: %.5f (dry %.5f)\n", tail, rms(dry.l, 14400, 28800));
    assert(peak(dry.l, 1000, kLen) == 0.f && tail > 1e-3);
    assert(wet.l != wet.r);  // the FDN decorrelates the channels
  }

  // ping-pong delay: 250 ms echo on the left, 500 ms on the right
  {
    gf::Buses b;
    b.delayReturn = 1;
    b.delaySec = 0.25f;
    b.delayFeedback = 0.5f;
    b.delayLpfHz = 20000;
    gf::Strip s;
    s.delaySend = 1;
    const auto d = play1(kSine, hzNote(2000), 240, mixOf(b, {s}));
    const float l1 = peak(d.l, 11900, 12600), r1 = peak(d.r, 11900, 12600);
    const float l2 = peak(d.l, 23900, 24600), r2 = peak(d.r, 23900, 24600);
    const float dry = peak(d.l, 0, 1000);
    std::printf("delay: dry %.3f · 250 ms L %.3f R %.3f · 500 ms L %.3f R %.3f\n", dry, l1, r1, l2, r2);
    assert(l1 > 0.9f * dry && r1 < 1e-6f && std::fabs(r2 / l1 - 0.5f) < 0.05f && l2 < 1e-6f);  // feedback 0.5
  }

  // drum bus: a 4:1 glue compressor at −30 dB turns a loud tone down by > 3 dB; routing to the bus alone changes nothing
  {
    gf::Buses b;
    b.glueThreshDb = -30;
    b.glueRatio = 4;
    gf::Strip s;
    s.bus = 0;
    const auto direct = play1(k808, hzNote(220), kLen, mixOf(off, {}), 128, 0.5f);
    const auto viaBus = play1(k808, hzNote(220), kLen, mixOf(off, {s}), 128, 0.5f);
    const auto glued = play1(k808, hzNote(220), kLen, mixOf(b, {s}), 128, 0.5f);
    assert(direct.l == viaBus.l);
    const double db = 20 * std::log10(rms(glued.l, 24000, 72000) / rms(direct.l, 24000, 72000));
    std::printf("glue: %.2f dB\n", db);
    assert(db < -3);
  }

  // everything on: identical output whatever block size the host uses (128, odd, larger than the mixer's chunk)
  {
    gf::Buses b;
    b = {-18, 3, 20, 150, -30, 6, 0.4f, 3, 7000, 11000, 60, 1, 9000, 0.6f, 0.3f, 0.4f, 4000, 0.5f};
    std::vector<gf::Strip> strips(2);
    strips[0] = {0, 40, 80, 2, 400, -3, 6000, 2, 0, 4, -2, 0, 8000, 20, 0.2f, 0.1f};
    strips[1] = {1, 25, 60, 1, 1000, 0, 8000, 0, 0, 0, 0, 4, 5000, 20, 0, 0};
    const auto mix = mixOf(b, strips);
    const float insts[] = {0, -1, 1.f, 0, 0, 0, 0, 0, 2, -1, 0.9f, 0, 7, 25, 0.35f, 0};
    std::vector<float> ev;
    for (int k = 0; k < 8; ++k) ev.insert(ev.end(), {k * 12000.f, 0, 0.9f, hzNote(150), 4000.f, -1.f});
    for (int k = 0; k < 4; ++k) ev.insert(ev.end(), {k * 24000.f, 1, 1.f, 29.f, 18000.f, -1.f});
    auto run = [&](int block) {
      gf::Engine e(kSr);
      e.setInstruments(insts, 2);
      e.setEvents(ev.data(), static_cast<int>(ev.size() / gf::kEventStride), kLen);
      e.setMix(mix.data(), static_cast<int>(mix.size()));
      e.play();
      return render(e, 2 * kLen, nullptr, block);
    };
    const auto a = run(128), c = run(100), d = run(512);
    float diff = 0;
    for (size_t i = 0; i < a.l.size(); ++i) {
      assert(std::isfinite(a.l[i]) && std::isfinite(a.r[i]));
      diff = std::max({diff, std::fabs(a.l[i] - c.l[i]), std::fabs(a.l[i] - d.l[i]), std::fabs(a.r[i] - c.r[i]),
                       std::fabs(a.r[i] - d.r[i])});
    }
    std::printf("full mix: peak %.3f, max diff across block sizes %.2e\n", peak(a.l, 0, a.l.size()), diff);
    assert(diff < 1e-4f);
    assert(peak(a.l, 0, a.l.size()) > 0.1f);
  }

  std::printf("mix_test OK\n");
  return 0;
}
