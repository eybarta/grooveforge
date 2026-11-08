/**
 * An instance of gf-engine.wasm for its stateless tools (analysis, loudness) outside the audio worklet: Node (tests,
 * scripts) and, in the app, a worker. The worklet loads its own (public/gf-engine-worklet.js).
 */
export interface GfWasm {
  ex: any;
  /** A view of `n` floats at pointer `p`: take it after every allocation (memory may grow and move). */
  heap(p: number, n: number): Float32Array;
  /** Copies `x` into fresh WASM memory; free with ex.gf_free. */
  put(x: Float32Array): number;
}

// standalone WASM imports a few WASI functions it never calls for these tools: any function answering 0 will do
const stub = new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) });

export function instantiateEngine(module: WebAssembly.Module): GfWasm {
  const ex = new WebAssembly.Instance(module, stub).exports as any;
  ex._initialize?.();
  const heap = (p: number, n: number) => new Float32Array(ex.memory.buffer, p, n);
  const put = (x: Float32Array) => {
    const p = ex.gf_alloc(Math.max(1, x.length));
    heap(p, x.length).set(x);
    return p;
  };
  return { ex, heap, put };
}
