// Generates the 2 synthetic golden takes (WAV + labels) so the harness runs before real takes exist.
// Deterministic (seeded), so re-running produces identical files. Run: npm run golden:make
import { writeFileSync } from "node:fs";
import { encodeWav } from "../src/audio/wav.ts";
import type { LabelledHit, TakeLabels } from "../src/analysis/golden.ts";

const SR = 48000;
const OUT = new URL("../golden/takes/", import.meta.url);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** RBJ biquad band/high-pass, enough to shape noise into mouth-sound-like bands. */
function biquad(x: Float32Array, type: "bp" | "hp", f: number, q: number) {
  const w = (2 * Math.PI * f) / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w);
  const [b0, b1, b2] = type === "bp" ? [a, 0, -a] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const [a0, a1, a2] = [1 + a, -2 * c, 1 - a];
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

function makeTake(seed: number) {
  const rand = rng(seed);
  const noise = (n: number) => Float32Array.from({ length: n }, () => rand() * 2 - 1);
  const env = (n: number, tau: number) => Float32Array.from({ length: n }, (_, i) => Math.exp(-i / (tau * SR)));

  // beatbox-ish voicings of each class (not drum samples: these stand in for a mouth)
  const voices: Record<LabelledHit["class"], () => Float32Array> = {
    kick: () => { // lip "b": falling low thump + short click
      const n = Math.round(0.12 * SR), x = new Float32Array(n), e = env(n, 0.04), nz = noise(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        ph += (2 * Math.PI * (50 + 70 * Math.exp(-i / (0.015 * SR)))) / SR;
        x[i] = 0.9 * Math.sin(ph) * e[i]! + (i < 0.003 * SR ? 0.3 * nz[i]! : 0);
      }
      return x;
    },
    snare: () => { // "pf"/"k": 1–4 kHz noise burst + a little body
      const n = Math.round(0.15 * SR), e = env(n, 0.035), x = biquad(noise(n), "bp", 2000, 0.7);
      return x.map((v, i) => (1.6 * v + 0.2 * Math.sin((2 * Math.PI * 190 * i) / SR)) * e[i]!);
    },
    hatClosed: () => { const n = Math.round(0.05 * SR), e = env(n, 0.012); return biquad(noise(n), "hp", 6500, 0.7).map((v, i) => 0.7 * v * e[i]!); },
    hatOpen: () => { const n = Math.round(0.3 * SR), e = env(n, 0.09); return biquad(noise(n), "hp", 5500, 0.7).map((v, i) => 0.55 * v * e[i]!); },
    perc: () => { // tongue click: broadband tick + 1.4 kHz ring
      const n = Math.round(0.04 * SR), e = env(n, 0.006), nz = noise(n);
      return Float32Array.from({ length: n }, (_, i) => (i < 48 ? nz[i]! : 0) + 0.6 * Math.sin((2 * Math.PI * 1400 * i) / SR) * e[i]!);
    },
  };

  return function render(
    bpm: number, bars: number,
    pattern: [beat: number, cls: LabelledHit["class"], vel: number][],
    hum: { startBeat: number; beats: number; midi: number }[],
  ) {
    const beat = 60 / bpm, lead = 0.5;
    const dur = lead + bars * 4 * beat + 0.8;
    const out = noise(Math.round(dur * SR)).map((v) => v * 0.003); // ≈ −50 dBFS room noise
    const hits: LabelledHit[] = [];
    for (const [b, cls, vel] of pattern) {
      const jitter = (rand() + rand() + rand() - 1.5) * 0.012; // human feel, ~±12 ms
      const t = lead + b * beat + jitter;
      const v = voices[cls](), start = Math.round(t * SR), g = vel * (0.85 + 0.3 * rand());
      for (let i = 0; i < v.length && start + i < out.length; i++) out[start + i]! += v[i]! * g;
      hits.push({ t: +(t.toFixed(4)), class: cls });
    }
    const humLabels = hum.map(({ startBeat, beats, midi }) => {
      const s = lead + startBeat * beat, e = s + beats * beat, hz = 440 * 2 ** ((midi - 69) / 12);
      for (let i = Math.round(s * SR); i < Math.round(e * SR); i++) {
        const k = (i - s * SR) / SR, fade = Math.min(1, k / 0.03, (e - i / SR) / 0.03);
        out[i]! += 0.12 * fade * (Math.sin(2 * Math.PI * hz * k) + 0.3 * Math.sin(4 * Math.PI * hz * k));
      }
      return { start: +s.toFixed(4), end: +e.toFixed(4), midi };
    });
    hits.sort((a, b) => a.t - b.t);
    return { samples: out, hits, hum: humLabels };
  };
}

function write(name: string, bpm: number, take: ReturnType<ReturnType<typeof makeTake>>) {
  const labels: TakeLabels = { version: 1, performer: "synthetic", device: "make-synthetic-takes.ts", bpm, hits: take.hits, hum: take.hum };
  writeFileSync(new URL(`${name}.wav`, OUT), encodeWav(take.samples, SR, "16"));
  writeFileSync(new URL(`${name}.json`, OUT), JSON.stringify(labels, null, 2) + "\n");
  console.log(`${name}: ${take.hits.length} hits, ${take.hum.length} hum segments, ${(take.samples.length / SR).toFixed(2)} s`);
}

// Take 1: 90 BPM boom bap, 2 bars — kick 1 & 2-and & 3, snare 2 & 4, closed hats on 8ths.
const boomBap: [number, LabelledHit["class"], number][] = [];
for (let bar = 0; bar < 2; bar++) {
  const o = bar * 4;
  boomBap.push([o, "kick", 1], [o + 1.5, "kick", 0.8], [o + 2, "kick", 0.9], [o + 1, "snare", 1], [o + 3, "snare", 1]);
  for (const e of [0.5, 1.5, 2.5, 3.5]) boomBap.push([o + e, "hatClosed", 0.6]);
}
write("synthetic-boombap-90", 90, makeTake(90)(90, 2, boomBap, []));

// Take 2: 140 BPM trap, 2 bars — 1/32 hat roll, open hat, rim clicks, and a hummed 808 line under bar 1.
const trap: [number, LabelledHit["class"], number][] = [
  [0, "kick", 1], [0.75, "kick", 0.8], [2, "snare", 1], [2.5, "kick", 0.9],
  [4, "kick", 1], [5.75, "kick", 0.8], [6, "snare", 1], [6.75, "perc", 0.7],
  [1.5, "hatOpen", 0.7], [3.25, "perc", 0.6],
];
for (const e of [0, 1, 2, 3, 3.5, 4, 5, 6]) trap.push([e + 0.5, "hatClosed", 0.6]);
for (let k = 0; k < 6; k++) trap.push([7 + k * 0.125, "hatClosed", 0.5]); // the roll: 1/32 notes, 54 ms apart
write("synthetic-trap-140", 140, makeTake(140)(140, 2, trap, [{ startBeat: 0, beats: 1.5, midi: 36 }, { startBeat: 2.5, beats: 1, midi: 39 }]));
