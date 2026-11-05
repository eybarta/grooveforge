import { emptySong } from "@/song/store";
import { PPQ, type NoteEvent, type Song } from "@/song/types";

const beats = (make: (beat: number) => Partial<NoteEvent>): NoteEvent[] =>
  Array.from({ length: 8 }, (_, b) => ({
    id: `b${b}`, tick: b * PPQ, lane: "kick", velocity: 0.8, offsetMs: 0, source: "user", ...make(b),
  }));

const oneTrack = (notes: NoteEvent[]): Song => ({
  ...emptySong(),
  bpm: 90,
  bars: 2,
  tracks: [{ id: "t", kind: "drums", name: "Spike", gainDb: 0, muted: false, frozen: false, notes }],
});

/** The 2-bar loop: a 55 Hz boop on every beat. Matches engine/test/engine_test.cpp, so offline renders compare. */
export const loopSong = (): Song => oneTrack(beats(() => ({})));

/** Calibration: a 4 ms, ~2.6 kHz blip on every beat — short and bright enough to time precisely. */
export const clickSong = (): Song =>
  oneTrack(beats(() => ({ lane: "perc", pitch: 100, durationTicks: 6, velocity: 0.9 })));

/** Host render reference printed by engine_test (mean |x|, peak) for the dry loop. */
export const HOST_REFERENCE = { frames: 256000, meanAbs: 0.037653, peak: 0.731704 };
