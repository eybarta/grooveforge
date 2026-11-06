#include "gf/Engine.h"

#include <algorithm>
#include <cstring>
#include <type_traits>

#include "Mixer.h"
#include <cmath>
#include <numbers>

namespace gf {

namespace {
double noteToHz(double note) { return 440.0 * std::pow(2.0, (note - 69.0) / 12.0); }
constexpr float kChokeFadeSec = 0.005f;  // 5 ms: fast enough to read as a choke, slow enough not to click
constexpr float kQuietLevel = 1.f / 8388608.f;  // one 24-bit LSB (2^-23): below anything an export can hold
}  // namespace

Engine::Engine(float sampleRate, int captureSeconds)
    : sr_(sampleRate),
      capIn_(static_cast<size_t>(sampleRate) * captureSeconds),
      capOut_(static_cast<size_t>(sampleRate) * captureSeconds) {
  staged_.instruments.resize(1);  // instrument 0: a plain centred sine
  active_ = new Program(staged_);
  mixer_ = std::make_unique<Mixer>(sr_);
  mixer_->apply(active_->mix, strips());
  mixer_->reset();
}

Engine::~Engine() {
  delete pending_.exchange(nullptr);
  delete retired_.exchange(nullptr);
  delete active_;
  for (auto& s : samples_) delete s.load();
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
    staged_.instruments[i] = {static_cast<VoiceKind>(static_cast<int>(r[0])), static_cast<int>(r[1]), r[2], r[3],
                              {r[4], r[5], r[6], r[7]}};
  }
  publish();
}

void Engine::setZones(const float* flat, int rows) {
  staged_.zones.assign(static_cast<size_t>(kMaxInstruments), {});
  for (int i = 0; i < rows; ++i) {
    const float* r = flat + i * kZoneStride;
    const int inst = static_cast<int>(r[0]), slot = static_cast<int>(r[2]);
    if (inst < 0 || inst >= kMaxInstruments || slot < 0 || slot >= kMaxSamples) continue;
    auto& layers = staged_.zones[inst];
    if (layers.empty() || layers.back().maxVelocity != r[1]) layers.push_back({r[1], {}});
    layers.back().slots.push_back(slot);
  }
  for (auto& layers : staged_.zones)
    std::sort(layers.begin(), layers.end(), [](const Layer& a, const Layer& b) { return a.maxVelocity < b.maxVelocity; });
  publish();
}

void Engine::setMix(const float* flat, int length) {
  staged_.mix = Mix{};
  if (length >= kBusParams) {
    // Buses is kBusParams floats in layout order
    static_assert(std::is_trivially_copyable_v<Buses> && sizeof(Buses) == kBusParams * sizeof(float));
    std::memcpy(static_cast<void*>(&staged_.mix.buses), flat, sizeof(Buses));  // void*: GCC -Wclass-memaccess
    const int rows = std::min((length - kBusParams) / kStripStride, kMaxInstruments);
    staged_.mix.strips.resize(static_cast<size_t>(rows));
    for (int i = 0; i < rows; ++i) {
      const float* r = flat + kBusParams + i * kStripStride;
      staged_.mix.strips[i] = {static_cast<int>(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8],
                               r[9], r[10], r[11], r[12], r[13], r[14], r[15]};
    }
  }
  publish();
}

bool Engine::loadSample(int slot, const float* l, const float* r, int frames, float sampleRate) {
  if (slot < 0 || slot >= kMaxSamples || frames <= 0 || samples_[slot].load() != nullptr) return false;
  auto* s = new SampleData{std::vector<float>(l, l + frames), std::vector<float>(r ? r : l, (r ? r : l) + frames),
                           sampleRate};
  samples_[slot].store(s, std::memory_order_release);
  return true;
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
  mixer_->apply(active_->mix, strips());
  // keep playing from the same position in the (possibly resized) loop
  if (active_->loopFrames > 0) {
    const int64_t pos = frame_ % active_->loopFrames;
    next_ = static_cast<size_t>(std::lower_bound(active_->events.begin(), active_->events.end(), pos,
                                                 [](const Event& e, int64_t f) { return e.frame < f; }) -
                                active_->events.begin());
  }
}

int Engine::strips() const { return std::clamp(static_cast<int>(active_->instruments.size()), 1, kMaxInstruments); }

void Engine::trigger(const Event& e) {
  const auto& insts = active_->instruments;
  const Instrument inst = (e.instrument >= 0 && static_cast<size_t>(e.instrument) < insts.size()) ? insts[e.instrument]
                                                                                                  : Instrument{};
  // a sampler note needs a loaded sample before it may steal a voice or choke anything
  const SampleData* sample = nullptr;
  if (inst.kind == VoiceKind::Sampler) {
    if (e.instrument < 0 || static_cast<size_t>(e.instrument) >= active_->zones.size()) return;
    const auto& layers = active_->zones[e.instrument];
    if (layers.empty()) return;
    size_t li = layers.size() - 1;
    for (size_t i = 0; i < layers.size(); ++i)
      if (e.velocity <= layers[i].maxVelocity) { li = i; break; }
    const Layer& layer = layers[li];
    if (layer.slots.empty()) return;
    const int slot = layer.slots[roundRobin_[e.instrument][li % kMaxLayers]++ % layer.slots.size()];
    sample = samples_[slot].load(std::memory_order_acquire);
    if (!sample) return;
  }
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
  v->kind = inst.kind;
  v->instrument = e.instrument;
  v->chokeGroup = inst.chokeGroup;
  v->gainL = g * std::min(1.f, 1.f - inst.pan);  // balance law: centre = unity on both sides
  v->gainR = g * std::min(1.f, 1.f + inst.pan);
  if (inst.kind == VoiceKind::Sampler) {
    v->sample = sample;
    // note 60 = original pitch; also corrects for a sample recorded at another rate than the engine runs at
    v->rate = std::pow(2.0, (e.note - 60.0) / 12.0) * sample->sampleRate / sr_;
    v->left = static_cast<int64_t>(static_cast<double>(sample->l.size()) / v->rate);  // for voice stealing
    return;
  }
  if (inst.kind == VoiceKind::Bass808) {
    const float punchMs = std::max(1.f, inst.p[1]), decaySec = std::max(0.01f, inst.p[2]), glideMs = inst.p[3];
    v->toHz = noteToHz(e.note);
    v->fromHz = e.glideNote >= 0 && glideMs > 0 ? noteToHz(e.glideNote) : v->toHz;
    v->glidePos = v->fromHz == v->toHz ? 1 : 0;
    v->glideStep = glideMs > 0 ? 1000.0 / (glideMs * sr_) : 1;
    v->punchSemis = inst.p[0];
    v->punchEnv = 1.f;
    v->punchDecay = std::exp(-1000.f / (punchMs * sr_));
    v->amp = 1.f;
    v->ampDecay = std::exp(-1.f / (decaySec * sr_));
    v->left = std::max<int64_t>(1, e.durationFrames);
    v->release = 1.f;
    v->releaseStep = 1.f / (0.02f * sr_);  // 20 ms release after the note length: no click on note-off
    return;
  }
  v->phaseInc = 2 * std::numbers::pi * noteToHz(e.note) / sr_;
  v->amp = 1.f;
  v->left = e.durationFrames;
  v->decay = std::exp(-5.f / static_cast<float>(std::max<int64_t>(1, e.durationFrames)));  // −43 dB at the end
}

namespace {
/** 4-point cubic Hermite interpolation at fractional position t ∈ [0,1) between y1 and y2. */
inline float hermite(float y0, float y1, float y2, float y3, float t) {
  const float c1 = 0.5f * (y2 - y0), c2 = y0 - 2.5f * y1 + 2.f * y2 - 0.5f * y3, c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}
inline float tap(const std::vector<float>& x, int64_t i) {
  return i >= 0 && i < static_cast<int64_t>(x.size()) ? x[i] : 0.f;
}
}  // namespace

void Engine::renderVoice(Voice& v, float& l, float& r) {
  if (v.fade <= 0) {
    v.active = false;
    return;
  }
  const float fade = v.fade;
  v.fade -= v.fadeStep;
  if (v.kind == VoiceKind::Sampler) {
    const auto& s = *v.sample;
    const int64_t i = static_cast<int64_t>(v.pos);
    if (i >= static_cast<int64_t>(s.l.size())) {
      v.active = false;
      return;
    }
    const float t = static_cast<float>(v.pos - static_cast<double>(i));
    l += fade * v.gainL * hermite(tap(s.l, i - 1), tap(s.l, i), tap(s.l, i + 1), tap(s.l, i + 2), t);
    r += fade * v.gainR * hermite(tap(s.r, i - 1), tap(s.r, i), tap(s.r, i + 1), tap(s.r, i + 2), t);
    v.pos += v.rate;
    --v.left;
    return;
  }
  if (v.kind == VoiceKind::Bass808) {
    if (v.left > 0) {
      --v.left;
    } else if ((v.release -= v.releaseStep) <= 0) {
      v.active = false;
      return;
    }
    const double glided = v.glidePos >= 1 ? v.toHz : v.fromHz * std::pow(v.toHz / v.fromHz, v.glidePos);
    v.glidePos = std::min(1.0, v.glidePos + v.glideStep);
    const double hz = glided * std::exp2(v.punchSemis * v.punchEnv / 12.0);
    // envelopes stop at exact 0 instead of decaying into subnormals on long notes (WASM has no flush-to-zero)
    v.punchEnv = v.punchEnv > 1e-6f ? v.punchEnv * v.punchDecay : 0.f;
    const float env = v.amp * std::min(1.f, v.attack) * fade * std::max(0.f, v.release);
    v.attack += 1.f / (0.001f * sr_);  // 1 ms attack: keeps the click of a real 808 without a pop
    v.amp = v.amp > kQuietLevel ? v.amp * v.ampDecay : 0.f;
    const float s = env * static_cast<float>(std::sin(v.phase));
    v.phase += 2 * std::numbers::pi * hz / sr_;
    if (v.phase > 2 * std::numbers::pi) v.phase -= 2 * std::numbers::pi;
    l += s * v.gainL;
    r += s * v.gainR;
    return;
  }
  if (v.left <= 0) {
    v.active = false;
    return;
  }
  --v.left;
  const float env = v.amp * std::min(1.f, v.attack) * fade;
  v.attack += 1.f / (0.002f * sr_);  // 2 ms attack avoids a click
  v.amp *= v.decay;
  const float s = env * static_cast<float>(std::sin(v.phase));
  v.phase += v.phaseInc;
  if (v.phase > 2 * std::numbers::pi) v.phase -= 2 * std::numbers::pi;
  l += s * v.gainL;
  r += s * v.gainR;
}

void Engine::process(const float* in, float* outL, float* outR, int frames) {
  stfx::StopDenormals noDenormals;  // flush-to-zero for reverb/filter tails (ARM; a no-op in WASM)
  adoptPending();
  if (startRequested_.exchange(false, std::memory_order_acq_rel)) {
    for (auto& v : voices_) v.active = false;
    mixer_->reset();
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
  const int nStrips = strips();

  for (int done = 0; done < frames; done += Mixer::kBlock) {
    const int n = std::min(Mixer::kBlock, frames - done);
    float mic[Mixer::kBlock];  // read before outL is written: hosts may process in place
    for (int i = 0; i < n; ++i) mic[i] = in ? in[done + i] : 0.f;
    for (int i = 0; i < n; ++i) {
      if (playing_ && prog.loopFrames > 0) {
        const int64_t pos = frame_ % prog.loopFrames;
        if (pos == 0) next_ = 0;
        while (next_ < prog.events.size() && prog.events[next_].frame == pos) trigger(prog.events[next_++]);
        ++frame_;
      }
      for (auto& v : voices_) {
        if (!v.active) continue;
        const int s = v.instrument >= 0 && v.instrument < nStrips ? v.instrument : 0;
        renderVoice(v, mixer_->left(s)[i], mixer_->right(s)[i]);
      }
    }
    float* l = outL + done;
    float* r = outR + done;
    mixer_->process(nStrips, l, r, n);
    for (int i = 0; i < n; ++i) {
      if (drive > 0.f) {  // the spike's custom effect: Drive
        l[i] = std::tanh(k * l[i]) * norm;
        r[i] = std::tanh(k * r[i]) * norm;
      }
      // tapped before the master: its latency then lands inside the measured round trip, so takes and visuals stay
      // aligned to the event timeline
      if (cap && c < capMax) {
        capIn_[c] = mic[i];
        capOut_[c] = l[i];
        ++c;
      }
    }
    mixer_->master(l, r, n);
    // WASM has no flush-to-zero: idle reverb/filter tails sink into subnormal floats (slow on x86) and stay there.
    // After 1 s below one 24-bit LSB nothing audible or exportable is left, so clear the mixer to exact zeros.
    float peak = 0.f;
    for (int i = 0; i < n; ++i) peak = std::max({peak, std::fabs(l[i]), std::fabs(r[i])});
    if (peak >= kQuietLevel) quietFrames_ = 0;
    else if (quietFrames_ < sr_ && (quietFrames_ += n) >= sr_) mixer_->reset();
  }
  captured_.store(c, std::memory_order_release);
  if (playing_) clock_->frame.store(frame_, std::memory_order_relaxed);
}

}  // namespace gf
