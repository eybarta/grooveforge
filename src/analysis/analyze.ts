import type { GfWasm } from "@/audio/wasmEngine";

/** Features per hit (gf::kHitFeatures, engine/include/gf/Analysis.h: MFCCs, centroid, flatness, decay, ZCR, low/high). */
export const HIT_FEATURES = 18;

/** A drum hit found in a take (engine/src/Analysis.cpp): where it starts, how strong, and what it sounds like. */
export interface DetectedHit {
  t: number;
  strength: number;
  features: number[];
}

const MAX_HITS = 4096;

/**
 * The engine's take analysis through its WASM build: HPSS + SuperFlux onsets + per-hit features. `reference` = what
 * the engine played during the take (its output capture), on the take's timeline, so the metronome bleed is removed.
 */
export function analyzeTake(w: GfWasm, samples: Float32Array, sampleRate: number, reference?: Float32Array): DetectedHit[] {
  const { ex, heap, put } = w;
  const stride = ex.gf_onset_stride() as number;
  if (stride !== 2 + HIT_FEATURES) throw new Error(`engine onset rows are ${stride} floats; this build expects ${2 + HIT_FEATURES}`);
  const px = put(samples);
  const pr = reference ? put(reference.length === samples.length ? reference : fit(reference, samples.length)) : 0;
  const po = ex.gf_alloc(stride * MAX_HITS);
  try {
    const count = Math.min(MAX_HITS, ex.gf_analyze(px, samples.length, sampleRate, pr, po, MAX_HITS) as number);
    return hitsFromRows(heap(po, stride * count));
  } finally {
    for (const p of [px, pr, po]) if (p) ex.gf_free(p);
  }
}

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
