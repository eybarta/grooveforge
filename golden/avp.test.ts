/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeKit } from "@/analysis/classify";
import { addScores, scoreHits, summarizeScore, type HitScore } from "@/analysis/golden";
import { decodeWav } from "@/audio/wav";
import { AVP_DIR, avpAudio, avpLabels, avpPeople } from "./avp.ts";
import { classifyHits, DETECTOR, hitsCached, templatesFrom } from "./detect.ts";

const BASELINE = new URL("./avp-baseline.json", import.meta.url);
const SLACK = 0.005; // a drop larger than this fails CI
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const people = avpPeople();

// CI always has the dataset (.github/workflows/ci.yml downloads it); locally it's optional (golden/README.md)
describe.skipIf(!people.length && !process.env.CI)(`AVP dataset (${AVP_DIR})`, () => {
  it("is all there: 28 people", () => expect(people.length).toBe(28));

  /**
   * Untaught, for a stranger (CLAUDE.md quality bar): each person's groove is classified with a kit made from the
   * OTHER 27 people's sounds (leave-one-person-out), so nobody's own voice is in the kit that scores them.
   */
  it("untaught across people: onset F1 on the 28 grooves, class accuracy with the other people's kit", () => {
    const hits = (file: string) => hitsCached(file, () => avpAudio(file));
    const data = people.map((p) => ({
      id: p.id,
      templates: p.sounds.flatMap((file) => templatesFrom(hits(file), { hits: avpLabels(file) })),
      labels: avpLabels(p.groove),
      hits: hits(p.groove),
    }));
    let total: HitScore = { tp: 0, fp: 0, fn: 0, classCorrect: 0 };
    const perPerson: Record<string, { onsetF1: number; classAccuracy: number }> = {};
    for (const d of data) {
      const kit = makeKit(data.filter((o) => o.id !== d.id).flatMap((o) => o.templates));
      const s = scoreHits(d.labels, classifyHits(d.hits, kit));
      total = addScores(total, s);
      const { onsetF1, classAccuracy } = summarizeScore(s);
      perPerson[`P${d.id}`] = { onsetF1: r3(onsetF1), classAccuracy: r3(classAccuracy) };
    }
    const { onsetF1, classAccuracy } = summarizeScore(total);
    const worst = Object.entries(perPerson).reduce((a, b) => (b[1].classAccuracy < a[1].classAccuracy ? b : a));
    const now = { detector: DETECTOR, onsetF1: r3(onsetF1), classAccuracy: r3(classAccuracy), worst: { person: worst[0], ...worst[1] }, perPerson };
    console.table({ total: { onsetF1: now.onsetF1, classAccuracy: now.classAccuracy }, ...perPerson });

    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(BASELINE, JSON.stringify(now, null, 2) + "\n");
      return;
    }
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as typeof now;
    expect(now.onsetF1).toBeGreaterThanOrEqual(base.onsetF1 - SLACK);
    expect(now.classAccuracy).toBeGreaterThanOrEqual(base.classAccuracy - SLACK);
  }, 600_000);

  /**
   * The generic kit comes from these 44.1 kHz recordings; phones capture at 48 kHz. Resampled by sox (CI installs it),
   * the same hits must keep their features: no systematic shift, and per-hit jitter well inside each feature's spread.
   */
  it("gives the same hit features at 48 kHz as at 44.1 kHz", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gf-avp48-"));
    try {
      const shifts: number[][] = [], all: number[][] = [];
      for (const file of people.slice(0, 4).flatMap((p) => [...p.sounds, p.groove])) {
        const hb = hitsCached(`${file}@48000`, () => {
          const out = join(tmp, `${basename(file)}.wav`);
          execFileSync("sox", [`${file}.wav`, "-r", "48000", out]);
          return decodeWav(readFileSync(out));
        });
        for (const h of hitsCached(file, () => avpAudio(file))) {
          all.push(h.features);
          const m = hb.find((x) => Math.abs(x.t - h.t) < 0.005);
          if (m) shifts.push(m.features.map((v, i) => v - h.features[i]!));
        }
      }
      expect(shifts.length).toBeGreaterThan(0.85 * all.length);
      const report = all[0]!.map((_, i) => {
        const mean = all.reduce((s, f) => s + f[i]!, 0) / all.length;
        const std = Math.sqrt(all.reduce((s, f) => s + (f[i]! - mean) ** 2, 0) / all.length);
        const jitter = shifts.map((d) => Math.abs(d[i]!) / std).sort((x, y) => x - y);
        return { bias: r3(shifts.reduce((s, d) => s + d[i]!, 0) / shifts.length / std), median: r3(jitter[jitter.length >> 1]!) };
      });
      console.table(report); // in units of the feature's spread across the hits
      for (const { bias, median } of report) {
        expect(Math.abs(bias)).toBeLessThan(0.1);
        expect(median).toBeLessThan(0.15);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 300_000);
});
