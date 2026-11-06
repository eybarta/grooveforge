import { emptySong } from "./store";
import { PPQ, type Lane, type NoteEvent, type Song } from "./types";

const S16 = PPQ / 4; // one 16th
const S32 = PPQ / 8;

/** Hits as [16th step, lane, velocity] (or [tick, lane, velocity, true] for off-grid ticks like 1/32 rolls). */
type Hit = [number, Lane, number, boolean?];

const notes = (hits: Hit[]): NoteEvent[] =>
  hits.map(([at, lane, velocity, isTick], i) => ({
    id: `d${i}`, tick: isTick ? at : at * S16, lane, velocity, offsetMs: 0, source: "user",
  }));

/** 808 notes as [16th step, MIDI pitch, length in 16ths, glideFrom?]. */
type Bass = [number, number, number, number?];

const bassNotes = (line: Bass[]): NoteEvent[] =>
  line.map(([step, pitch, len, glideFrom], i) => ({
    id: `b${i}`, tick: step * S16, lane: "bass", velocity: 1, offsetMs: 0, source: "user",
    pitch, durationTicks: len * S16, ...(glideFrom === undefined ? {} : { glideFrom }),
  }));

const groove = (song: Song, hits: Hit[], bass: Bass[]): Song => ({
  ...song,
  tracks: [
    { id: "drums", kind: "drums", name: "Drums", gainDb: 0, muted: false, frozen: false, notes: notes(hits) },
    { id: "bass", kind: "bass", name: "808", gainDb: 0, muted: false, frozen: false, notes: bassNotes(bass) },
  ],
});

/** Boom Bap, 90 BPM, swung 16ths: dusty kick/snare, accented 8th hats, a ghost snare, shaker 16ths, one open hat. */
export function boomBapDemo(): Song {
  const hits: Hit[] = [];
  for (const bar of [0, 1]) {
    const o = bar * 16;
    hits.push([o + 0, "kick", 1], [o + 7, "kick", 0.7], [o + 10, "kick", 0.9]);
    hits.push([o + 4, "snare", 1], [o + 12, "snare", 1], [o + 15, "snare", 0.25]); // ghost before the bar
    for (let e = 0; e < 16; e += 2) if (!(bar === 1 && e === 14)) hits.push([o + e, "hatClosed", e % 4 === 0 ? 0.75 : 0.5]);
    for (let s = 1; s < 16; s += 2) hits.push([o + s, "perc", 0.35]);
  }
  hits.push([30, "hatOpen", 0.7]);
  // F minor, following the kick: F1 F1 Ab1 | Eb1 Eb1 C1
  const bass: Bass[] = [[0, 29, 6], [7, 29, 3], [10, 32, 5], [16, 27, 6], [23, 27, 3], [26, 24, 5]];
  return groove({ ...emptySong(), id: "boom-bap-demo", bpm: 90, bars: 2, mood: "boomBap", swing: 0.58, quantize: 1 }, hits, bass);
}

/** Trap, 140 BPM half-time: syncopated kick, clap on 3, 8th hats with a 1/32 roll, snaps, an open hat. */
export function trapDemo(): Song {
  const hits: Hit[] = [];
  for (const bar of [0, 1]) {
    const o = bar * 16;
    hits.push([o + 0, "kick", 1], [o + 3, "kick", 0.8], [o + 10, "kick", 0.9]);
    hits.push([o + 8, "snare", 1]);
    for (let e = 0; e < 16; e += 2) if (!(bar === 1 && e >= 12)) hits.push([o + e, "hatClosed", e % 4 === 0 ? 0.8 : 0.6]);
  }
  hits.push([16 + 14, "kick", 0.7]);
  for (let k = 0; k < 8; k++) hits.push([(16 + 12) * S16 + k * S32, "hatClosed", 0.45 + 0.05 * k, true]); // the roll
  hits.push([6, "perc", 0.6], [22, "perc", 0.6], [14, "hatOpen", 0.6]);
  // C# minor, long 808s that slide: C#1 … E1 (slides up) … F#1 (slides up) … back down to C#1
  const bass: Bass[] = [[0, 25, 3], [3, 25, 7], [10, 25, 6], [16, 28, 3, 25], [19, 28, 7], [26, 30, 4, 28], [30, 25, 2, 30]];
  return groove({ ...emptySong(), id: "trap-demo", bpm: 140, bars: 2, mood: "trap", swing: 0.5, quantize: 1 }, hits, bass);
}
