/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instantiateEngine } from "@/audio/wasmEngine";
import { decodeWav } from "@/audio/wav";
import { analyzeTake } from "./analyze";
import { parseTakeLabels, scoreHits, summarizeScore } from "./golden";

const WASM = "public/gf-engine.wasm";
const TAKES = "golden/takes";
const POC_ONSET_F1 = (JSON.parse(readFileSync("golden/baseline.json", "utf8")) as { onsetF1: number }).onsetF1; // the bar to beat

// Onsets only (classes come with the classifier, step 2). CI builds the WASM; locally `npm run build:wasm`.
describe.skipIf(!existsSync(WASM) && !process.env.CI)("take analysis on the golden takes (onsets)", () => {
  it("finds the labelled hits better than the POC did", () => {
    const w = instantiateEngine(new WebAssembly.Module(readFileSync(WASM)));
    let tp = 0, fp = 0, fn = 0;
    for (const name of readdirSync(TAKES).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))) {
      const { samples, sampleRate } = decodeWav(readFileSync(`${TAKES}/${name}.wav`));
      const labels = parseTakeLabels(JSON.parse(readFileSync(`${TAKES}/${name}.json`, "utf8")), samples.length / sampleRate, name);
      const t0 = performance.now();
      const hits = analyzeTake(w, samples, sampleRate);
      const ms = Math.round(performance.now() - t0);
      // classes don't count yet: give every detection the class of the reference it would match
      const s = scoreHits(labels.hits, hits.map((h) => ({ t: h.t, class: "kick" as const })), 0.03);
      tp += s.tp;
      fp += s.fp;
      fn += s.fn;
      const r = summarizeScore({ ...s, classCorrect: s.tp });
      console.log("[analysis]", JSON.stringify({ take: name, hits: hits.length, labelled: labels.hits.length, onsetF1: Math.round(r.onsetF1 * 1000) / 1000, ms, seconds: Math.round((samples.length / sampleRate) * 10) / 10 }));
    }
    const total = summarizeScore({ tp, fp, fn, classCorrect: tp });
    console.log("[analysis]", JSON.stringify({ total: Math.round(total.onsetF1 * 1000) / 1000, precision: Math.round(total.precision * 1000) / 1000, recall: Math.round(total.recall * 1000) / 1000 }));
    expect(total.onsetF1).toBeGreaterThan(POC_ONSET_F1);
  }, 120_000);
});
