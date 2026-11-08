import { create } from "zustand";
import type { Mood } from "./kit";

/** A recorded take, raw: the mic from the first count-in click on (src/analysis/forgeTake.ts shifts it by the round trip). */
export interface Take {
  input: Float32Array;
  /** What the engine played meanwhile (its output capture, same timeline): the click, subtracted from the mic. */
  output: Float32Array;
  /** performance.now() at Stop: record → ready is measured from here. */
  stoppedAt: number;
  sampleRate: number;
  bpm: number;
  mood: Mood;
  /** The count-in bar at the start of `input`. */
  countInFrames: number;
}

/** The last take, handed from Record to Forge (and to P2's analysis). In memory only. */
export const useTake = create<{ take: Take | null; setTake: (t: Take | null) => void }>()((set) => ({
  take: null,
  setTake: (take) => set({ take }),
}));
