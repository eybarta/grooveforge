/**
 * The 808 when the user didn't hum (P2 re-scope, Eyal 2026-11-09: "a good bassline that goes with the beat"): notes
 * on the kicks, in the mood's minor key (the demo's root, src/song/demoGrooves.ts), over a chord progression, phrased
 * per mood. Deterministic: the same kicks always give the same bassline.
 */
import { STEP_TICKS, STEPS_PER_BAR } from "@/song/grid";
import { boomBapDemo, trapDemo } from "@/song/demoGrooves";
import type { NoteEvent, Song } from "@/song/types";

const BAR = STEPS_PER_BAR * STEP_TICKS;

/** Semitones above the root, per bar of a 2-bar cycle (each [from step, offset]): Boom Bap i–iv, Trap i | VI–VII. */
const PROGRESSION: Record<Song["mood"], [number, number][][]> = {
  boomBap: [[[0, 0]], [[0, 5]]],
  trap: [[[0, 0]], [[0, 8], [8, 10]]],
};
/** Boom Bap: short bouncy notes (≤ an 8th + a 16th), an octave pop on a free off-beat 8th. Trap: long 808s that slide. */
const BOOM_BAP_LEN = 3, TRAP_MAX_LEN = 16;

const rootOf = (mood: Song["mood"]) => (mood === "trap" ? trapDemo() : boomBapDemo()).tracks.find((t) => t.kind === "bass")!.notes[0]!.pitch!;

/** The chord root (MIDI) under a tick. */
function chordAt(tick: number, song: Pick<Song, "mood">): number {
  const bar = PROGRESSION[song.mood][Math.floor(tick / BAR) % 2]!;
  const step = (tick % BAR) / STEP_TICKS;
  return rootOf(song.mood) + bar.filter(([from]) => from <= step).at(-1)![1];
}

/** The 808 line for a take without a hum: one note per kick (one per bar if there are none). */
export function kickBassline(kicks: NoteEvent[], song: Pick<Song, "bars" | "mood">): NoteEvent[] {
  const end = song.bars * BAR;
  const hits = [...kicks].filter((k) => k.tick >= 0 && k.tick < end).sort((a, b) => a.tick - b.tick);
  const at = hits.length ? hits : Array.from({ length: song.bars }, (_, b) => ({ tick: b * BAR, offsetMs: 0 }));
  const notes: NoteEvent[] = [];
  at.forEach((k, i) => {
    const next = at[i + 1]?.tick ?? end;
    const last = i === at.length - 1;
    // the turnaround: the loop's last note leads back to the root (the fifth in Boom Bap, the VII in Trap), unless it's
    // the bar's only note (on its one)
    const pitch = last && k.tick % BAR !== 0 ? rootOf(song.mood) + (song.mood === "trap" ? 10 : 7) : chordAt(k.tick, song);
    const prev = notes[notes.length - 1];
    if (song.mood === "trap") {
      notes.push({
        id: `b${k.tick}`, tick: k.tick, lane: "bass", velocity: 1, offsetMs: k.offsetMs, source: "detected", pitch,
        durationTicks: Math.min(next - k.tick, TRAP_MAX_LEN * STEP_TICKS),
        ...(prev && prev.pitch !== pitch ? { glideFrom: prev.pitch! } : {}),
      });
      return;
    }
    notes.push({
      id: `b${k.tick}`, tick: k.tick, lane: "bass", velocity: 1, offsetMs: k.offsetMs, source: "detected", pitch,
      durationTicks: Math.min(next - k.tick, BOOM_BAP_LEN * STEP_TICKS),
    });
    // an octave pop on the next off-beat 8th, if it's free until the next kick
    const pop = (Math.floor(k.tick / (4 * STEP_TICKS)) * 4 + 2) * STEP_TICKS + (k.tick % (4 * STEP_TICKS) >= 2 * STEP_TICKS ? 4 * STEP_TICKS : 0);
    if (pop >= k.tick + BOOM_BAP_LEN * STEP_TICKS && pop + STEP_TICKS <= next && pop < end) {
      notes.push({ id: `b${pop}`, tick: pop, lane: "bass", velocity: 0.7, offsetMs: 0, source: "detected", pitch: pitch + 12, durationTicks: STEP_TICKS });
    }
  });
  return notes;
}
