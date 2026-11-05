// AudioWorklet host for the C++ engine (public/gf-engine.wasm). Same engine as the native JSI node.
/* global AudioWorkletProcessor, registerProcessor, sampleRate */
const BLOCK = 128;

class GfEngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasmBytes, captureSeconds } = options.processorOptions;
    // standalone WASM may import a few WASI calls (abort paths); none are used while processing
    const imports = new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) });
    this.ex = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), imports).exports;
    this.ex._initialize?.();
    this.e = this.ex.gf_create(sampleRate, captureSeconds);
    this.inPtr = this.ex.gf_alloc(BLOCK);
    this.outPtr = this.ex.gf_alloc(BLOCK);
    this.port.onmessage = (m) => this.onMessage(m.data);
  }

  heap(ptr, n) {
    return new Float32Array(this.ex.memory.buffer, ptr, n);
  }

  // Every message carries an id and gets one reply, so the main thread can await it (messages run in order).
  onMessage(msg) {
    const { ex, e } = this;
    let reply = {};
    switch (msg.type) {
      case "events": {
        const n = msg.events.length;
        const p = ex.gf_alloc(Math.max(1, n));
        this.heap(p, n).set(msg.events);
        reply.ok = ex.gf_set_events(e, p, n / 4, msg.loopFrames) === 1;
        ex.gf_free(p);
        break;
      }
      case "play": ex.gf_play(e); break;
      case "stop": ex.gf_stop(e); break;
      case "drive": ex.gf_set_drive(e, msg.amount); break;
      case "captureStart": ex.gf_capture_start(e); break;
      case "captureStop": {
        ex.gf_capture_stop(e);
        const n = ex.gf_captured(e);
        reply = {
          input: this.heap(ex.gf_capture_in(e), n).slice(),
          output: this.heap(ex.gf_capture_out(e), n).slice(),
        };
        break;
      }
    }
    this.port.postMessage({ id: msg.id, ...reply });
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const n = out[0].length;
    const mic = inputs[0] && inputs[0][0];
    const inBuf = this.heap(this.inPtr, n);
    if (mic) inBuf.set(mic); else inBuf.fill(0);
    this.ex.gf_process(this.e, this.inPtr, this.outPtr, n);
    const y = this.heap(this.outPtr, n);
    for (const ch of out) ch.set(y);
    return true;
  }
}

registerProcessor("gf-engine", GfEngineProcessor);
