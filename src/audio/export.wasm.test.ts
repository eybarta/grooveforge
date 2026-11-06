/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { boomBapDemo, trapDemo } from "@/song/demoGrooves";
import { emptySong } from "@/song/store";
import { LANES, songToEngineEvents } from "@/song/time";
import type { Song } from "@/song/types";
import { KIT_FILES } from "./kit";
import { LOUDNESS_TARGETS, LUFS_TOLERANCE, MAX_TRUE_PEAK_DB, masterTo } from "./master";
import { BUS_FIELDS, DEFAULT_KNOBS, STRIP_FIELDS } from "./mix";
import { studioProgram } from "./studioRender";
import type { EngineProgram } from "./types";

const WASM = "public/gf-engine.wasm";
const SR = 48000;
const EXPORT_LOOPS = 4; // the studio's export: the 2-bar demos → 8 bars
const hasSox = (() => {
  try {
    execFileSync("sox", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

/** The kit decoded by sox (Node has no decodeAudioData): [l, r] per engine slot, mono duplicated like the apps do. */
const decodeKit = () =>
  KIT_FILES.map((f) => {
    const raw = execFileSync("sox", [`assets/kits/hiphop/${f}`, "-t", "f32", "-c", "2", "-r", String(SR), "-"], { maxBuffer: 1 << 28 });
    const x = new Float32Array(new Uint8Array(raw).buffer); // copy: Buffer offsets aren't 4-byte aligned
    const l = new Float32Array(x.length / 2), r = new Float32Array(x.length / 2);
    for (let i = 0; i < l.length; i++) {
      l[i] = x[2 * i]!;
      r[i] = x[2 * i + 1]!;
    }
    return [l, r] as const;
  });

let mod: WebAssembly.Module | undefined;
const stub = new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) });
/** A fresh WASM engine module instance, as the web worklet makes one (public/gf-engine-worklet.js). */
function instance() {
  mod ??= new WebAssembly.Module(readFileSync(WASM));
  const ex = new WebAssembly.Instance(mod, stub).exports as any;
  ex._initialize?.();
  const heap = (p: number, n: number) => new Float32Array(ex.memory.buffer, p, n); // after every alloc: memory may grow
  const put = (x: Float32Array) => {
    const p = ex.gf_alloc(Math.max(1, x.length));
    heap(p, x.length).set(x);
    return p;
  };
  return { ex, heap, put };
}

/** The worklet's job without Web Audio: a fresh engine per render, like the web renderOffline. */
function wasmTools(kit: ReturnType<typeof decodeKit>) {
  const tools = instance();

  const render = (song: Song, p: EngineProgram, frames: number): Float32Array[] => {
    const { ex, heap, put } = instance();
    const e = ex.gf_create(SR, 1);
    kit.forEach(([l, r], slot) => expect(ex.gf_load_sample(e, slot, put(l), put(r), l.length, SR)).toBe(1));
    ex.gf_set_instruments(e, put(p.instruments), p.instruments.length / 8);
    ex.gf_set_zones(e, put(p.zones!), p.zones!.length / 3);
    ex.gf_set_mix(e, put(p.mix!), p.mix!.length);
    const { events, loopFrames } = songToEngineEvents(song, SR);
    ex.gf_set_events(e, put(events), events.length / 6, loopFrames);
    ex.gf_play(e);
    const out = [new Float32Array(frames), new Float32Array(frames)];
    const [pi, pl, pr] = [put(new Float32Array(128)), ex.gf_alloc(128), ex.gf_alloc(128)];
    for (let i = 0; i < frames; i += 128) {
      const n = Math.min(128, frames - i);
      ex.gf_process(e, pi, pl, pr, n);
      out[0]!.set(heap(pl, n), i);
      out[1]!.set(heap(pr, n), i);
    }
    return out;
  };

  const loudness = ([l, r]: Float32Array[]) => {
    const { ex, heap, put } = tools;
    const [pl, pr, po] = [put(l!), put(r!), ex.gf_alloc(2)];
    ex.gf_loudness(pl, pr, l!.length, SR, po);
    const [lufs, truePeakDb] = heap(po, 2);
    for (const p of [pl, pr, po]) ex.gf_free(p);
    return { lufs: lufs!, truePeakDb: truePeakDb! };
  };
  return { render, loudness };
}

// CI builds the WASM and installs sox; locally run `npm run build:wasm` (sox: brew install sox).
describe.skipIf(!(existsSync(WASM) && hasSox) && !process.env.CI)("export bar (CLAUDE.md): target ± 0.5 LU, ≤ −1 dBTP", () => {
  let engine: ReturnType<typeof wasmTools>;
  beforeAll(() => void (engine = wasmTools(decodeKit())));

  it.each([
    ["Boom Bap", boomBapDemo, "loud"],
    ["Boom Bap", boomBapDemo, "streaming"],
    ["Trap", trapDemo, "loud"],
    ["Trap", trapDemo, "streaming"],
  ] as const)("%s demo, 8 bars, %s", async (_, demo, target) => {
    const song = demo();
    const frames = EXPORT_LOOPS * songToEngineEvents(song, SR).loopFrames;
    const m = await masterTo(
      LOUDNESS_TARGETS[target],
      async (g) => engine.render(song, studioProgram(song, DEFAULT_KNOBS, g), frames),
      async (ch) => engine.loudness(ch),
    );
    const r2 = (x: number) => Math.round(x * 100) / 100;
    console.log("[export]", JSON.stringify({ mood: song.mood, target, lufs: r2(m.lufs), truePeakDb: r2(m.truePeakDb), gainDb: r2(m.gainDb), renders: m.renders }));
    expect(Math.abs(m.lufs - LOUDNESS_TARGETS[target])).toBeLessThanOrEqual(LUFS_TOLERANCE);
    expect(m.truePeakDb).toBeLessThanOrEqual(MAX_TRUE_PEAK_DB);
  }, 60_000);
});

describe.skipIf(!existsSync(WASM) && !process.env.CI)("silence after the music (WASM has no flush-to-zero)", () => {
  it("an idle engine decays to exact zeros, never into subnormal floats", () => {
    // one 808 note into the biggest reverb and delay, then silence (the 8-bar loop at 60 BPM is 32 s long)
    const song: Song = {
      ...emptySong(), bpm: 60, bars: 8, mood: "trap",
      tracks: [{ id: "b", kind: "bass", name: "808", gainDb: 0, muted: false, frozen: false,
        notes: [{ id: "n", tick: 0, lane: "bass", velocity: 1, offsetMs: 0, source: "user", pitch: 33, durationTicks: 960 }] }],
    };
    const p = studioProgram(song, { punch: 0.5, space: 1 }, 6);
    const bass = BUS_FIELDS.length + LANES.indexOf("bass") * STRIP_FIELDS.length;
    p.mix![bass + STRIP_FIELDS.indexOf("reverbSend")] = 1;
    p.mix![bass + STRIP_FIELDS.indexOf("delaySend")] = 1;
    const [l, r] = wasmTools([]).render(song, p, 25 * SR);
    expect(songToEngineEvents(song, SR).loopFrames).toBeGreaterThan(l!.length); // nothing retriggers
    const subnormal = (x: number) => x !== 0 && Math.abs(x) < 1.1754944e-38;
    expect(l!.some(subnormal) || r!.some(subnormal)).toBe(false);
    expect(l!.subarray(20 * SR).every((x) => x === 0) && r!.subarray(20 * SR).every((x) => x === 0)).toBe(true);
  });
});
