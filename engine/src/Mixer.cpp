#include "Mixer.h"

#include <algorithm>
#include <cmath>

namespace gf {

namespace {
constexpr float kDbToLn = 0.11512925f;  // ln(10) / 20
// The limiter works this far under the requested ceiling: covers its own ≤ 0.05 dB leak plus the downsampling
// filters' ripple (~0.1 dB), so the 48 kHz output's true peak stays at or under limitDb (mix_test proves it).
constexpr float kTruePeakMarginDb = 0.3f;

template <class Design>
void design(auto& eq, bool on, Design d) {
  if (on && !eq.on)
    for (auto& f : eq.f) f.reset();  // stale state from an earlier use would click
  eq.on = on;
  if (on)
    for (auto& f : eq.f) d(f);
}

inline void filter(auto& eq, float& l, float& r) {
  if (!eq.on) return;
  l = eq.f[0](l);
  r = eq.f[1](r);
}

inline void approach(float& v, float target, float k) {
  v += (target - v) * k;
  if (std::fabs(target - v) < 1e-6f) v = target;
}
}  // namespace

Mixer::Mixer(float sampleRate)
    : sr_(sampleRate),
      smooth_(1.f - std::exp(-kBlock / (0.02f * sampleRate))),  // ~20 ms
      fastAtt_(std::exp(-1.f / (0.001f * sampleRate))),
      slowAtt_(std::exp(-1.f / (0.025f * sampleRate))),
      envRel_(std::exp(-1.f / (0.08f * sampleRate))),
      strips_(new StripDsp[kMaxInstruments]),
      maxDelayFrames_(static_cast<int>(2 * sampleRate)) {
  for (int i = 0; i < kMaxInstruments; ++i) strips_[i].crunch.configure(sr_, kBlock, 2);
  tape_.configure(sr_, kBlock, 2);
  tape_.cutHz = 30;  // let the kick's low end into the tape too
  for (auto* d : {&glue_, &smash_}) {
    d->configure(sr_, kBlock, 2);
    d->gate.limitDb = -200;  // its built-in gate (−80 dB) would chop quiet tails
  }
  smash_.timing.attackMs = 1;
  smash_.timing.releaseMs = 60;
  reverb_.configure(sr_, kBlock, 2);
  reverb_.dry = 0;  // a send: wet only
  delay_.resize(2, maxDelayFrames_ + kBlock + 1);
  limiter_.configure(4 * sr_, 4 * kBlock, 2);
  limiter_.attackMs = 2;  // = lookahead
  limiter_.holdMs = 2;
  limiter_.releaseMs = 60;
  limiter_.smoothingStages = 1;  // measured: the 2-stage mode lets peaks through at heavy (> 30 dB) gain reduction
  limiter_.linkChannels = 1;  // one gain for both sides: the stereo image doesn't wander
}

void Mixer::apply(const Mix& mix, int strips) {
  for (int i = 0; i < strips; ++i) {
    auto& s = strips_[i];
    const Strip p = static_cast<size_t>(i) < mix.strips.size() ? mix.strips[i] : Strip{};
    s.p = p;
    design(s.hpf, p.hpfHz > 0, [&](Biquad& f) { f.highpass(p.hpfHz / sr_); });
    design(s.low, p.lowDb != 0, [&](Biquad& f) { f.lowShelfDb(p.lowHz / sr_, p.lowDb); });
    design(s.mid, p.midDb != 0, [&](Biquad& f) { f.peakDb(p.midHz / sr_, p.midDb); });
    design(s.high, p.highDb != 0, [&](Biquad& f) { f.highShelfDb(p.highHz / sr_, p.highDb); });
    design(s.lpf, p.lpfHz > 0, [&](Biquad& f) { f.lowpass(p.lpfHz / sr_); });
    const bool sat = p.satDrive > 0;
    if (sat) {
      s.crunch.drive = p.satDrive;
      s.crunch.toneHz = p.satToneHz;
      s.crunch.cutHz = p.satCutHz;
      if (!s.sat) s.crunch.reset();
    }
    s.sat = sat;
  }

  b_ = mix.buses;
  const bool tape = b_.tapeDrive > 0, glue = b_.glueRatio > 1, smash = b_.smashRatio > 1;
  if (tape) {
    tape_.drive = b_.tapeDrive;
    tape_.toneHz = b_.tapeToneHz;
    if (!tapeOn_) tape_.reset();
  }
  if (glue) {
    glue_.compressor.limitDb = b_.glueThreshDb;
    glue_.compressor.invRatio = 1 / b_.glueRatio;
    glue_.timing.attackMs = b_.glueAttackMs;
    glue_.timing.releaseMs = b_.glueReleaseMs;
    if (!glueOn_) glue_.reset();
  }
  if (smash) {
    smash_.compressor.limitDb = b_.smashThreshDb;
    smash_.compressor.invRatio = 1 / b_.smashRatio;
    smash_.mix = b_.smashMix;
    if (!smashOn_) smash_.reset();
  }
  tapeOn_ = tape;
  glueOn_ = glue;
  smashOn_ = smash;
  design(busLpf_, b_.busLpfHz > 0, [&](Biquad& f) { f.lowpass(b_.busLpfHz / sr_); });
  if (b_.reverbReturn > 0) {
    reverb_.wet = b_.reverbReturn;
    reverb_.roomMs = b_.reverbRoomMs;
    reverb_.rt20 = b_.reverbRt20;
    reverb_.highCutHz = b_.reverbHighCutHz;
  }
  const bool master = b_.limitDb < 0;
  if (master) {
    limiter_.inputGain = std::exp(b_.masterGainDb * kDbToLn);
    ceiling_ = std::exp((b_.limitDb - kTruePeakMarginDb) * kDbToLn);
    limiter_.outputLimit = ceiling_;
    if (!masterOn_) {
      up1_.reset();
      up2_.reset();
      limiter_.reset();
    }
  }
  masterOn_ = master;
  delayFrames_ = std::clamp(static_cast<int>(std::lround(b_.delaySec * sr_)), 1, maxDelayFrames_);
  for (auto& f : delayLpf_) f.lowpass(std::max(100.f, b_.delayLpfHz) / sr_);
}

void Mixer::reset() {
  for (int i = 0; i < kMaxInstruments; ++i) {
    auto& s = strips_[i];
    for (Eq* eq : {&s.hpf, &s.low, &s.mid, &s.high, &s.lpf})
      for (auto& f : eq->f) f.reset();
    s.fast = s.slow = 0;
    s.attackDb = s.p.attackDb;
    s.sustainDb = s.p.sustainDb;
    s.rev = s.p.reverbSend;
    s.del = s.p.delaySend;
    s.crunch.reset();
  }
  for (auto& f : busLpf_.f) f.reset();
  tape_.reset();
  glue_.reset();
  smash_.reset();
  reverb_.reset();
  delay_.reset();
  for (auto& f : delayLpf_) f.reset();
  up1_.reset();
  up2_.reset();
  limiter_.reset();
}

template <class Fx>
void Mixer::run(Fx& fx, float* l, float* r, int n) {
  float* in[2] = {l, r};
  float* out[2] = {scratchL_, scratchR_};
  float** pi = in;
  float** po = out;
  fx.process(pi, po, static_cast<size_t>(n));
  std::copy_n(scratchL_, n, l);
  std::copy_n(scratchR_, n, r);
}

void Mixer::strip(StripDsp& s, int n) {
  const float aDb = s.attackDb, sDb = s.sustainDb;
  for (int i = 0; i < n; ++i) {
    float l = s.l[i], r = s.r[i];
    filter(s.hpf, l, r);
    filter(s.low, l, r);
    filter(s.mid, l, r);
    filter(s.high, l, r);
    filter(s.lpf, l, r);
    // transient shaper: a fast and a slow envelope differ only while a hit is rising, so t ≈ 1 on attacks, 0 after
    const float x = std::max(std::fabs(l), std::fabs(r));
    s.fast = x + (s.fast - x) * (x > s.fast ? fastAtt_ : envRel_);
    s.slow = x + (s.slow - x) * (x > s.slow ? slowAtt_ : envRel_);
    if (aDb != 0 || sDb != 0) {
      const float t = s.fast > 1e-9f ? std::max(0.f, (s.fast - s.slow) / s.fast) : 0.f;
      const float g = std::exp((aDb * t + sDb * (1 - t)) * kDbToLn);
      l *= g;
      r *= g;
    }
    s.l[i] = l;
    s.r[i] = r;
  }
  if (s.fast < 1e-15f) s.fast = s.slow = 0;  // no denormals in silence
  if (s.sat) run(s.crunch, s.l, s.r, n);
}

void Mixer::process(int strips, float* outL, float* outR, int n) {
  std::fill_n(outL, n, 0.f);
  std::fill_n(outR, n, 0.f);
  for (float* b : {drumL_, drumR_, revL_, revR_, delL_, delR_}) std::fill_n(b, n, 0.f);
  const bool rev = b_.reverbReturn > 0, del = b_.delayReturn > 0;

  for (int i = 0; i < strips; ++i) {
    auto& s = strips_[i];
    approach(s.attackDb, s.p.attackDb, smooth_);
    approach(s.sustainDb, s.p.sustainDb, smooth_);
    approach(s.rev, s.p.reverbSend, smooth_);
    approach(s.del, s.p.delaySend, smooth_);
    strip(s, n);
    float* bl = s.p.bus == 0 ? drumL_ : outL;
    float* br = s.p.bus == 0 ? drumR_ : outR;
    for (int j = 0; j < n; ++j) {
      bl[j] += s.l[j];
      br[j] += s.r[j];
    }
    if (rev && s.rev > 0)
      for (int j = 0; j < n; ++j) {
        revL_[j] += s.rev * s.l[j];
        revR_[j] += s.rev * s.r[j];
      }
    if (del && s.del > 0)
      for (int j = 0; j < n; ++j) {
        delL_[j] += s.del * s.l[j];
        delR_[j] += s.del * s.r[j];
      }
    std::fill_n(s.l, n, 0.f);
    std::fill_n(s.r, n, 0.f);
  }

  if (tapeOn_) run(tape_, drumL_, drumR_, n);
  if (busLpf_.on)
    for (int j = 0; j < n; ++j) filter(busLpf_, drumL_[j], drumR_[j]);
  if (glueOn_) run(glue_, drumL_, drumR_, n);
  if (smashOn_) run(smash_, drumL_, drumR_, n);
  for (int j = 0; j < n; ++j) {
    outL[j] += drumL_[j];
    outR[j] += drumR_[j];
  }

  if (rev) {
    run(reverb_, revL_, revR_, n);
    for (int j = 0; j < n; ++j) {
      outL[j] += revL_[j];
      outR[j] += revR_[j];
    }
  }
  if (del) {
    const float fb = b_.delayFeedback, ret = b_.delayReturn;
    const int d = delayFrames_;
    for (int j = 0; j < n; ++j) {
      const float yl = delay_[0][j - d], yr = delay_[1][j - d];
      delay_[0][j] = 0.5f * (delL_[j] + delR_[j]) + fb * delayLpf_[0](yr);  // ping-pong: in on the left, echoes alternate
      delay_[1][j] = fb * delayLpf_[1](yl);
      outL[j] += ret * yl;
      outR[j] += ret * yr;
    }
    delay_ += n;
  }
}

void Mixer::master(float* l, float* r, int n) {
  if (!masterOn_) return;
  float* io[2] = {l, r};
  up1_.up(io, n);
  float* mid[2] = {up1_[0], up1_[1]};
  up2_.up(mid, 2 * n);
  float* hi[2] = {up2_[0], up2_[1]};
  float* hiOut[2] = {hiL_, hiR_};
  float** pi = hi;
  float** po = hiOut;
  limiter_.process(pi, po, static_cast<size_t>(4 * n));
  for (int i = 0; i < 4 * n; ++i) {  // safety clip for what the limiter leaks; at 4× rate it's inaudible
    up2_[0][i] = std::clamp(hiL_[i], -ceiling_, ceiling_);
    up2_[1][i] = std::clamp(hiR_[i], -ceiling_, ceiling_);
  }
  up2_.down(mid, 2 * n);  // into stage 1's buffer, which its own down() then reads
  up1_.down(io, n);
}

}  // namespace gf
