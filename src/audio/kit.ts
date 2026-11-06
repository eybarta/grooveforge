import manifest from "../../assets/kits/hiphop/manifest.json";
import { LANES } from "@/song/time";
import type { Song } from "@/song/types";
import type { EngineProgram } from "./types";

export type Mood = Song["mood"];

interface Piece {
  gain: number;
  chokeGroup: number;
  layers: { maxVelocity: number; files: string[] }[];
}

const pieces = manifest.pieces as Record<string, Piece>;
const moods = manifest.moods as Record<Mood, Partial<Record<(typeof LANES)[number], string>>>;

/** Every kit file gets a fixed engine slot; both moods load once, so switching mood is an instant program swap. */
export const KIT_FILES: readonly string[] = Object.values(pieces).flatMap((p) => p.layers.flatMap((l) => l.files));
const SLOT = new Map(KIT_FILES.map((f, i) => [f, i]));

const SINE = 0;
const SAMPLER = 1;

/** Instrument table + zones for a mood: each lane slot (LANES order) plays its kit piece; unmapped lanes stay sine. */
export function kitProgram(mood: Mood): EngineProgram {
  const instruments: number[] = [];
  const zones: number[] = [];
  LANES.forEach((lane, i) => {
    const piece = pieces[moods[mood][lane] ?? ""];
    if (!piece) {
      instruments.push(SINE, -1, 1, 0); // bass / melody until the 808 and synths land
      return;
    }
    instruments.push(SAMPLER, piece.chokeGroup, piece.gain, 0);
    for (const layer of piece.layers) for (const f of layer.files) zones.push(i, layer.maxVelocity, SLOT.get(f)!);
  });
  return { instruments: Float32Array.from(instruments), zones: Float32Array.from(zones) };
}
