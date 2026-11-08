/// <reference types="node" />
import type { LabelledHit } from "../src/analysis/golden.ts";
import { analyzeChannel } from "../reference/poc-audio/analyze.ts";

/**
 * The detector the golden takes score, and the one golden:prelabel guesses with. P0/P1 = the POC heuristics
 * (reference/, never app code); Phase 2 swaps in the engine's analysis here.
 */
export const DETECTOR = "poc-heuristics";
export function detect(samples: Float32Array, sampleRate: number): LabelledHit[] {
  return analyzeChannel(samples, sampleRate).hits.map((h) => ({ t: h.time, class: h.lane === "hat" ? "hatClosed" : h.lane }));
}
