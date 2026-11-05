// C ABI over gf::Engine for the web build (standalone WASM, loaded by public/gf-engine-worklet.js).
#include "gf/Engine.h"

extern "C" {

gf::Engine* gf_create(float sampleRate, int captureSeconds) { return new gf::Engine(sampleRate, captureSeconds); }
void gf_destroy(gf::Engine* e) { delete e; }
float* gf_alloc(int floats) { return new float[floats]; }
void gf_free(float* p) { delete[] p; }

void gf_process(gf::Engine* e, const float* in, float* out, int frames) { e->process(in, out, frames); }
int gf_set_events(gf::Engine* e, const float* flat, int rows, double loopFrames) {
  return e->setEvents(flat, rows, static_cast<int64_t>(loopFrames)) ? 1 : 0;
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
