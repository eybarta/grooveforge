import { emptySong } from "./store";
import { PPQ, type NoteEvent, type Song } from "./types";

/** Count-in and click while recording: a short sine blip per beat, accented on 1 (plays on defaultInstruments). */
export function metronome(bpm: number): Song {
  const notes: NoteEvent[] = Array.from({ length: 8 }, (_, b) => ({
    id: `m${b}`, tick: b * PPQ, lane: "perc", velocity: b % 4 === 0 ? 0.7 : 0.45, offsetMs: 0, source: "user",
    pitch: b % 4 === 0 ? 100 : 93, durationTicks: PPQ / 40, // ~17 ms at 90 BPM
  }));
  return { ...emptySong(), id: "metronome", bpm, bars: 2, tracks: [{ id: "click", kind: "drums", name: "Click", gainDb: 0, muted: false, frozen: false, notes }] };
}
