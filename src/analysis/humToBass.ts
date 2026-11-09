/**
 * The hum's pitch track → 808 notes (BUILD_PLAN step 7): voiced stretches split into steady notes, the key found from
 * them and every note snapped into it, the line moved into C1–C2, and a hummed slide into a note becomes its
 * glideFrom. No hum → a bassline on the kicks (src/analysis/bassline.ts). Timing as the drums (src/analysis/takeToSong.ts).
 */
import { STEP_TICKS } from "@/song/grid";
import { hzToMidi } from "@/song/time";
import type { NoteEvent, Song } from "@/song/types";
import { kickBassline } from "./bassline";

/** A hummed note: seconds in the take, the pitch as hummed (fractional MIDI), whether it was slid into. */
export interface HumNote { start: number; end: number; midi: number; slid: boolean }

const MIN_NOTE = 0.06; // s: shorter voiced bits are breaths and drum-sound residue
const STEADY = 0.07; // s: a pitch held this long is a note; shorter = moving between notes (or a drum's wobble)
const RESIDUE = 0.15; // s: a shorter "note" starting at a drum hit is that drum's own tone (a kick's thump, a click's ring)
// A kick's ringing tail (an 808-ish thump settles at ~55 Hz and can ring 0.4 s) is lower than people hum (C2, 65 Hz,
// is about the floor): a "note" below that starting within TAIL of a drum hit is the drum's, however long it rings
// (any hit: it needn't have been classified a kick)
const LOWEST_HUM = 35.5, TAIL = 0.3;
const BRIDGE = 0.1; // s: a gap this short with a drum hit in it is the drum cutting through one hummed note
// s: a note starting this soon after a kick started with it (the kick masks the hum's first ~100 ms). Capped at a 16th:
// masking only ever delays, so a note meant for the next 16th is heard at least a 16th after the kick.
const SNAP = 0.12;
const SLIDE = 0.04; // s: moving for longer than this between two notes is a slide (shorter = a jump)
const HYSTERESIS = 0.7; // semitones off the current note before it changes (vibrato, a hum sitting between notes)

const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s[s.length >> 1]!; };

/** The take's drum hits, for cleaning up the hum: every hit's time, the kicks', and a 16th (s) to cap the kick snap. */
export interface HumDrums { hits: number[]; kicks: number[]; sixteenth?: number }

/**
 * The pitch track (Hz every `hop` s, 0 = unvoiced) → notes as hummed. With the take's `drums`: drum tones are
 * dropped, and a note that starts just after a kick starts with it (unless it was slid into).
 */
export function humNotes(f0: ArrayLike<number>, hop: number, drums?: HumDrums): HumNote[] {
  const notes = segment(f0, hop);
  if (!drums) return notes;
  const snap = Math.min(SNAP, drums.sixteenth ?? Infinity);
  const near = (times: number[], at: number, before: number, after: number) => times.some((t) => at - t >= -before && at - t <= after);
  const kept = notes.filter((n) => {
    const len = n.end - n.start;
    if (len < RESIDUE && near(drums.hits, n.start, 0.03, 0.1)) return false;
    return !(n.midi < LOWEST_HUM && near(drums.hits, n.start, 0.03, TAIL));
  });
  const joined: HumNote[] = [];
  for (const n of kept) {
    const prev = joined[joined.length - 1];
    const cut = prev && n.start - prev.end < BRIDGE && Math.abs(n.midi - prev.midi) < 0.5 && drums.hits.some((t) => t >= prev.end - 0.03 && t <= n.start + 0.03);
    if (cut) prev.end = n.end;
    else joined.push({ ...n });
  }
  return joined
    .map((n) => {
      const kick = n.slid ? undefined : drums.kicks.filter((t) => t <= n.start + 0.03 && n.start - t <= snap).pop();
      return kick === undefined ? n : { ...n, start: kick };
    });
}

function segment(f0: ArrayLike<number>, hop: number): HumNote[] {
  const raw = Array.from(f0, (hz) => (hz > 0 ? hzToMidi(hz) : NaN));
  const m = raw.map((v, k) => (Number.isNaN(v) ? v : median(raw.slice(Math.max(0, k - 2), k + 3).filter((x) => !Number.isNaN(x))))); // 5-frame median
  const notes: HumNote[] = [];
  for (let a = 0; a < m.length; ) {
    if (Number.isNaN(m[a]!)) { a++; continue; }
    let b = a;
    while (b < m.length && !Number.isNaN(m[b]!)) b++;
    if ((b - a) * hop >= MIN_NOTE) notes.push(...splitRun(m, a, b, hop));
    a = b;
  }
  return notes;
}

/** One voiced stretch [a, b) → its steady notes; the frames moving between two notes belong to the second. */
function splitRun(m: number[], a: number, b: number, hop: number): HumNote[] {
  const regions: { from: number; to: number; r: number }[] = [];
  let cur = Math.round(m[a]!);
  for (let k = a; k < b; k++) {
    if (Math.abs(m[k]! - cur) > HYSTERESIS) cur = Math.round(m[k]!);
    const last = regions[regions.length - 1];
    if (last && last.r === cur) last.to = k + 1;
    else regions.push({ from: k, to: k + 1, r: cur });
  }
  const steady = regions.filter((g) => (g.to - g.from) * hop >= STEADY);
  if (!steady.length) return [{ start: a * hop, end: b * hop, midi: median(m.slice(a, b)), slid: false }];
  // neighbouring steady regions on one note (a wobble between them) are one note
  const held: { from: number; to: number; r: number }[] = [];
  for (const g of steady) {
    const last = held[held.length - 1];
    if (last && last.r === g.r) last.to = g.to;
    else held.push({ ...g });
  }
  return held.map((g, i) => {
    const prevEnd = i ? held[i - 1]!.to : a;
    return {
      start: (i ? prevEnd : a) * hop,
      end: (i === held.length - 1 ? b : g.to) * hop,
      midi: median(m.slice(g.from, g.to)),
      slid: i > 0 && (g.from - prevEnd) * hop > SLIDE,
    };
  });
}

// Krumhansl–Kessler key profiles (Krumhansl 1990), C major / C minor
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

function pearson(x: number[], y: number[]) {
  const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
  let n = 0, dx = 0, dy = 0;
  x.forEach((v, i) => { n += (v - mx) * (y[i]! - my); dx += (v - mx) ** 2; dy += (y[i]! - my) ** 2; });
  return dx && dy ? n / Math.sqrt(dx * dy) : 0;
}

/** The key the notes are in: duration-weighted pitch classes against the 24 rotated profiles (minor wins a tie). */
export function detectKey(notes: HumNote[]): { root: number; mode: "major" | "minor" } {
  const pcs = new Array<number>(12).fill(0);
  for (const n of notes) pcs[((Math.round(n.midi) % 12) + 12) % 12]! += n.end - n.start;
  let best = { root: 0, mode: "minor" as "major" | "minor", r: -Infinity };
  for (let root = 0; root < 12; root++) {
    for (const [mode, prof] of [["minor", MINOR], ["major", MAJOR]] as const) {
      const r = pearson(pcs, prof.map((_, i) => prof[(i - root + 12) % 12]!));
      if (r > best.r + 1e-9) best = { root, mode, r };
    }
  }
  return best;
}

/** The nearest note of the key to a hummed pitch (a tie goes down). */
export function snap(midi: number, key: { root: number; mode: "major" | "minor" }): number {
  let best = Math.round(midi), d = Infinity;
  for (let p = Math.floor(midi) - 2; p <= Math.ceil(midi) + 2; p++) {
    if (!SCALE[key.mode].includes(((p - key.root) % 12 + 12) % 12)) continue;
    if (Math.abs(p - midi) < d - 1e-9) { best = p; d = Math.abs(p - midi); }
  }
  return best;
}

// The 808's range: C1–C2 as BUILD_PLAN says, up to E2 (82 Hz, still sub) so a hummed line keeps its shape.
const LOW = 24, TOP = 40, CENTRE = 31;

/**
 * Shifts the line by whole octaves so the most notes sit in the 808's range (on a tie: the fewest octaves moved, so a
 * low hum stays where it was hummed; then the nearest to G1), then folds the rest in.
 */
export function intoRange(pitches: number[]): number[] {
  if (!pitches.length) return [];
  const mid = median(pitches);
  const inRange = (k: number) => pitches.filter((p) => p + 12 * k >= LOW && p + 12 * k <= TOP).length;
  const dist = (k: number) => Math.abs(mid + 12 * k - CENTRE);
  const k0 = Math.round((CENTRE - mid) / 12);
  const better = (b: number, a: number) => inRange(b) - inRange(a) || Math.abs(a) - Math.abs(b) || dist(a) - dist(b);
  const k = [k0 - 1, k0, k0 + 1].reduce((a, b) => (better(b, a) > 0 ? b : a));
  return pitches.map((p) => {
    let q = p + 12 * k;
    while (q < LOW) q += 12;
    while (q > TOP) q -= 12;
    return q;
  });
}

/** Where a time (s after bar 1) lands on the song's grid: the nearest tick in `unit`s, and its offset (the feel). */
export type Place = (t: number, unit: number) => { tick: number; offsetMs: number };

/**
 * The hum → the 808 track's notes, placed on the grid by `place`. Without a usable hum: a bassline on the kicks.
 */
export function humToBass(hum: HumNote[], song: Pick<Song, "bars" | "mood">, place: Place, kicks: NoteEvent[]): NoteEvent[] {
  const end = song.bars * 16 * STEP_TICKS;
  if (!hum.length) return kickBassline(kicks, song);
  const key = detectKey(hum);
  const pitches = intoRange(hum.map((n) => snap(n.midi, key)));
  const notes: NoteEvent[] = [];
  hum.forEach((n, i) => {
    const { tick, offsetMs } = place(n.start, STEP_TICKS);
    if (tick < 0 || tick >= end) return;
    const prev = notes[notes.length - 1];
    if (prev && prev.tick === tick) notes.pop(); // two notes in one 16th: the later one wins
    notes.push({
      id: `b${tick}`, tick, lane: "bass", velocity: 1, offsetMs, source: "detected", pitch: pitches[i]!,
      durationTicks: Math.max(STEP_TICKS, Math.min(place(n.end, STEP_TICKS).tick, end) - tick),
      ...(n.slid && i > 0 && pitches[i - 1] !== pitches[i] ? { glideFrom: pitches[i - 1]! } : {}),
    });
  });
  // legato: a note never rings into the next
  notes.forEach((n, i) => { const next = notes[i + 1]; if (next) n.durationTicks = Math.max(STEP_TICKS, Math.min(n.durationTicks!, next.tick - n.tick)); });
  return notes;
}
