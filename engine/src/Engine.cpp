#include "gf/Engine.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace gf {

namespace {
double noteToHz(double note) { return 440.0 * std::pow(2.0, (note - 69.0) / 12.0); }
constexpr float kChokeFadeSec = 0.005f;  // 5 ms: fast enough to read as a choke, slow enough not to click
}  // namespace

Engine::Engine(float sampleRate, int captureSeconds)
    : sr_(sampleRate),
      capIn_(static_cast<size_t>(sampleRate) * captureSeconds),
      capOut_(static_cast<size_t>(sampleRate) * captureSeconds) {
  staged_.instruments.resize(1);  // instrument 0: a plain centred sine
  active_ = new Program(staged_);
}

Engine::~Engine() {
  delete pending_.exchange(nullptr);
  delete retired_.exchange(nullptr);
  delete active_;
}

// ---------------------------------------------------------------- control thread

void Engine::publish() {
  delete retired_.exchange(nullptr, std::memory_order_acq_rel);  // the audio thread is done with it
  // a newer program supersedes one the audio thread hasn't picked up yet; that one was never seen, so free it
  delete pending_.exchange(new Program(staged_), std::memory_order_acq_rel);
}

void Engine::setEvents(const float* flat, int rows, int64_t loopFrames) {
  staged_.events.clear();
  staged_.events.reserve(static_cast<size_t>(rows));
  for (int i = 0; i < rows; ++i) {
    const float* r = flat + i * kEventStride;
    staged_.events.push_back({static_cast<int64_t>(r[0]), static_cast<int>(r[1]), r[2], r[3],
                              static_cast<int64_t>(r[4]), r[5]});
  }
  staged_.loopFrames = loopFrames;
  clock_->loopFrames.store(loopFrames, std::memory_order_relaxed);
  publish();
}

void Engine::setInstruments(const float* flat, int count) {
  staged_.instruments.assign(static_cast<size_t>(std::max(1, count)), Instrument{});
  for (int i = 0; i < count; ++i) {
    const float* r = flat + i * kInstrumentStride;
    staged_.instruments[i] = {static_cast<VoiceKind>(static_cast<int>(r[0])), static_cast<int>(r[1]), r[2], r[3]};
  }
  publish();
}

void Engine::play() {
  stopRequested_.store(false, std::memory_order_relaxed);
  startRequested_.store(true, std::memory_order_release);
}

void Engine::stop() {
  startRequested_.store(false, std::memory_order_relaxed);
  stopRequested_.store(true, std::memory_order_release);
}

void Engine::startCapture() {
  captured_.store(0, std::memory_order_release);
  capturing_.store(true, std::memory_order_release);
}

// ---------------------------------------------------------------- audio thread

void Engine::adoptPending() {
  // Only adopt once the control thread has collected the previous retiree, so nothing is ever freed here.
  if (retired_.load(std::memory_order_acquire) != nullptr) return;
  Program* p = pending_.exchange(nullptr, std::memory_order_acq_rel);
  if (!p) return;
  retired_.store(active_, std::memory_order_release);
  active_ = p;
  // keep playing from the same position in the (possibly resized) loop
  if (active_->loopFrames > 0) {
    const int64_t pos = frame_ % active_->loopFrames;
    next_ = static_cast<size_t>(std::lower_bound(active_->events.begin(), active_->events.end(), pos,
                                                 [](const Event& e, int64_t f) { return e.frame < f; }) -
                                active_->events.begin());
  }
}

void Engine::trigger(const Event& e) {
  const auto& insts = active_->instruments;
  const Instrument inst = (e.instrument >= 0 && static_cast<size_t>(e.instrument) < insts.size()) ? insts[e.instrument]
                                                                                                  : Instrument{};
  if (inst.chokeGroup >= 0) {
    for (auto& v : voices_)
      if (v.active && v.chokeGroup == inst.chokeGroup && v.fadeStep == 0) v.fadeStep = 1.f / (kChokeFadeSec * sr_);
  }
  // a free voice, else steal the one closest to finishing
  Voice* v = &voices_[0];
  for (auto& c : voices_) {
    if (!c.active) { v = &c; break; }
    if (c.left < v->left) v = &c;
  }
  const float g = e.velocity * inst.gain;
  *v = Voice{};
  v->active = true;
  v->instrument = e.instrument;
  v->chokeGroup = inst.chokeGroup;
  v->gainL = g * std::min(1.f, 1.f - inst.pan);  // balance law: centre = unity on both sides
  v->gainR = g * std::min(1.f, 1.f + inst.pan);
  v->phaseInc = 2 * std::numbers::pi * noteToHz(e.note) / sr_;
  v->amp = 1.f;
  v->left = e.durationFrames;
  v->decay = std::exp(-5.f / static_cast<float>(std::max<int64_t>(1, e.durationFrames)));  // −43 dB at the end
}

float Engine::renderVoice(Voice& v) {
  if (v.left <= 0 || v.fade <= 0) {
    v.active = false;
    return 0.f;
  }
  --v.left;
  const float env = v.amp * std::min(1.f, v.attack) * v.fade;
  v.attack += 1.f / (0.002f * sr_);  // 2 ms attack avoids a click
  v.amp *= v.decay;
  v.fade -= v.fadeStep;
  const float s = env * static_cast<float>(std::sin(v.phase));
  v.phase += v.phaseInc;
  if (v.phase > 2 * std::numbers::pi) v.phase -= 2 * std::numbers::pi;
  return s;
}

void Engine::process(const float* in, float* outL, float* outR, int frames) {
  adoptPending();
  if (startRequested_.exchange(false, std::memory_order_acq_rel)) {
    for (auto& v : voices_) v.active = false;
    frame_ = 0;
    next_ = 0;
    playing_ = true;
    clock_->frame.store(0, std::memory_order_relaxed);
    clock_->playing.store(true, std::memory_order_relaxed);
  }
  if (stopRequested_.exchange(false, std::memory_order_acq_rel)) {
    playing_ = false;
    for (auto& v : voices_)
      if (v.active && v.fadeStep == 0) v.fadeStep = 1.f / (kChokeFadeSec * sr_);  // let nothing click off
    clock_->playing.store(false, std::memory_order_relaxed);
  }

  const float drive = drive_.load(std::memory_order_relaxed);
  const float k = 1.f + 20.f * drive;
  const float norm = 1.f / std::tanh(k);
  const bool cap = capturing_.load(std::memory_order_acquire);
  int c = captured_.load(std::memory_order_relaxed);
  const int capMax = static_cast<int>(capIn_.size());
  const Program& prog = *active_;

  for (int i = 0; i < frames; ++i) {
    const float mic = in ? in[i] : 0.f;  // read before outL[i] is written: hosts may process in place
    if (playing_ && prog.loopFrames > 0) {
      const int64_t pos = frame_ % prog.loopFrames;
      if (pos == 0) next_ = 0;
      while (next_ < prog.events.size() && prog.events[next_].frame == pos) trigger(prog.events[next_++]);
      ++frame_;
    }
    float l = 0.f, r = 0.f;
    for (auto& v : voices_) {
      if (!v.active) continue;
      const float s = renderVoice(v);
      l += s * v.gainL;
      r += s * v.gainR;
    }
    if (drive > 0.f) {  // the custom effect: Drive
      l = std::tanh(k * l) * norm;
      r = std::tanh(k * r) * norm;
    }
    outL[i] = l;
    outR[i] = r;
    if (cap && c < capMax) {
      capIn_[c] = mic;
      capOut_[c] = l;
      ++c;
    }
  }
  captured_.store(c, std::memory_order_release);
  if (playing_) clock_->frame.store(frame_, std::memory_order_relaxed);
}

}  // namespace gf
