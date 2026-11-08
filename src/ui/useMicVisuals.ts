import { type SharedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import type { AudioClock } from "@/audio/types";
import { motion } from "./theme";

export const RIBBON_BARS = 44;
const SPARKS = 10;
/** A spark: born at t0 (UI seconds), flying out at `angle`, coloured by lane index 0–2 (kick, snare, hat colours). */
export interface Spark { t0: number; angle: number; lane: number }
export interface RibbonBar { h: number; lane: number }

/**
 * Per-frame mic visuals on the UI thread: the level (instant rise, decay at motion.flashDecay), a spark for each
 * sudden jump in level (a stand-in for P2's hit detection), and the ribbon: one bar per 16th while `recording`,
 * its loudest level, coloured when a spark was born in it (the caller owns `ribbon`: the forge reads it after the
 * take). `now` = UI seconds, for shaders.
 */
export function useMicVisuals(clock: AudioClock | null, frames: SharedValue<number>, sixteenthFrames: number, recording: SharedValue<boolean>, ribbon: SharedValue<RibbonBar[]>) {
  const level = useSharedValue(0);
  const now = useSharedValue(0);
  const sparks = useSharedValue<Spark[]>([]);
  const state = useSharedValue({ spark: -1, slot: -1, peak: 0, lane: -1 });

  useFrameCallback((f) => {
    const t = f.timestamp / 1000;
    const dt = Math.min(0.1, (f.timeSincePreviousFrame ?? 16) / 1000);
    now.value = t;
    const raw = clock ? clock.inputLevel : 0;
    const prev = level.value;
    level.value = Math.max(raw, prev * Math.exp(-motion.flashDecay * dt));
    const s = state.value;
    // a hit: the level jumps well above where it was falling, and not right after the last one
    const hit = raw > 0.12 && raw > prev * 1.8 && t - s.spark > 0.09;
    const lane = hit ? Math.floor(Math.random() * 3) : -1;
    if (hit) sparks.value = [...sparks.value.slice(-(SPARKS - 1)), { t0: t, angle: Math.random() * Math.PI * 2, lane }];
    const slot = recording.value && frames.value >= 0 ? Math.floor(frames.value / sixteenthFrames) : -1;
    if (slot !== s.slot && s.slot >= 0) ribbon.set([...ribbon.get().slice(-(RIBBON_BARS - 1)), { h: s.peak, lane: s.lane }]);
    const same = slot === s.slot;
    state.value = { spark: hit ? t : s.spark, slot, peak: same ? Math.max(s.peak, raw) : raw, lane: hit ? lane : same ? s.lane : -1 };
  });

  return { level, now, sparks };
}
