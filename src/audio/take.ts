import { create } from "zustand";
import type { TakeAnalysis } from "@/analysis/analyze";
import type { Mood } from "./kit";

/**
 * A recorded take, raw: the mic from Record on. Over the click (count-in first) src/analysis/forgeTake.ts shifts it by
 * the round trip; with no click (the default) nothing played, so nothing needs lining up.
 */
export interface Take {
  input: Float32Array;
  /** What the engine played meanwhile (its output capture, same timeline): the click, subtracted from the mic. */
  output: Float32Array;
  /** performance.now() at Stop: record → ready is measured from here. */
  stoppedAt: number;
  sampleRate: number;
  /** The click's tempo; with no click, the mood's typical tempo (where the beat tracker looks first). */
  bpm: number;
  mood: Mood;
  /** Recorded over the metronome (a count-in, then the click)? */
  click: boolean;
  /** The count-in bar at the start of `input` (0 with no click). */
  countInFrames: number;
}

/** How the take was heard: what the Studio needs to re-time its song (½×, 2×, bar 1) and to learn from a fix. */
export interface Heard {
  analysis: TakeAnalysis;
  /** The beats the song was placed on (s, on the analysed take's timeline) and bar 1's index in them. */
  beats: number[];
  bar1: number;
  /** Per sound (a note's `sound`): its hits' features. */
  sounds: number[][][];
  /** How far the take was shifted before analysis (the round trip; 0 with no click). */
  shiftSec: number;
}

/** The last take, handed from Record to Forge, and how it was heard. In memory only. */
export const useTake = create<{ take: Take | null; heard: Heard | null; setTake: (t: Take | null) => void; setHeard: (h: Heard | null) => void }>()((set) => ({
  take: null,
  heard: null,
  setTake: (take) => set({ take, heard: null }),
  setHeard: (heard) => set({ heard }),
}));
