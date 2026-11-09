// Web worker for the engine's take analysis (engine/src/Analysis.cpp via gf-engine.wasm), so the main thread (which
// draws the web app's animations) stays free while a take is analysed. Plain JS like gf-engine-worklet.js: Metro
// doesn't bundle it. Message in: { id, take: Float32Array, reference?: Float32Array, sampleRate, beatCentreBpm }
// (transferred); out: { id, rows: Float32Array, f0: Float32Array, beats: number[], bpm } (onset rows, pitch, beats; see
// src/analysis/analyze.ts) or { id, error }.
const MAX_HITS = 4096;
const MAX_BEATS = 2048;
const PITCH_HOP = 512; // gf::kPitchHop
let ready = null;

function engine() {
  ready ??= fetch("/gf-engine.wasm")
    .then((r) => r.arrayBuffer())
    .then((bytes) => WebAssembly.instantiate(bytes, new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) })))
    .then(({ instance }) => {
      instance.exports._initialize?.();
      return instance.exports;
    });
  return ready;
}

self.onmessage = async ({ data }) => {
  const { id, take, reference, sampleRate, beatCentreBpm = 0 } = data;
  try {
    const ex = await engine();
    const put = (x) => {
      const p = ex.gf_alloc(Math.max(1, x.length));
      new Float32Array(ex.memory.buffer, p, x.length).set(x);
      return p;
    };
    const stride = ex.gf_onset_stride();
    const px = put(take);
    const pr = reference ? put(reference) : 0;
    const po = ex.gf_alloc(stride * MAX_HITS);
    const frames = Math.floor(take.length / PITCH_HOP) + 1;
    const pf = ex.gf_alloc(frames);
    const pb = ex.gf_alloc(MAX_BEATS);
    const pn = ex.gf_alloc(2); // [beat count (int32), bpm (float32)]
    const count = Math.min(MAX_HITS, ex.gf_analyze(px, take.length, sampleRate, pr, po, MAX_HITS, pf, beatCentreBpm, pb, MAX_BEATS, pn, pn + 4));
    const rows = new Float32Array(ex.memory.buffer, po, stride * count).slice();
    const f0 = new Float32Array(ex.memory.buffer, pf, frames).slice();
    const beatCount = Math.min(MAX_BEATS, new Int32Array(ex.memory.buffer, pn, 1)[0]);
    const beats = Array.from(new Float32Array(ex.memory.buffer, pb, beatCount));
    const bpm = new Float32Array(ex.memory.buffer, pn + 4, 1)[0];
    for (const p of [px, pr, po, pf, pb, pn]) if (p) ex.gf_free(p);
    self.postMessage({ id, rows, f0, beats, bpm }, [rows.buffer, f0.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e) });
  }
};
