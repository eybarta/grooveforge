/// <reference types="node" />
// Writes Audacity labels with the detector's guesses for a take, so labelling is correcting, not typing.
//   npm run golden:prelabel -- ~/Downloads/take-trap-140bpm-ci1.714s-speaker-20261108-1402.wav
// → <same name>.labels.txt next to it. In Audacity: open the WAV, File → Import → Labels…, fix the labels
// (k / sn / hh / oh / perc at each hit's attack; a region labelled "hum" or "hum 36" over each hummed note),
// File → Export → Export Labels, then `npm run golden:import`.
import { readFileSync, writeFileSync } from "node:fs";
import { toAudacityLabels } from "../src/analysis/audacity.ts";
import { decodeWav } from "../src/audio/wav.ts";
import { DETECTOR, detect } from "../golden/detect.ts";

const wav = process.argv[2];
if (!wav?.endsWith(".wav")) {
  console.error("usage: npm run golden:prelabel -- <take.wav>");
  process.exit(1);
}
const { samples, sampleRate } = decodeWav(readFileSync(wav));
if (sampleRate !== 48000) console.warn(`warning: ${sampleRate} Hz (the golden takes are 48 kHz)`);
const hits = detect(samples, sampleRate);
const out = wav.replace(/\.wav$/, ".labels.txt");
writeFileSync(out, toAudacityLabels(hits));
console.log(`${hits.length} guessed hits (${DETECTOR}) → ${out}`);
