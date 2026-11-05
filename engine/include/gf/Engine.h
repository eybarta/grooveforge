#pragma once
// GrooveForge audio engine: the one DSP core shared by iOS/Android (JSI node) and web (WASM AudioWorklet).
// Plain C++20, no dependencies, no allocation or locks inside process().
#include <atomic>
#include <cstdint>
#include <vector>

namespace gf {

/** One row of the flat event buffer built by songToEngineEvents() in src/song/time.ts. */
struct Event {
  int64_t frame;  // position inside the loop
  float hz;
  float velocity;
  int64_t durationFrames;
};
constexpr int kEventStride = 4;

class Engine {
 public:
  explicit Engine(float sampleRate, int captureSeconds = 30);

  /** Loads the loop. Events must be sorted by frame. Returns false (and ignores the call) while playing. */
  bool setEvents(const float* flat, int rows, int64_t loopFrames);
  void play();   // from loop start
  void stop();
  bool playing() const { return playing_.load(std::memory_order_relaxed); }

  /** Drive effect amount, 0 = bypass … 1 = heavy tanh saturation. Safe to call from any thread. */
  void setDrive(float amount) { drive_.store(amount, std::memory_order_relaxed); }

  /** Starts recording the mic input and the engine output side by side, stamped by the same frame clock. */
  void startCapture();
  void stopCapture() { capturing_.store(false, std::memory_order_release); }
  int captured() const { return captured_.load(std::memory_order_acquire); }
  const float* captureIn() const { return capIn_.data(); }
  const float* captureOut() const { return capOut_.data(); }

  /** Mono in (may be null = silence), mono out. Real-time safe. */
  void process(const float* in, float* out, int frames);

  int64_t frame() const { return frame_; }
  float sampleRate() const { return sr_; }

 private:
  float renderVoice();

  float sr_;
  std::vector<Event> events_;
  int64_t loopFrames_ = 0;
  int64_t frame_ = 0;  // frames since play()
  size_t next_ = 0;    // next event index within the current loop pass
  std::atomic<bool> playing_{false};
  std::atomic<float> drive_{0.f};

  // the single voice: a sine "boop" with exponential decay, retriggered by every event
  double phase_ = 0, phaseInc_ = 0;
  float amp_ = 0, decay_ = 0, attack_ = 0;
  int64_t voiceLeft_ = 0;

  std::vector<float> capIn_, capOut_;
  std::atomic<bool> capturing_{false};
  std::atomic<int> captured_{0};
};

}  // namespace gf
