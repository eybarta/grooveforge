import { create } from "zustand";

/**
 * The last measured round trip (src/audio/spikeRuns.ts `calibrate`), shared by every screen that draws on the audio
 * clock. In memory only for now: per-route persistence comes with P2's calibration feature.
 */
export const useCalibration = create<{ rtlMs: number | null; setRtlMs: (ms: number | null) => void }>()((set) => ({
  rtlMs: null,
  setRtlMs: (rtlMs) => set({ rtlMs }),
}));
