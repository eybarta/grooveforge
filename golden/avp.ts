/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LabelledHit } from "../src/analysis/golden.ts";
import { decodeWav } from "../src/audio/wav.ts";

/**
 * The Amateur Vocal Percussion dataset (Delgado et al. 2019; Zenodo 5578744, CC BY 4.0): 28 people with little or
 * no beatbox experience, laptop mic, 44.1 kHz. Each has one file per sound (kick, snare, closed hat, open hat, ~10 s
 * of repeats) and one improvised groove (no click), every hit labelled. Not in the repo (169 MB): CI downloads it,
 * locally unpack it to `AVP_DIR` (golden/README.md).
 */
export const AVP_DIR = process.env.AVP_DIR ?? join(homedir(), "Projects/grooveforge-data/avp-lvt/AVP-LVT_Dataset/AVP_Dataset/Personal");

const CLASS = { kd: "kick", sd: "snare", hhc: "hatClosed", hho: "hatOpen" } as const;
export const AVP_SOUNDS = ["Kick", "Snare", "HHclosed", "HHopened"] as const;

export interface AvpPerson {
  id: number;
  /** `<file>.wav` + `<file>.csv` per sound, and the groove. */
  sounds: string[];
  groove: string;
}

/** The people found in `dir` (none if it isn't there). */
export function avpPeople(dir = AVP_DIR): AvpPerson[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => d.startsWith("Participant_"))
    .map((d) => {
      const id = Number(d.slice("Participant_".length));
      const file = (kind: string) => join(dir, d, `P${id}_${kind}_Personal`);
      return { id, sounds: AVP_SOUNDS.map(file), groove: file("Improvisation") };
    })
    .sort((a, b) => a.id - b.id);
}

export const avpAudio = (file: string) => decodeWav(readFileSync(`${file}.wav`));

/** A file's labelled hits (CSV rows: onset seconds, kd|sd|hhc|hho, onset phoneme, coda phoneme). */
export function avpLabels(file: string): LabelledHit[] {
  const hits: LabelledHit[] = readFileSync(`${file}.csv`, "utf8").trim().split(/\r?\n/).map((row) => {
    const [t, label] = row.split(",");
    const cls = CLASS[label as keyof typeof CLASS];
    if (!cls || !Number.isFinite(Number(t))) throw new Error(`${file}.csv: bad row "${row}"`);
    return { t: Number(t), class: cls };
  });
  return hits.sort((a, b) => a.t - b.t);
}
