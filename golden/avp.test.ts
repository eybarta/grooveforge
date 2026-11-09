/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeKit } from "@/analysis/classify";
import { addScores, scoreHits, summarizeScore, type HitScore } from "@/analysis/golden";
import { nameSounds, soundKit, type SoundKit } from "@/analysis/sounds";
import { decodeWav } from "@/audio/wav";
import { AVP_DIR, avpAudio, avpLabels, avpPeople } from "./avp.ts";
import { DETECTOR, hitsCached, scoreSounds, templatesFrom } from "./detect.ts";

const BASELINE = new URL("./avp-baseline.json", import.meta.url);
const GENERIC_KIT = new URL("../assets/kits/generic-kit.json", import.meta.url);
const SLACK = 0.005; // a drop larger than this fails CI
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const people = avpPeople();

/** Each person: their groove's detected hits and labels, its labelled hits' features, and their own sounds' templates. */
let cached: ReturnType<typeof load> | null = null;
function load() {
  const hits = (file: string) => hitsCached(file, () => avpAudio(file));
  return people.map((p) => {
    const groove = hits(p.groove), labels = avpLabels(p.groove);
    return {
      id: p.id, labels, hits: groove,
      own: p.sounds.flatMap((file) => templatesFrom(hits(file), { hits: avpLabels(file) })),
      labelled: templatesFrom(groove, { hits: labels }), // this groove's hits with their true classes
    };
  });
}
const avp = () => (cached ??= load());
const kitFrom = (grooves: ReturnType<typeof load>) => soundKit(grooves.map((o) => ({ features: o.labelled.map((t) => t.f), classes: o.labelled.map((t) => t.cls) })));

// CI always has the dataset (.github/workflows/ci.yml downloads it); locally it's optional (golden/README.md)
describe.skipIf(!people.length && !process.env.CI)(`AVP dataset (${AVP_DIR})`, () => {
  it("is all there: 28 people", () => expect(people.length).toBe(28));

  /**
   * For a stranger (CLAUDE.md quality bar): each person's groove is named (src/analysis/sounds.ts) with sound centres
   * learned from the OTHER 27 people's grooves (leave-one-person-out), so their own voice never helps. Scored as named
   * (untaught), after one tap per wrongly named sound (the gate: ≥ 0.85), and taught (their own sounds as the kit).
   */
  it("onset F1 on the 28 grooves; class accuracy untaught, after one tap per sound, and taught", () => {
    const data = avp();
    let onsets: HitScore = { tp: 0, fp: 0, fn: 0, classCorrect: 0 };
    const sum = { matched: 0, untaught: 0, afterTaps: 0, taps: 0, taught: 0 };
    const perPerson: Record<string, { onsetF1: number; untaught: number; afterTaps: number; taps: number; taught: number }> = {};
    for (const d of data) {
      const kit = kitFrom(data.filter((o) => o.id !== d.id));
      const features = d.hits.map((h) => h.features);
      const untaught = scoreSounds(d.labels, d.hits, nameSounds(features, kit));
      const taught = scoreSounds(d.labels, d.hits, nameSounds(features, kit, makeKit(d.own)));
      const s = scoreHits(d.labels, d.hits.map((h) => ({ t: h.t, class: "kick" }))); // onsets only: classes aside
      onsets = addScores(onsets, s);
      sum.matched += untaught.matched; sum.untaught += untaught.named; sum.afterTaps += untaught.fixed; sum.taps += untaught.taps; sum.taught += taught.named;
      perPerson[`P${d.id}`] = {
        onsetF1: r3(summarizeScore(s).onsetF1), untaught: r3(untaught.named / untaught.matched), afterTaps: r3(untaught.fixed / untaught.matched),
        taps: untaught.taps, taught: r3(taught.named / taught.matched),
      };
    }
    const worst = Object.entries(perPerson).reduce((a, b) => (b[1].afterTaps < a[1].afterTaps ? b : a));
    const now = {
      detector: DETECTOR, onsetF1: r3(summarizeScore(onsets).onsetF1),
      untaught: r3(sum.untaught / sum.matched), afterTaps: r3(sum.afterTaps / sum.matched), tapsPerTake: r3(sum.taps / data.length), taught: r3(sum.taught / sum.matched),
      worst: { person: worst[0], ...worst[1] }, perPerson,
    };
    const { perPerson: _, worst: __, ...total } = now;
    console.table({ total, ...perPerson });

    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(BASELINE, JSON.stringify(now, null, 2) + "\n");
      return;
    }
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as typeof now;
    expect(now.onsetF1).toBeGreaterThanOrEqual(base.onsetF1 - SLACK);
    expect(now.untaught).toBeGreaterThanOrEqual(base.untaught - SLACK);
    expect(now.afterTaps).toBeGreaterThanOrEqual(base.afterTaps - SLACK);
    expect(now.taught).toBeGreaterThanOrEqual(base.taught - SLACK);
    expect(now.tapsPerTake).toBeLessThanOrEqual(base.tapsPerTake + 0.2);
  }, 600_000);

  /** The app's untaught kit (assets/kits/generic-kit.json): sound centres from all 28 grooves, rebuilt on GOLDEN_UPDATE. */
  it("built the committed generic kit from all 28 grooves", () => {
    const kit = kitFrom(avp());
    const rounded: SoundKit = { classes: kit.classes, centres: kit.centres.map((c) => c.map((v) => Math.round(v * 1e4) / 1e4)) };
    if (process.env.GOLDEN_UPDATE) {
      writeFileSync(GENERIC_KIT, JSON.stringify({ source: "AVP dataset (Delgado et al. 2019, Zenodo 5578744, CC BY 4.0): golden/avp.test.ts", detector: DETECTOR, ...rounded }) + "\n");
      return;
    }
    const committed = JSON.parse(readFileSync(GENERIC_KIT, "utf8")) as SoundKit;
    expect(committed.classes).toEqual(rounded.classes);
    committed.centres.forEach((c, i) => c.forEach((v, j) => expect(v).toBeCloseTo(rounded.centres[i]![j]!, 3)));
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
