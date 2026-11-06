// P1 blind A/B only (the gate compares v2 with the POC): the one place outside tests that reads reference/poc-audio.
import { degreeToMidi, type Flavor, type HitEvent, type Mix, type Lane as PocLane } from "../../reference/poc-audio/music.ts";
import { PPQ, type Lane, type Song } from "@/song/types";

const S16 = PPQ / 4;
const LANE: Partial<Record<Lane, PocLane>> = { kick: "kick", snare: "snare", hatClosed: "hat", hatOpen: "hat", perc: "perc", bass: "bass" };
const FLAVOR: Record<Song["mood"], Flavor> = { boomBap: "bap", trap: "trap" };
/** The POC app's defaults (main: src/components/groove-forge.tsx): lane levels, humanize on, root F2. */
const POC_LEVELS = { kick: 0.82, snare: 0.78, hat: 0.64, perc: 0.58, bass: 0.76, room: 0.36 };
const POC_ROOT = 41;

/** The song with only what both engines can play — notes on the 16th grid (the POC has no 1/32 rolls) — and `lanes`. */
export const onGrid = (song: Song, lanes?: readonly Lane[]): Song => ({
  ...song,
  tracks: song.tracks.map((t) => ({
    ...t,
    notes: t.notes.filter((n) => n.tick % S16 === 0 && (!lanes || lanes.includes(n.lane))),
  })),
});

/**
 * A Song as the POC's 16th-step grid + mix. Bass pitches become scale degrees from the song's first bass note, and the
 * POC's root moves to that pitch class in its default register; lengths and glides drop (the POC has neither).
 */
export function toPoc(song: Song): { steps: HitEvent[][]; mix: Mix } {
  const flavor = FLAVOR[song.mood];
  const notes = song.tracks.flatMap((t) => t.notes).filter((n) => n.tick % S16 === 0);
  const root = notes.find((n) => n.lane === "bass")?.pitch ?? POC_ROOT;
  const degree = (pitch: number) => {
    for (let d = -24; d <= 24; d++) if (degreeToMidi(root, flavor, d, 0) === pitch) return d;
    throw new Error(`MIDI ${pitch} is not in the POC's ${flavor} scale from ${root}`);
  };
  const steps: HitEvent[][] = Array.from({ length: song.bars * 16 }, () => []);
  for (const n of notes) {
    const lane = LANE[n.lane];
    if (lane) steps[n.tick / S16]!.push({ lane, velocity: n.velocity, source: "user", degree: lane === "bass" ? degree(n.pitch!) : 0 });
  }
  const shift = ((((root - POC_ROOT + 6) % 12) + 12) % 12) - 6; // nearest same pitch class to F2
  return { steps, mix: { ...POC_LEVELS, swing: song.swing, humanize: true, flavor, root: POC_ROOT + shift } };
}
