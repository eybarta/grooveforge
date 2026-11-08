/// <reference types="node" />
// Turns a labelled take into a golden take: the WAV + Audacity's exported labels → golden/takes/<name>.{wav,json}.
//   npm run golden:import -- <take.wav> <labels.txt> [--performer eyal] [--device "iPhone 16 Pro, built-in mic"] [--name boombap-01]
// Tempo and count-in come from the app's file name (take-<mood>-<bpm>bpm-ci<seconds>s-<route>-<stamp>.wav).
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { fromAudacityLabels, takeMetaFromName } from "../src/analysis/audacity.ts";
import { parseTakeLabels, type TakeLabels } from "../src/analysis/golden.ts";
import { decodeWav } from "../src/audio/wav.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { performer: { type: "string", default: "eyal" }, device: { type: "string" }, name: { type: "string" } },
});
const [wav, labelsPath] = positionals;
if (!wav?.endsWith(".wav") || !labelsPath) {
  console.error("usage: npm run golden:import -- <take.wav> <labels.txt> [--performer eyal] [--device …] [--name …]");
  process.exit(1);
}
const source = basename(wav, ".wav");
const meta = takeMetaFromName(source);
const { samples, sampleRate } = decodeWav(readFileSync(wav));
if (sampleRate !== 48000) throw new Error(`${wav}: ${sampleRate} Hz; the golden takes are 48 kHz`);
const { hits, hum } = fromAudacityLabels(readFileSync(labelsPath, "utf8"), labelsPath);
const name = values.name ?? source;
const labels: TakeLabels = {
  version: 1,
  performer: values.performer!,
  device: values.device ?? meta?.route ?? "unknown",
  ...(meta ? { bpm: meta.bpm, countInSec: meta.countInSec } : {}),
  hits,
  hum,
};
parseTakeLabels(labels, samples.length / sampleRate, name); // the same checks CI runs
const dir = new URL("../golden/takes/", import.meta.url);
copyFileSync(wav, new URL(`${name}.wav`, dir));
writeFileSync(new URL(`${name}.json`, dir), JSON.stringify(labels, null, 2) + "\n");
console.log(`golden/takes/${name}.{wav,json}: ${hits.length} hits, ${hum.length} hum segments${meta ? `, ${meta.bpm} BPM` : ""}`);
