/**
 * Hit classes from the user's own kit ("teach me your kit": a few examples of each sound): k-nearest neighbours on
 * the engine's per-hit features (src/analysis/analyze.ts), each feature scaled by its spread across the kit.
 */
import type { DrumLane } from "@/song/types";

export interface Template { cls: DrumLane; f: number[] }
export interface Kit {
  templates: Template[];
  /** Per-feature centre and spread of the templates (z-scores make MFCCs and the rest comparable). */
  mean: number[];
  std: number[];
}
export interface Classified { cls: DrumLane; confidence: number }

export function makeKit(templates: Template[]): Kit {
  if (!templates.length) throw new Error("makeKit: no templates");
  const d = templates[0]!.f.length;
  const mean = new Array<number>(d).fill(0), std = new Array<number>(d).fill(0);
  for (const t of templates) t.f.forEach((v, i) => (mean[i]! += v / templates.length));
  for (const t of templates) t.f.forEach((v, i) => (std[i]! += (v - mean[i]!) ** 2 / templates.length));
  return { templates, mean, std: std.map((v) => Math.sqrt(v) || 1) };
}

const K = 3;

/**
 * The majority class of the K nearest templates (ties: the nearer). Confidence = 1 − d(best class) / d(nearest other
 * class): ~0 when two classes are equally close (the amber "?"), → 1 when only one class is near.
 */
export function classify(features: number[], kit: Kit): Classified {
  const z = (f: number[]) => f.map((v, i) => (v - kit.mean[i]!) / kit.std[i]!);
  const q = z(features);
  const ranked = kit.templates
    .map((t) => ({ cls: t.cls, d: Math.sqrt(z(t.f).reduce((s, v, i) => s + (v - q[i]!) ** 2, 0)) }))
    .sort((a, b) => a.d - b.d);
  const votes = new Map<DrumLane, { n: number; d: number }>();
  for (const r of ranked.slice(0, K)) {
    const v = votes.get(r.cls) ?? { n: 0, d: r.d };
    votes.set(r.cls, { n: v.n + 1, d: Math.min(v.d, r.d) });
  }
  const cls = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || a[1].d - b[1].d)[0]![0];
  const best = ranked.find((r) => r.cls === cls)!.d;
  const other = ranked.find((r) => r.cls !== cls)?.d ?? Infinity;
  return { cls, confidence: other === Infinity ? 1 : Math.max(0, 1 - best / Math.max(other, 1e-9)) };
}
