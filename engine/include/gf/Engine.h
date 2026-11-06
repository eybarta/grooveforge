#pragma once
// GrooveForge audio engine: the one DSP core shared by iOS (JSI node) and web (WASM AudioWorklet).
// Plain C++20. process() never allocates, frees or locks.
#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace gf {

/** Flat event row from songToEngineEvents() (src/song/time.ts): [frame, instrument, velocity, note, durationFrames, glideNote]. */
constexpr int kEventStride = 6;
/** Flat instrument row: [kind, chokeGroup, gain, pan, p1, p2, p3, p4] (p* = voice parameters, see Instrument). */
constexpr int kInstrumentStride = 8;
/** Flat zone row: [instrument, maxVelocity, sampleSlot]. Rows of one instrument and maxVelocity form a layer. */
constexpr int kZoneStride = 3;
constexpr int kMaxVoices = 32;
constexpr int kMaxSamples = 256;
constexpr int kMaxInstruments = 64;
constexpr int kMaxLayers = 8;  // round-robin counters per instrument

enum class VoiceKind : uint8_t { Sine = 0, Sampler = 1, Bass808 = 2 };

/** Decoded audio for the sampler. Immutable once loaded. */
struct SampleData {
  std::vector<float> l, r;
  float sampleRate = 48000.f;
};

/** One velocity layer of a sampled instrument: velocities up to maxVelocity pick from these round-robin slots. */
struct Layer {
  float maxVelocity = 1.f;
  std::vector<int> slots;
};

struct Instrument {
  VoiceKind kind = VoiceKind::Sine;
  int chokeGroup = -1;  // a new note cuts every sounding voice in the same group (closed hat chokes open hat)
  float gain = 1.f;
  float pan = 0.f;      // −1 left … +1 right; 0 = unity on both channels
  // Bass808: p1 punch depth (semitones of pitch drop at the attack), p2 punch time (ms),
  //          p3 decay (seconds, amplitude time constant), p4 glide time (ms, used when an event has a glideNote)
  float p[4] = {0, 0, 0, 0};
};

struct Event {
  int64_t frame;  // position inside the loop
  int instrument;
  float velocity;
  float note;     // MIDI note (fractional allowed)
  int64_t durationFrames;
  float glideNote;  // Bass808: the pitch this note slides in from (< 0: no glide)
};

/** Everything the audio thread plays from. Immutable once published, so it can be swapped without locks. */
struct Program {
  std::vector<Event> events;  // sorted by frame
  std::vector<Instrument> instruments;
  std::vector<std::vector<Layer>> zones;  // per instrument, ascending maxVelocity (sampler instruments only)
  int64_t loopFrames = 0;
};

/**
 * Lock-free transport state for readers on other threads (the UI-thread beam via a JSI host object).
 * Written by the audio thread once per block; shared_ptr so a reader can safely outlive the engine.
 */
struct Clock {
  std::atomic<int64_t> frame{0};  // frames processed since play()
  std::atomic<int64_t> loopFrames{0};
  std::atomic<bool> playing{false};
};

class Engine {
 public:
  explicit Engine(float sampleRate, int captureSeconds = 30);
  ~Engine();
  Engine(const Engine&) = delete;
  Engine& operator=(const Engine&) = delete;

  // ---- control thread (JS / main). Safe while playing: changes land at the next audio block.
  void setEvents(const float* flat, int rows, int64_t loopFrames);
  void setInstruments(const float* flat, int count);
  void setZones(const float* flat, int rows);
  /** Loads decoded audio into a slot (r may be null for mono). A slot can be filled once; refills are ignored. */
  bool loadSample(int slot, const float* l, const float* r, int frames, float sampleRate);
  void play();  // from loop start
  void stop();
  /** Drive effect amount, 0 = bypass … 1 = heavy tanh saturation. */
  void setDrive(float amount) { drive_.store(amount, std::memory_order_relaxed); }
  void startCapture();
  void stopCapture() { capturing_.store(false, std::memory_order_release); }
  int captured() const { return captured_.load(std::memory_order_acquire); }
  const float* captureIn() const { return capIn_.data(); }
  const float* captureOut() const { return capOut_.data(); }  // left channel
  std::shared_ptr<const Clock> clock() const { return clock_; }
  float sampleRate() const { return sr_; }

  // ---- audio thread. Mono in (null = silence), stereo out; in may alias outL.
  void process(const float* in, float* outL, float* outR, int frames);

 private:
  struct Voice {
    bool active = false;
    VoiceKind kind = VoiceKind::Sine;
    int instrument = 0;
    int chokeGroup = -1;
    float gainL = 0, gainR = 0;
    float fade = 1, fadeStep = 0;
    // sine
    double phase = 0, phaseInc = 0;
    float amp = 0, decay = 0, attack = 0;
    int64_t left = 0;
    // sampler
    const SampleData* sample = nullptr;
    double pos = 0, rate = 1;
    // 808: freq(t) = glide(t) · 2^(punchSemis · punchEnv / 12); glide moves log-linearly from fromHz to toHz
    double fromHz = 0, toHz = 0, glidePos = 1, glideStep = 0;
    float punchSemis = 0, punchEnv = 0, punchDecay = 1, ampDecay = 1, release = 0, releaseStep = 0;
  };

  void publish();                // control thread: copy staged_ and hand it to the audio thread
  void adoptPending();           // audio thread
  void trigger(const Event& e);  // audio thread
  void renderVoice(Voice& v, float& l, float& r);  // audio thread: adds the voice's next frame

  float sr_;

  // control-thread copy that edits build on; never touched by the audio thread
  Program staged_;
  std::atomic<Program*> pending_{nullptr};  // published, not yet adopted (owned by whoever exchanges it out)
  std::atomic<Program*> retired_{nullptr};  // adopted-then-replaced; freed by the control thread
  Program* active_ = nullptr;               // audio thread only

  std::atomic<bool> startRequested_{false}, stopRequested_{false};
  bool playing_ = false;  // audio thread only
  int64_t frame_ = 0;     // frames since play (audio thread only)
  size_t next_ = 0;       // next event in active_ for the current loop pass
  std::atomic<float> drive_{0.f};

  Voice voices_[kMaxVoices];
  uint32_t roundRobin_[kMaxInstruments][kMaxLayers] = {};  // per velocity layer; audio thread only

  std::atomic<const SampleData*> samples_[kMaxSamples] = {};  // write-once slots, owned (freed) by ~Engine

  std::vector<float> capIn_, capOut_;
  std::atomic<bool> capturing_{false};
  std::atomic<int> captured_{0};

  std::shared_ptr<Clock> clock_ = std::make_shared<Clock>();
};

}  // namespace gf
