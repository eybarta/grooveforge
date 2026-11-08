import type { DrumLane } from "@/song/types";

/** A labelled hit in a golden take. Hit classes = the drum lanes (rim, click, clap… are labelled `perc`). */
export interface LabelledHit {
  /** Seconds from the start of the WAV. */
  t: number;
  class: DrumLane;
}

/** Golden take labels: golden/takes/<name>.json next to <name>.wav (schema in golden/README.md). */
export interface TakeLabels {
  version: 1;
  performer: string;
  device: string;
  /** "teach": a "teach me your kit" session (examples of each sound), the kit the performer's takes are classified with. */
  kind?: "take" | "teach";
  bpm?: number;
  /** Seconds of count-in (clicks) at the start of the WAV: the take's bar 1 starts here (app takes). */
  countInSec?: number;
  hits: LabelledHit[];
  /** Hummed segments for the 808 tracker (Phase 2); midi optional. */
  hum: { start: number; end: number; midi?: number }[];
}

const CLASSES: readonly DrumLane[] = ["kick", "snare", "hatClosed", "hatOpen", "perc"];

/** Hand-written labels are a trust boundary: reject anything malformed with a message that says where. */
export function parseTakeLabels(raw: unknown, durationSec: number, name: string): TakeLabels {
  const fail = (msg: string): never => { throw new Error(`golden/takes/${name}.json: ${msg}`); };
  const j = raw as Partial<TakeLabels>;
  if (j?.version !== 1) fail("version must be 1");
  if (typeof j.performer !== "string" || typeof j.device !== "string") fail("performer and device are required strings");
  if (!Array.isArray(j.hits) || j.hits.length === 0) fail("hits must be a non-empty array");
  if (!Array.isArray(j.hum)) fail("hum must be an array (can be empty)");
  j.hits!.forEach((h, i) => {
    if (!CLASSES.includes(h.class)) fail(`hits[${i}].class "${h.class}" is not one of ${CLASSES.join(", ")}`);
    if (!(h.t >= 0 && h.t <= durationSec)) fail(`hits[${i}].t ${h.t} is outside the ${durationSec.toFixed(2)} s WAV`);
    if (i > 0 && h.t < j.hits![i - 1]!.t) fail(`hits must be sorted by t (hits[${i}])`);
  });
  j.hum!.forEach((s, i) => {
    if (!(s.start >= 0 && s.end > s.start && s.end <= durationSec)) fail(`hum[${i}] has an invalid start/end`);
  });
  return j as TakeLabels;
}

export interface HitScore {
  tp: number;
  fp: number;
  fn: number;
  /** Matched hits whose class is right. */
  classCorrect: number;
}

/**
 * Onset matching within ±tolerance (default 30 ms, as in the quality bar). Two-pointer greedy on sorted onsets,
 * which gives a maximum matching for 1-D windows (the same counts as mir_eval.onset.f_measure). Then, without
 * changing how many are matched, pairs are re-paired where that makes classes agree: when two labels fall within
 * tolerance of one detection (a kick and a hat 1 ms apart), the detection counts against the label it names, not
 * against whichever came first in time.
 */
export function scoreHits(ref: LabelledHit[], est: LabelledHit[], toleranceSec = 0.03): HitScore {
  const r = [...ref].sort((a, b) => a.t - b.t);
  const e = [...est].sort((a, b) => a.t - b.t);
  const near = (a: LabelledHit, b: LabelledHit) => Math.abs(a.t - b.t) <= toleranceSec + 1e-9; // 1 ns: 0.07 − 0.04 > 0.03 in floating point
  const pairOf = new Array<number>(e.length).fill(-1); // est → ref
  let i = 0, j = 0;
  while (i < r.length && j < e.length) {
    if (near(e[j]!, r[i]!)) pairOf[j++] = i++;
    else if (e[j]!.t < r[i]!.t) j++;
    else i++;
  }
  const taken = new Set(pairOf.filter((p) => p >= 0));
  for (let a = 0; a < e.length; a++) {
    const ra = pairOf[a]!;
    if (ra < 0 || e[a]!.class === r[ra]!.class) continue;
    // an unmatched label it names, within tolerance: take that one instead (the other becomes the miss)
    const free = r.findIndex((x, k) => !taken.has(k) && x.class === e[a]!.class && near(x, e[a]!));
    if (free >= 0) {
      taken.delete(ra);
      taken.add(free);
      pairOf[a] = free;
      continue;
    }
    // or swap with a neighbour so both pairs agree (both still within tolerance)
    for (let b = 0; b < e.length; b++) {
      const rb = pairOf[b]!;
      if (b === a || rb < 0 || e[b]!.class === r[rb]!.class) continue;
      if (e[a]!.class === r[rb]!.class && near(e[a]!, r[rb]!) && near(e[b]!, r[ra]!)) {
        pairOf[a] = rb;
        pairOf[b] = ra;
        break;
      }
    }
  }
  const tp = pairOf.filter((p) => p >= 0).length;
  const classCorrect = pairOf.filter((p, k) => p >= 0 && e[k]!.class === r[p]!.class).length;
  return { tp, fp: e.length - tp, fn: r.length - tp, classCorrect };
}

export function summarizeScore(s: HitScore) {
  const precision = s.tp + s.fp ? s.tp / (s.tp + s.fp) : 0;
  const recall = s.tp + s.fn ? s.tp / (s.tp + s.fn) : 0;
  return {
    precision,
    recall,
    onsetF1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    classAccuracy: s.tp ? s.classCorrect / s.tp : 0,
  };
}

export const addScores = (a: HitScore, b: HitScore): HitScore => ({
  tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn, classCorrect: a.classCorrect + b.classCorrect,
});
