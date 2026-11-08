/// <reference types="node" />
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeWav } from "@/audio/wav";
import type { DetectedHit } from "@/analysis/analyze";
import type { Kit } from "@/analysis/classify";
import { addScores, matchHits, parseTakeLabels, scoreHits, summarizeScore, type HitScore, type TakeLabels } from "@/analysis/golden";
import { takeToSong } from "@/analysis/takeToSong";
import { noteTimeSec } from "@/song/time";
import type { DrumLane } from "@/song/types";
import { classifyHits, DETECTOR, findHits, goldenKits } from "./detect.ts";

const DIR = new URL("./takes/", import.meta.url);
const BASELINE = new URL("./baseline.json", import.meta.url);
const SLACK = 0.005; // a drop larger than this fails CI
const r3 = (x: number) => Math.round(x * 1000) / 1000;

type Scores = ReturnType<typeof summarizeScore> & { timingMs?: number; timingP95Ms?: number; songRecall?: number };

/**
 * Timing error: the take becomes a song (src/analysis/takeToSong.ts) and each matched hit is played where the song
 * plays it at quantize 0 (the user's own feel), vs its labelled onset, in ms. Quantize blends linearly toward the
 * grid, so at any knob setting q the error is (1 − q) × this: quantize 0 is the worst case.
 * songRecall: the share of labelled hits that are still a note in the song (rolls, dedupe).
 */
function timing(labels: TakeLabels, hits: DetectedHit[], kit: Kit) {
  const c = labels.countInSec!, s16 = 60 / labels.bpm! / 4;
  const last = Math.max(...labels.hits.map((h) => h.t)) - c;
  const bars = ([2, 4, 8] as const).find((b) => b * 16 * s16 > last + s16 / 2) ?? 8;
  const song = takeToSong(hits, kit, { bpm: labels.bpm!, bars, mood: "boomBap", countInSec: c });
  const feel = { ...song, quantize: 0 };
  const played = song.tracks[0]!.notes.map((n) => ({ t: c + noteTimeSec(n, feel), class: n.lane as DrumLane })); // a drum track
  const pairs = matchHits(labels.hits, played).pairs;
  return { errMs: pairs.map(([l, p]) => Math.abs(p.t - l.t) * 1000), songRecall: pairs.length / labels.hits.length };
}
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const p95 = (x: number[]) => [...x].sort((a, b) => a - b)[Math.min(x.length - 1, Math.floor(x.length * 0.95))]!;

// The detector runs the engine's WASM build: CI builds it; locally `npm run build:wasm`.
describe("golden takes", () => {
  const names = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const kits = goldenKits(); // each performer's "teach me your kit" session
  const perTake: Record<string, Scores> = {};
  let total: HitScore = { tp: 0, fp: 0, fn: 0, classCorrect: 0 };
  const errMs: number[] = [];
  let kept = 0, labelled = 0;

  it.each(names)("%s: labels are valid and the take scores", (name) => {
    const { samples, sampleRate } = decodeWav(readFileSync(new URL(`${name}.wav`, DIR)));
    expect(sampleRate).toBe(48000);
    const labels = parseTakeLabels(JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8")), samples.length / sampleRate, name);
    if (labels.kind === "teach") return; // a kit, not a take to score
    const kit = kits.get(labels.performer);
    expect(kit, `no teach take for performer "${labels.performer}" (golden/README.md)`).toBeDefined();
    const hits = findHits(samples, sampleRate);
    const s = scoreHits(labels.hits, classifyHits(hits, kit!));
    total = addScores(total, s);
    perTake[name] = summarizeScore(s);
    if (labels.bpm && labels.countInSec !== undefined) {
      const t = timing(labels, hits, kit!);
      errMs.push(...t.errMs);
      kept += t.songRecall * labels.hits.length;
      labelled += labels.hits.length;
      perTake[name] = { ...perTake[name]!, timingMs: mean(t.errMs), timingP95Ms: p95(t.errMs), songRecall: t.songRecall };
    }
  });

  it("does not regress below golden/baseline.json", () => {
    const now = { ...summarizeScore(total), timingMs: mean(errMs), timingP95Ms: p95(errMs), songRecall: kept / labelled, perTake };
    const rounded = JSON.parse(JSON.stringify(now, (_, v) => (typeof v === "number" ? r3(v) : v)));
    console.table({ total: rounded.onsetF1 !== undefined ? { onsetF1: rounded.onsetF1, classAccuracy: rounded.classAccuracy, timingMs: rounded.timingMs, songRecall: rounded.songRecall } : {}, ...Object.fromEntries(Object.entries(rounded.perTake as Record<string, Scores>).map(([k, v]) => [k, { onsetF1: v.onsetF1, classAccuracy: v.classAccuracy, timingMs: v.timingMs, songRecall: v.songRecall }])) });

    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(BASELINE, JSON.stringify({ detector: DETECTOR, ...rounded }, null, 2) + "\n");
      return;
    }
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Scores;
    expect(now.onsetF1).toBeGreaterThanOrEqual(base.onsetF1 - SLACK);
    expect(now.classAccuracy).toBeGreaterThanOrEqual(base.classAccuracy - SLACK);
    if (base.timingMs !== undefined) expect(now.timingMs).toBeLessThanOrEqual(base.timingMs + 0.5); // ms
    if (base.songRecall !== undefined) expect(now.songRecall).toBeGreaterThanOrEqual(base.songRecall - SLACK);
  });
});
