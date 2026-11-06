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
const BASS_808 = 2;
const BASS_CHOKE = 2; // an 808 is monophonic: a new note cuts the last one

/** 808 voice per mood: [punch semitones, punch ms, decay s, glide ms]. Boom Bap short and round; Trap long, sliding. */
const BASS_808_PARAMS: Record<Mood, [number, number, number, number]> = {
  boomBap: [7, 25, 0.35, 0],
  trap: [12, 40, 1.6, 90],
};

/** Instrument table + zones for a mood: each lane slot (LANES order) plays its kit piece; unmapped lanes stay sine. */
export function kitProgram(mood: Mood): EngineProgram {
  const instruments: number[] = [];
  const zones: number[] = [];
  LANES.forEach((lane, i) => {
    if (lane === "bass") {
      instruments.push(BASS_808, BASS_CHOKE, 0.9, 0, ...BASS_808_PARAMS[mood]);
      return;
    }
    const piece = pieces[moods[mood][lane] ?? ""];
    if (!piece) {
      instruments.push(SINE, -1, 1, 0, 0, 0, 0, 0); // melody until the synths land (P4)
      return;
    }
    instruments.push(SAMPLER, piece.chokeGroup, piece.gain, 0, 0, 0, 0, 0);
    for (const layer of piece.layers) for (const f of layer.files) zones.push(i, layer.maxVelocity, SLOT.get(f)!);
  });
  return { instruments: Float32Array.from(instruments), zones: Float32Array.from(zones) };
}
