import { create } from "zustand";
import type { Mood } from "./kit";

/** A recorded take, raw: the mic from the first count-in click on (P2 shifts it by the measured round trip). */
export interface Take {
  input: Float32Array;
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
