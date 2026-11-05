import { analyzeChannel } from "./analyze.ts";
import type { DrumLane, HitEvent } from "./music.ts";
import { stepsFromAnalysis } from "./pattern.ts";

export interface DemoGroove {
  sampleRate: number;
  samples: Float32Array;
  micSteps: HitEvent[][];
  bpm: number;
  bars: number;
  script: { step: number; lane: DrumLane }[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addKick(data: Float32Array, sr: number, start: number, rand: () => number, gain: number) {
  const n = Math.floor(sr * 0.22);
  let phase = 0;
  for (let i = 0; i < n && start + i < data.length; i++) {
    const t = i / sr;
    const f = 52 + 90 * Math.exp(-t * 70);
    phase += (2 * Math.PI * f) / sr;
    const body = Math.sin(phase) * Math.exp(-t * 9);
    const click = (rand() * 2 - 1) * Math.exp(-t * 180) * 0.12;
    data[start + i] = (data[start + i] ?? 0) + (body + click) * gain;
  }
}

function addSnare(data: Float32Array, sr: number, start: number, rand: () => number, gain: number) {
  const n = Math.floor(sr * 0.22);
  let phase = 0;
  let band = 0;
  for (let i = 0; i < n && start + i < data.length; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * 188) / sr;
    const noise = rand() * 2 - 1;
    band = band * 0.62 + noise * 0.38;
    const env = Math.exp(-t * 6.5);
    data[start + i] =
      (data[start + i] ?? 0) + (band * 0.75 + Math.sin(phase) * 0.42) * env * gain;
  }
}

function addHat(data: Float32Array, sr: number, start: number, rand: () => number, gain: number) {
  const n = Math.floor(sr * 0.045);
  let prev = 0;
  for (let i = 0; i < n && start + i < data.length; i++) {
    const t = i / sr;
    const noise = rand() * 2 - 1;
    const hp = noise - prev;
    prev = noise;
    data[start + i] = (data[start + i] ?? 0) + hp * Math.exp(-t * 95) * gain;
  }
}

function addPerc(data: Float32Array, sr: number, start: number, _rand: () => number, gain: number) {
  const n = Math.floor(sr * 0.11);
  let phase = 0;
  for (let i = 0; i < n && start + i < data.length; i++) {
    const t = i / sr;
    const f = 170 + 160 * Math.exp(-t * 22);
    phase += (2 * Math.PI * f) / sr;
    data[start + i] = (data[start + i] ?? 0) + Math.sin(phase) * Math.exp(-t * 24) * gain;
  }
}

const SCRIPT: { step: number; lane: DrumLane; gain: number }[] = [
  { step: 0, lane: "kick", gain: 1 },
  { step: 2, lane: "hat", gain: 0.7 },
  { step: 4, lane: "snare", gain: 0.95 },
  { step: 6, lane: "hat", gain: 0.55 },
  { step: 7, lane: "perc", gain: 0.7 },
  { step: 8, lane: "kick", gain: 0.92 },
  { step: 10, lane: "hat", gain: 0.62 },
  { step: 12, lane: "snare", gain: 0.9 },
  { step: 14, lane: "hat", gain: 0.5 },
  { step: 16, lane: "kick", gain: 1 },
  { step: 18, lane: "hat", gain: 0.66 },
  { step: 19, lane: "kick", gain: 0.72 },
  { step: 20, lane: "snare", gain: 0.95 },
  { step: 22, lane: "hat", gain: 0.5 },
  { step: 24, lane: "kick", gain: 0.9 },
  { step: 26, lane: "hat", gain: 0.6 },
  { step: 27, lane: "perc", gain: 0.66 },
  { step: 28, lane: "snare", gain: 0.88 },
  { step: 30, lane: "hat", gain: 0.48 },
  { step: 31, lane: "hat", gain: 0.4 },
];

let cached: DemoGroove | null = null;

export function getDemoGroove(): DemoGroove {
  if (cached) return cached;
  const sampleRate = 44100;
  const bpm = 96;
  const stepDur = 60 / bpm / 4;
  const bars = 2;
  const tail = 0.35;
  const length = Math.floor(sampleRate * (bars * 4 * (60 / bpm) + tail));
  const samples = new Float32Array(length);
  const rand = mulberry32(20261026);
  for (const hit of SCRIPT) {
    const start = Math.floor(hit.step * stepDur * sampleRate);
    if (hit.lane === "kick") addKick(samples, sampleRate, start, rand, hit.gain);
    else if (hit.lane === "snare") addSnare(samples, sampleRate, start, rand, hit.gain);
    else if (hit.lane === "hat") addHat(samples, sampleRate, start, rand, hit.gain);
    else addPerc(samples, sampleRate, start, rand, hit.gain);
  }
  const analysis = analyzeChannel(samples, sampleRate);
  const micSteps = stepsFromAnalysis(analysis);
  cached = {
    sampleRate,
    samples,
    micSteps,
    bpm: analysis.bpm,
    bars: analysis.bars,
    script: SCRIPT.map(({ step, lane }) => ({ step, lane })),
  };
  return cached;
}
