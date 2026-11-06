#include "gf/Engine.h"

#include <cmath>
#include <numbers>

namespace gf {

Engine::Engine(float sampleRate, int captureSeconds)
    : sr_(sampleRate),
      capIn_(static_cast<size_t>(sampleRate) * captureSeconds),
      capOut_(static_cast<size_t>(sampleRate) * captureSeconds) {}

bool Engine::setEvents(const float* flat, int rows, int64_t loopFrames) {
  // shortcut: only while stopped (no audio-thread race); a lock-free swap comes with live editing in P1.
  if (playing()) return false;
  events_.clear();
  for (int i = 0; i < rows; ++i) {
    const float* r = flat + i * kEventStride;
    events_.push_back({static_cast<int64_t>(r[0]), r[1], r[2], static_cast<int64_t>(r[3])});
  }
  loopFrames_ = loopFrames;
  clock_->loopFrames.store(loopFrames, std::memory_order_relaxed);
  return true;
}

void Engine::play() {
  frame_ = 0;
  next_ = 0;
  voiceLeft_ = 0;
  clock_->frame.store(0, std::memory_order_relaxed);
  clock_->playing.store(true, std::memory_order_relaxed);
  playing_.store(true, std::memory_order_release);
}

void Engine::stop() {
  playing_.store(false, std::memory_order_release);
  clock_->playing.store(false, std::memory_order_relaxed);
}

void Engine::startCapture() {
  captured_.store(0, std::memory_order_release);
  capturing_.store(true, std::memory_order_release);
}

float Engine::renderVoice() {
  if (voiceLeft_ <= 0) return 0.f;
  --voiceLeft_;
  const float env = amp_ * std::min(1.f, attack_);
  attack_ += 1.f / (0.002f * sr_);  // 2 ms attack avoids a click on retrigger
  amp_ *= decay_;
  const float s = env * static_cast<float>(std::sin(phase_));
  phase_ += phaseInc_;
  if (phase_ > 2 * std::numbers::pi) phase_ -= 2 * std::numbers::pi;
  return s;
}

void Engine::process(const float* in, float* out, int frames) {
  const bool play = playing_.load(std::memory_order_acquire);
  const float drive = drive_.load(std::memory_order_relaxed);
  const float k = 1.f + 20.f * drive;
  const float norm = 1.f / std::tanh(k);
  const bool cap = capturing_.load(std::memory_order_acquire);
  int c = captured_.load(std::memory_order_relaxed);
  const int capMax = static_cast<int>(capIn_.size());

  for (int i = 0; i < frames; ++i) {
    const float mic = in ? in[i] : 0.f;  // read before out[i] is written: hosts may process in place (in == out)
    if (play && loopFrames_ > 0) {
      const int64_t pos = frame_ % loopFrames_;
      if (pos == 0) next_ = 0;
      while (next_ < events_.size() && events_[next_].frame == pos) {
        const Event& e = events_[next_++];
        phase_ = 0;  // every hit starts identically, so loop passes and offline renders match bit for bit
        phaseInc_ = 2 * std::numbers::pi * e.hz / sr_;
        amp_ = e.velocity;
        attack_ = 0;
        voiceLeft_ = e.durationFrames;
        decay_ = std::exp(-5.f / static_cast<float>(std::max<int64_t>(1, e.durationFrames)));  // −43 dB at the end
      }
      ++frame_;
    }
    float y = renderVoice();
    if (drive > 0.f) y = std::tanh(k * y) * norm;  // the custom effect: Drive
    out[i] = y;
    if (cap && c < capMax) {
      capIn_[c] = mic;
      capOut_[c] = y;
      ++c;
    }
  }
  captured_.store(c, std::memory_order_release);
  if (play) clock_->frame.store(frame_, std::memory_order_relaxed);
}

}  // namespace gf
