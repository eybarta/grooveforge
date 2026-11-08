import type { GfWasm } from "@/audio/wasmEngine";

/** A drum hit found in a take (engine/src/Analysis.cpp): where it starts, and how strong. */
export interface DetectedHit {
  t: number;
  strength: number;
}

const MAX_HITS = 4096;

/**
 * The engine's take analysis through its WASM build: HPSS + SuperFlux onsets. `reference` = what the engine played
 * during the take (its output capture), on the take's timeline, so the metronome bleeding into the mic is removed.
 */
export function analyzeTake(w: GfWasm, samples: Float32Array, sampleRate: number, reference?: Float32Array): DetectedHit[] {
  const { ex, heap, put } = w;
  const px = put(samples);
  const pr = reference ? put(reference.length === samples.length ? reference : fit(reference, samples.length)) : 0;
  const po = ex.gf_alloc(2 * MAX_HITS);
  try {
    const count = Math.min(MAX_HITS, ex.gf_analyze(px, samples.length, sampleRate, pr, po, MAX_HITS) as number);
    const rows = heap(po, 2 * count);
    return Array.from({ length: count }, (_, i) => ({ t: rows[2 * i]!, strength: rows[2 * i + 1]! }));
  } finally {
    for (const p of [px, pr, po]) if (p) ex.gf_free(p);
  }
}

/** The reference cut or zero-padded to the take's length. */
function fit(x: Float32Array, n: number) {
  const out = new Float32Array(n);
  out.set(x.subarray(0, n));
  return out;
}
