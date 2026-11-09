/** The Studio step grid's view of a Song: one bar of 16ths per lane, and toggling a step back into notes. */
import { PPQ, type DrumLane, type Lane, type NoteEvent, type Song } from "./types";

export const STEP_TICKS = PPQ / 4; // one 16th
export const STEPS_PER_BAR = 16;
const BAR_TICKS = STEP_TICKS * STEPS_PER_BAR;

/** Loudest velocity starting inside each 16th of `bar`, per lane (0 = empty). Off-grid hits (1/32 rolls) count too. */
export function barCells(song: Song, bar: number, lanes: readonly Lane[]): number[][] {
  const cells = lanes.map(() => new Array<number>(STEPS_PER_BAR).fill(0));
  eachCell(song, bar, lanes, (n, row, step) => (cells[row]![step] = Math.max(cells[row]![step]!, n.velocity)));
  return cells;
}

/** Below this a detected hit's lane is a guess: the Studio marks it with the amber "?" (docs/design/3-studio). */
export const UNSURE = 0.3;

/** Per cell of the bar: does it hold a detected hit the classifier wasn't sure of? */
export function barUnsure(song: Song, bar: number, lanes: readonly Lane[]): boolean[][] {
  const out = lanes.map(() => new Array<boolean>(STEPS_PER_BAR).fill(false));
  eachCell(song, bar, lanes, (n, row, step) => {
    if (n.confidence !== undefined && n.confidence < UNSURE) out[row]![step] = true;
  });
  return out;
}

function eachCell(song: Song, bar: number, lanes: readonly Lane[], fn: (n: NoteEvent, row: number, step: number) => void) {
  for (const t of song.tracks) {
    if (t.muted) continue;
    for (const n of t.notes) {
      const row = lanes.indexOf(n.lane);
      const step = Math.floor((n.tick - bar * BAR_TICKS) / STEP_TICKS);
      if (row >= 0 && step >= 0 && step < STEPS_PER_BAR) fn(n, row, step);
    }
  }
}

const inStep = (n: NoteEvent, lane: Lane, from: number) => n.lane === lane && n.tick >= from && n.tick < from + STEP_TICKS;

/** The loudest hit of `lane` starting in that step, if any. */
export function hitAt(song: Song, lane: Lane, bar: number, step: number): NoteEvent | undefined {
  const from = bar * BAR_TICKS + step * STEP_TICKS;
  return song.tracks.flatMap((t) => t.notes).filter((n) => inStep(n, lane, from)).sort((a, b) => b.velocity - a.velocity)[0];
}

/**
 * A fix: that hit is really `to`, and so is every hit of the same sound in the take that was named like it
 * (src/analysis/sounds.ts): they all move lane, now sure (confidence 1). Two hits on one step of `to`: the louder stays.
 * Returns the sound fixed (to teach the user's kit), if the hit had one.
 */
export function relabelSound(song: Song, hit: NoteEvent, to: DrumLane): { song: Song; sound?: number } {
  const moves = (n: NoteEvent) => n === hit || (hit.sound !== undefined && n.sound === hit.sound && n.lane === hit.lane && n.source === "detected");
  const tracks = song.tracks.map((t) => {
    if (!t.notes.some(moves)) return t;
    const kept = new Map<string, NoteEvent>();
    for (const n of t.notes.map((n) => (moves(n) ? { ...n, lane: to, id: `d${n.tick}-${to}`, confidence: 1 } : n))) {
      const key = n.lane === "bass" || n.lane === "melody" ? n.id : `${n.lane}:${n.tick}`;
      const prev = kept.get(key);
      if (!prev || n.velocity > prev.velocity) kept.set(key, n);
    }
    return { ...t, notes: [...kept.values()].sort((a, b) => a.tick - b.tick) };
  });
  return { song: { ...song, tracks }, sound: hit.sound };
}

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
