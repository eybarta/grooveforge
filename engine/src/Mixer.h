#pragma once
// Channel strips → drum bus / master, with reverb and delay sends. Audio thread only; nothing allocates after construction.
// The effects are Signalsmith Basics (MIT, engine/third_party): their parameters fade over 20 ms on their own.
#include <memory>

#include "gf/Engine.h"
#include "signalsmith-basics/crunch.h"
#include "signalsmith-basics/dynamics.h"
#include "signalsmith-basics/reverb.h"
#include "signalsmith-dsp/delay.h"
#include "signalsmith-dsp/filters.h"

namespace gf {

class Mixer {
 public:
  static constexpr int kBlock = 128;  // Engine::process feeds at most this many frames per call

  explicit Mixer(float sampleRate);
  /** Voices add into these for the current chunk; process() consumes and clears them. */
  float* left(int strip) { return strips_[strip].l; }
  float* right(int strip) { return strips_[strip].r; }
  /** Takes a program's mix (on adoption). */
  void apply(const Mix& mix, int strips);
  /** Clears tails and snaps parameter fades: on play, so a render starts exactly at its settings. */
  void reset();
  /** Writes the mixed chunk (n ≤ kBlock) to out. */
  void process(int strips, float* outL, float* outR, int n);

 private:
  using Biquad = signalsmith::filters::BiquadStatic<float>;
  struct Eq {
    Biquad f[2];
    bool on = false;
  };
  struct StripDsp {
    float l[kBlock] = {}, r[kBlock] = {};
    Strip p;
    Eq hpf, low, mid, high, lpf;
    bool sat = false;
    float fast = 0, slow = 0;                    // transient-shaper envelopes
    float attackDb = 0, sustainDb = 0, rev = 0, del = 0;  // smoothed copies of p (knobs move these)
    signalsmith::basics::CrunchFloat crunch;
  };

  void strip(StripDsp& s, int n);
  template <class Fx>
  void run(Fx& fx, float* l, float* r, int n);  // in place via scratch_ (the effects want separate in/out)

  float sr_;
  float smooth_;  // one-pole coefficient per chunk for the smoothed strip values
  float fastAtt_, slowAtt_, envRel_;
  std::unique_ptr<StripDsp[]> strips_;  // kMaxInstruments; never moved (the effects hold pointers to their params)
  Buses b_;
  bool tapeOn_ = false, glueOn_ = false, smashOn_ = false;
  Eq busLpf_;
  signalsmith::basics::CrunchFloat tape_;
  signalsmith::basics::DynamicsFloat glue_, smash_;
  signalsmith::basics::ReverbFloat reverb_;
  signalsmith::delay::MultiBuffer<float> delay_;
  Biquad delayLpf_[2];
  int delayFrames_ = 1, maxDelayFrames_;

  float drumL_[kBlock], drumR_[kBlock], revL_[kBlock], revR_[kBlock], delL_[kBlock], delR_[kBlock];
  float scratchL_[kBlock], scratchR_[kBlock];
};

}  // namespace gf
