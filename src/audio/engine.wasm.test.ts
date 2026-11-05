import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { songToEngineEvents } from "@/song/time";
import { HOST_REFERENCE, loopSong } from "./spikeSongs";
import { fingerprint } from "./wav";

const WASM = "public/gf-engine.wasm";

// CI always builds the WASM first; locally run `npm run build:wasm`.
describe.skipIf(!existsSync(WASM) && !process.env.CI)("WASM engine", () => {
  it("renders the spike loop exactly like the native host build", () => {
    const stub = new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) });
    const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), stub).exports as any;
    ex._initialize?.();
    const e = ex.gf_create(48000, 1);
    const { events, loopFrames } = songToEngineEvents(loopSong(), 48000);
    const p = ex.gf_alloc(events.length);
    new Float32Array(ex.memory.buffer, p, events.length).set(events);
    expect(ex.gf_set_events(e, p, events.length / 4, loopFrames)).toBe(1);
    ex.gf_play(e);

    const out = new Float32Array(loopFrames);
    const buf = ex.gf_alloc(128);
    for (let i = 0; i < loopFrames; i += 128) {
      const n = Math.min(128, loopFrames - i);
      ex.gf_process(e, 0, buf, n);
      out.set(new Float32Array(ex.memory.buffer, buf, n), i);
    }
    const f = fingerprint(out);
    expect(f.frames).toBe(HOST_REFERENCE.frames);
    expect(f.meanAbs).toBeCloseTo(HOST_REFERENCE.meanAbs, 5);
    expect(f.peak).toBeCloseTo(HOST_REFERENCE.peak, 5);
  });
});
