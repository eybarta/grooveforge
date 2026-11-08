/// <reference types="node" />
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeWav } from "@/audio/wav";
import { addScores, parseTakeLabels, scoreHits, summarizeScore, type HitScore } from "@/analysis/golden";
import { DETECTOR, detect } from "./detect.ts";

const DIR = new URL("./takes/", import.meta.url);
const BASELINE = new URL("./baseline.json", import.meta.url);
const SLACK = 0.005; // a drop larger than this fails CI
const r3 = (x: number) => Math.round(x * 1000) / 1000;

type Scores = ReturnType<typeof summarizeScore>;

describe("golden takes", () => {
  const names = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const perTake: Record<string, Scores> = {};
  let total: HitScore = { tp: 0, fp: 0, fn: 0, classCorrect: 0 };

  it.each(names)("%s: labels are valid and the take scores", (name) => {
    const { samples, sampleRate } = decodeWav(readFileSync(new URL(`${name}.wav`, DIR)));
    expect(sampleRate).toBe(48000);
    const labels = parseTakeLabels(JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8")), samples.length / sampleRate, name);
    const s = scoreHits(labels.hits, detect(samples, sampleRate));
    total = addScores(total, s);
    perTake[name] = summarizeScore(s);
  });

  it("does not regress below golden/baseline.json", () => {
    const now = { ...summarizeScore(total), perTake };
    const rounded = JSON.parse(JSON.stringify(now, (_, v) => (typeof v === "number" ? r3(v) : v)));
    console.table({ total: rounded.onsetF1 !== undefined ? { onsetF1: rounded.onsetF1, classAccuracy: rounded.classAccuracy } : {}, ...Object.fromEntries(Object.entries(rounded.perTake as Record<string, Scores>).map(([k, v]) => [k, { onsetF1: v.onsetF1, classAccuracy: v.classAccuracy }])) });

    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(BASELINE, JSON.stringify({ detector: DETECTOR, ...rounded }, null, 2) + "\n");
      return;
    }
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Scores;
    expect(now.onsetF1).toBeGreaterThanOrEqual(base.onsetF1 - SLACK);
    expect(now.classAccuracy).toBeGreaterThanOrEqual(base.classAccuracy - SLACK);
  });
});
