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
/** Flat mix for setMix(): kBusParams bus values (Buses order), then one kStripStride row per instrument (Strip order). */
constexpr int kBusParams = 20;
constexpr int kStripStride = 16;
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

/** Per-instrument channel strip, in signal order. A stage at its default is bypassed, so the default strip is transparent. */
struct Strip {
  int bus = 1;                        // 0 = drum bus, 1 = straight to master
  float hpfHz = 0;                    // 0 = off
  float lowHz = 100, lowDb = 0;       // low shelf
  float midHz = 1000, midDb = 0;      // bell, 1 octave
  float highHz = 8000, highDb = 0;    // high shelf
  float lpfHz = 0;                    // 0 = off
  float attackDb = 0, sustainDb = 0;  // transient shaper
  float satDrive = 0, satToneHz = 8000, satCutHz = 20;  // oversampled saturation (Crunch); drive 0 = off, else input gain
  float reverbSend = 0, delaySend = 0;
};

/** Drum bus, sends and returns. Defaults bypass everything. */
struct Buses {
  float glueThreshDb = 0, glueRatio = 1, glueAttackMs = 20, glueReleaseMs = 150;  // drum-bus compressor; ratio 1 = off
  float smashThreshDb = -30, smashRatio = 1, smashMix = 0;  // parallel compression (wet/dry); ratio 1 = off
  float tapeDrive = 0, tapeToneHz = 8000;                   // drum-bus saturation; 0 = off
  float busLpfHz = 0;                                       // drum-bus low-pass; 0 = off
  float reverbRoomMs = 60, reverbRt20 = 1, reverbHighCutHz = 9000, reverbReturn = 0;  // return 0 = off
  float delaySec = 0.375f, delayFeedback = 0.3f, delayLpfHz = 5000, delayReturn = 0;  // ping-pong; return 0 = off
  float masterGainDb = 0, limitDb = 0;  // master: gain into a 4× oversampled limiter (true-peak ceiling); limit ≥ 0 = off
};

struct Mix {
  std::vector<Strip> strips;  // per instrument; missing ones are default (transparent)
  Buses buses;
};

/** Everything the audio thread plays from. Immutable once published, so it can be swapped without locks. */
struct Program {
  std::vector<Event> events;  // sorted by frame
  std::vector<Instrument> instruments;
  std::vector<std::vector<Layer>> zones;  // per instrument, ascending maxVelocity (sampler instruments only)
  Mix mix;
  int64_t loopFrames = 0;
};

class Mixer;

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
  /** Strips + buses (layout: kBusParams, kStripStride). Fewer than kBusParams values resets to the transparent mix. */
  void setMix(const float* flat, int length);
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
  int strips() const;            // audio thread: mixer strips in use (one per instrument)

  float sr_;

  // control-thread copy that edits build on; never touched by the audio thread
  Program staged_;
  std::atomic<Program*> pending_{nullptr};  // published, not yet adopted (owned by whoever exchanges it out)
  std::atomic<Program*> retired_{nullptr};  // adopted-then-replaced; freed by the control thread
  Program* active_ = nullptr;               // audio thread only

  std::atomic<bool> startRequested_{false}, stopRequested_{false};
  bool playing_ = false;  // audio thread only
  int64_t frame_ = 0;     // frames since play (audio thread only)
  int quietFrames_ = 0;   // how long the master output has been below one 24-bit LSB (audio thread only)
  size_t next_ = 0;       // next event in active_ for the current loop pass
  std::atomic<float> drive_{0.f};

  std::unique_ptr<Mixer> mixer_;  // audio thread only (built and configured in the constructor)
  Voice voices_[kMaxVoices];
  uint32_t roundRobin_[kMaxInstruments][kMaxLayers] = {};  // per velocity layer; audio thread only

  std::atomic<const SampleData*> samples_[kMaxSamples] = {};  // write-once slots, owned (freed) by ~Engine

  std::vector<float> capIn_, capOut_;
  std::atomic<bool> capturing_{false};
  std::atomic<int> captured_{0};

  std::shared_ptr<Clock> clock_ = std::make_shared<Clock>();
};

}  // namespace gf
