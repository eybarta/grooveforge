import type { GfWasm } from "@/audio/wasmEngine";

/** Features per hit (gf::kHitFeatures, engine/include/gf/Analysis.h: MFCCs, centroid, flatness, decay, ZCR, low/high). */
export const HIT_FEATURES = 18;

/** Input samples per pitch frame (gf::kPitchHop, engine/include/gf/Pitch.h). */
export const PITCH_HOP = 512;

/** A drum hit found in a take (engine/src/Analysis.cpp): where it starts, how strong, and what it sounds like. */
export interface DetectedHit {
  t: number;
  strength: number;
  features: number[];
}

/** What the engine heard in a take: the drum hits, and the hum's pitch (Hz every `f0Hop` seconds, 0 = unvoiced). */
export interface TakeAnalysis {
  hits: DetectedHit[];
  f0: Float32Array;
  f0Hop: number;
}

const MAX_HITS = 4096;

/**
 * The engine's take analysis through its WASM build: HPSS + SuperFlux onsets + per-hit features. `reference` = what
 * the engine played during the take (its output capture), on the take's timeline, so the metronome bleed is removed.
 */
export function analyzeTake(w: GfWasm, samples: Float32Array, sampleRate: number, reference?: Float32Array): TakeAnalysis {
  const { ex, heap, put } = w;
  const stride = ex.gf_onset_stride() as number;
  if (stride !== 2 + HIT_FEATURES) throw new Error(`engine onset rows are ${stride} floats; this build expects ${2 + HIT_FEATURES}`);
  if (ex.gf_pitch_hop() !== PITCH_HOP) throw new Error(`engine pitch hop is ${ex.gf_pitch_hop()}; this build expects ${PITCH_HOP}`);
  const frames = pitchFrames(samples.length);
  const px = put(samples);
  const pr = reference ? put(reference.length === samples.length ? reference : fit(reference, samples.length)) : 0;
  const po = ex.gf_alloc(stride * MAX_HITS), pf = ex.gf_alloc(frames);
  try {
    const count = Math.min(MAX_HITS, ex.gf_analyze(px, samples.length, sampleRate, pr, po, MAX_HITS, pf) as number);
    return fromEngine(heap(po, stride * count), heap(pf, frames).slice(), sampleRate);
  } finally {
    for (const p of [px, pr, po, pf]) if (p) ex.gf_free(p);
  }
}

export const pitchFrames = (samples: number) => Math.floor(samples / PITCH_HOP) + 1;

/** The engine's onset rows + pitch track → TakeAnalysis: shared by WASM, the web worker and JSI. */
export const fromEngine = (rows: ArrayLike<number>, f0: Float32Array, sampleRate: number): TakeAnalysis =>
  ({ hits: hitsFromRows(rows), f0, f0Hop: PITCH_HOP / sampleRate });

/** Onset rows [time, strength, HIT_FEATURES features] (flattened) → hits: shared by WASM, the web worker and JSI. */
export function hitsFromRows(rows: ArrayLike<number>): DetectedHit[] {
  const stride = 2 + HIT_FEATURES;
  return Array.from({ length: Math.floor(rows.length / stride) }, (_, i) => ({
    t: rows[i * stride]!,
    strength: rows[i * stride + 1]!,
    features: Array.from({ length: HIT_FEATURES }, (_, f) => rows[i * stride + 2 + f]!),
  }));
}

/** The reference cut or zero-padded to the take's length. */
function fit(x: Float32Array, n: number) {
  const out = new Float32Array(n);
  out.set(x.subarray(0, n));
  return out;
}
