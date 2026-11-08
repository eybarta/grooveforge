/** The Studio step grid's view of a Song: one bar of 16ths per lane, and toggling a step back into notes. */
import { PPQ, type Lane, type NoteEvent, type Song } from "./types";

export const STEP_TICKS = PPQ / 4; // one 16th
export const STEPS_PER_BAR = 16;
const BAR_TICKS = STEP_TICKS * STEPS_PER_BAR;

/** Loudest velocity starting inside each 16th of `bar`, per lane (0 = empty). Off-grid hits (1/32 rolls) count too. */
export function barCells(song: Song, bar: number, lanes: readonly Lane[]): number[][] {
  const cells = lanes.map(() => new Array<number>(STEPS_PER_BAR).fill(0));
  for (const t of song.tracks) {
    if (t.muted) continue;
    for (const n of t.notes) {
      const row = lanes.indexOf(n.lane);
      const step = Math.floor((n.tick - bar * BAR_TICKS) / STEP_TICKS);
      if (row < 0 || step < 0 || step >= STEPS_PER_BAR) continue;
      cells[row]![step] = Math.max(cells[row]![step]!, n.velocity);
    }
  }
  return cells;
}

const inStep = (n: NoteEvent, lane: Lane, from: number) => n.lane === lane && n.tick >= from && n.tick < from + STEP_TICKS;

/**
 * Turns a step off (removes every note of that lane starting inside it) or on (a user note on the 16th). A new 808
 * note takes the pitch of the nearest bass note before it (else the first one, else C2) and lasts one 16th.
 */
export function toggleStep(song: Song, lane: Lane, bar: number, step: number): Song {
  const from = bar * BAR_TICKS + step * STEP_TICKS;
  const on = song.tracks.some((t) => t.notes.some((n) => inStep(n, lane, from)));
  const kind = lane === "bass" ? "bass" : lane === "melody" ? "melody" : "drums";
  const target = song.tracks.find((t) => t.notes.some((n) => n.lane === lane)) ?? song.tracks.find((t) => t.kind === kind);
  if (on) return { ...song, tracks: song.tracks.map((t) => ({ ...t, notes: t.notes.filter((n) => !inStep(n, lane, from)) })) };
  if (!target) return song;
  const same = song.tracks.flatMap((t) => t.notes).filter((n) => n.lane === lane).sort((a, b) => a.tick - b.tick);
  const before = same.filter((n) => n.tick < from).at(-1) ?? same[0];
  const note: NoteEvent = {
    id: `u${lane}-${from}`, tick: from, lane, velocity: 0.8, offsetMs: 0, source: "user",
    ...(lane === "bass" ? { pitch: before?.pitch ?? 36, durationTicks: STEP_TICKS } : {}),
  };
  return { ...song, tracks: song.tracks.map((t) => (t === target ? { ...t, notes: [...t.notes, note] } : t)) };
}
