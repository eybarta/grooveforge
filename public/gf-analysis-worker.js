// Web worker for the engine's take analysis (engine/src/Analysis.cpp via gf-engine.wasm), so the main thread (which
// draws the web app's animations) stays free while a take is analysed. Plain JS like gf-engine-worklet.js: Metro
// doesn't bundle it. Message in: { id, take: Float32Array, reference?: Float32Array, sampleRate } (transferred);
// out: { id, rows: Float32Array } (onset rows, see src/analysis/analyze.ts hitsFromRows) or { id, error }.
const MAX_HITS = 4096;
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
  const { id, take, reference, sampleRate } = data;
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
    const count = Math.min(MAX_HITS, ex.gf_analyze(px, take.length, sampleRate, pr, po, MAX_HITS));
    const rows = new Float32Array(ex.memory.buffer, po, stride * count).slice();
    for (const p of [px, pr, po]) if (p) ex.gf_free(p);
    self.postMessage({ id, rows }, [rows.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e) });
  }
};
