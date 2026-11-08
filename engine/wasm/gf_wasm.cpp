// C ABI over gf::Engine for the web build (standalone WASM, loaded by public/gf-engine-worklet.js).
#include <algorithm>

#include "gf/Analysis.h"
#include "gf/Engine.h"
#include "gf/Loudness.h"

extern "C" {

gf::Engine* gf_create(float sampleRate, int captureSeconds) { return new gf::Engine(sampleRate, captureSeconds); }
void gf_destroy(gf::Engine* e) { delete e; }
float* gf_alloc(int floats) { return new float[floats]; }
void gf_free(float* p) { delete[] p; }

void gf_process(gf::Engine* e, const float* in, float* outL, float* outR, int frames) {
  e->process(in, outL, outR, frames);
}
void gf_set_events(gf::Engine* e, const float* flat, int rows, double loopFrames) {
  e->setEvents(flat, rows, static_cast<int64_t>(loopFrames));
}
void gf_set_instruments(gf::Engine* e, const float* flat, int count) { e->setInstruments(flat, count); }
void gf_set_zones(gf::Engine* e, const float* flat, int rows) { e->setZones(flat, rows); }
void gf_set_mix(gf::Engine* e, const float* flat, int length) { e->setMix(flat, length); }
/** out[0] = integrated LUFS, out[1] = true peak dBTP. Needs no engine (the web main thread calls it on its own instance). */
void gf_loudness(const float* l, const float* r, int frames, float sampleRate, float* out) {
  const auto m = gf::measureLoudness(l, r, frames, sampleRate);
  out[0] = static_cast<float>(m.lufs);
  out[1] = static_cast<float>(m.truePeakDb);
}
/**
 * Analyses a mono take (src/analysis/analyze.ts). ref: what the engine played on the take's timeline, or null.
 * Writes onset rows [time s, strength] into out (at most maxRows); returns how many onsets there are.
 */
int gf_analyze(const float* x, int n, float sampleRate, const float* ref, float* out, int maxRows) {
  gf::AnalysisOptions o;
  o.reference = ref;
  const auto a = gf::analyzeTake(x, n, sampleRate, o);
  const int count = static_cast<int>(a.onsets.size());
  for (int i = 0; i < std::min(count, maxRows); ++i) {
    out[2 * i] = static_cast<float>(a.onsets[i].time);
    out[2 * i + 1] = a.onsets[i].strength;
  }
  return count;
}
int gf_load_sample(gf::Engine* e, int slot, const float* l, const float* r, int frames, float sampleRate) {
  return e->loadSample(slot, l, r, frames, sampleRate) ? 1 : 0;
}
void gf_play(gf::Engine* e) { e->play(); }
void gf_stop(gf::Engine* e) { e->stop(); }
void gf_set_drive(gf::Engine* e, float amount) { e->setDrive(amount); }

void gf_capture_start(gf::Engine* e) { e->startCapture(); }
void gf_capture_stop(gf::Engine* e) { e->stopCapture(); }
int gf_captured(gf::Engine* e) { return e->captured(); }
const float* gf_capture_in(gf::Engine* e) { return e->captureIn(); }
const float* gf_capture_out(gf::Engine* e) { return e->captureOut(); }
}
