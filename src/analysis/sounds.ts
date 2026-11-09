/**
 * Untaught hit classes from the take itself (P2 re-scope, Eyal 2026-11-09). A person repeats the same few mouth sounds
 * in a take, so its hits are grouped by sound (k-means on the features standardised within the take), and each group
 * is named by where it sits among the take's sounds, against class centres learned the same way from other people
 * (the AVP dataset: assets/kits/generic-kit.json). A fix relabels the whole group.
 * On the 28 AVP strangers (golden/avp.test.ts): groups are 87 % pure, naming gets ~0.56 (published user-agnostic best
 * is ~0.73, on easier isolated sounds), and one tap per wrongly named sound brings it to ~0.87.
 */
import type { DrumLane } from "@/song/types";
import { classify, type Kit } from "./classify";

/** Class centres in take-standardised feature space (each take z-scored within itself). */
export interface SoundKit { classes: DrumLane[]; centres: number[][] }
export interface Sound { cls: DrumLane; confidence: number; group: number }

/** Groups per take: kick, snare, closed and open hat (a take using fewer sounds just splits one; naming copes). */
export const SOUND_GROUPS = 4;

const mean = (xs: number[][]) => xs[0]!.map((_, i) => xs.reduce((s, x) => s + x[i]!, 0) / xs.length);
const dist2 = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0);

/** Each feature z-scored across the take's hits (a feature that doesn't vary stays 0). */
export function standardise(features: number[][]): number[][] {
  if (!features.length) return [];
  const m = mean(features);
  const s = m.map((mu, i) => Math.sqrt(features.reduce((acc, f) => acc + (f[i]! - mu) ** 2, 0) / features.length) || 1);
  return features.map((f) => f.map((v, i) => (v - m[i]!) / s[i]!));
}

/** k-means (k-means++ seeding, a fixed seed so a take always groups the same way; best of 8 starts by squared error). */
export function groupSounds(z: number[][], k = SOUND_GROUPS): number[] {
  const n = z.length;
  k = Math.min(k, n);
  if (k <= 1) return new Array<number>(n).fill(0);
  let seed = 0x9e3779b9;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let best = { groups: new Array<number>(n).fill(0), err: Infinity };
  for (let start = 0; start < 8; start++) {
    const centres = [z[Math.floor(rand() * n)]!];
    while (centres.length < k) {
      const d = z.map((x) => Math.min(...centres.map((c) => dist2(c, x))));
      let u = rand() * d.reduce((a, b) => a + b, 0), j = 0;
      while (j < n - 1 && u >= d[j]!) u -= d[j++]!;
      centres.push(z[j]!);
    }
    let groups = new Array<number>(n).fill(-1);
    for (let it = 0; it < 100; it++) {
      const next = z.map((x) => centres.reduce((bi, c, i) => (dist2(c, x) < dist2(centres[bi]!, x) ? i : bi), 0));
      if (next.every((g, i) => g === groups[i])) break;
      groups = next;
      for (let c = 0; c < k; c++) {
        const members = z.filter((_, i) => groups[i] === c);
        if (members.length) centres[c] = mean(members);
      }
    }
    const err = z.reduce((s, x, i) => s + dist2(centres[groups[i]!]!, x), 0);
    if (err < best.err) best = { groups, err };
  }
  return best.groups;
}

/** Class centres from labelled takes, each standardised within itself (as nameSounds sees a take). */
export function soundKit(takes: { features: number[][]; classes: DrumLane[] }[]): SoundKit {
  const by = new Map<DrumLane, number[][]>();
  for (const take of takes) {
    standardise(take.features).forEach((z, i) => {
      const c = take.classes[i]!;
      by.set(c, [...(by.get(c) ?? []), z]);
    });
  }
  const classes = [...by.keys()];
  return { classes, centres: classes.map((c) => mean(by.get(c)!)) };
}

/** A user kit covering these is complete enough to name each hit on its own (k-NN per hit beats group votes then). */
const CORE: readonly DrumLane[] = ["kick", "snare", "hatClosed"];

/**
 * Each hit's class and its group. Untaught: the group centre's nearest class centre (confidence = 1 − nearest /
 * second nearest distance). With the user's own kit (taught, or from their fixes):
 * - covering kick, snare and closed hat: each hit by k-NN on its own (src/analysis/classify.ts);
 * - covering ≥ 2 sounds: the group's majority vote when ≥ 60 % agree (confidence = that share), else untaught.
 */
export function nameSounds(features: number[][], kit: SoundKit, user: Kit | null = null): Sound[] {
  const z = standardise(features);
  const groups = groupSounds(z);
  const userClasses = new Set(user?.templates.map((t) => t.cls));
  if (user && CORE.every((c) => userClasses.has(c))) return features.map((f, i) => ({ ...classify(f, user), group: groups[i]! }));
  const named = new Map<number, { cls: DrumLane; confidence: number }>();
  for (const g of new Set(groups)) {
    const idx = groups.flatMap((x, i) => (x === g ? [i] : []));
    if (user && userClasses.size >= 2) {
      const votes = new Map<DrumLane, number>();
      for (const i of idx) {
        const c = classify(features[i]!, user).cls;
        votes.set(c, (votes.get(c) ?? 0) + 1);
      }
      const [cls, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]!;
      if (n / idx.length >= 0.6) {
        named.set(g, { cls, confidence: n / idx.length });
        continue;
      }
    }
    const centre = mean(idx.map((i) => z[i]!));
    const d = kit.centres.map((c, i) => ({ cls: kit.classes[i]!, d: Math.sqrt(dist2(c, centre)) })).sort((a, b) => a.d - b.d);
    named.set(g, { cls: d[0]!.cls, confidence: d.length > 1 ? Math.max(0, 1 - d[0]!.d / Math.max(d[1]!.d, 1e-9)) : 1 });
  }
  return groups.map((g) => ({ ...named.get(g)!, group: g }));
}
