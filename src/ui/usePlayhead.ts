import { useEffect } from "react";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { AudioClock } from "@/audio/types";

export interface ClockStats {
  fps: number;
  /** UI frames that took > 25 ms (missed at least one vsync at 60 Hz). */
  droppedFrames: number;
  /** Spread of (engine frame − straight line at the sample rate) over the window: how bursty the raw clock reads are. */
  jitterMs: number;
  /** Same spread for the smoothed clock the visuals actually draw. */
  smoothJitterMs: number;
  seconds: number;
}

const FRESH = { t0: -1, n: 0, dropped: 0, minOff: 0, maxOff: 0, minS: 0, maxS: 0 };
/** Fraction of the error corrected per UI frame (~80 ms time constant at 120 fps) and the jump that forces a snap. */
const PULL = 0.1;
const SNAP_MS = 50;

/**
 * Where the loop is *as heard*, every frame on the UI thread, straight from the engine clock (CLAUDE.md: never
 * through React state). `pos` is 0–1 through the loop and `frames` the heard frames since play; both −1 when
 * stopped. `latencyFrames` = the measured output latency (src/audio/latency.ts `outputLatency`). Every 5 s,
 * `onStats` gets fps, dropped frames and clock jitter.
 */
export function usePlayhead(clock: AudioClock, latencyFrames: number, sampleRate: number, onStats?: (s: ClockStats) => void) {
  const pos = useSharedValue(-1);
  const frames = useSharedValue(-1);
  const latency = useSharedValue(latencyFrames);
  const stats = useSharedValue(FRESH);
  // the drawn clock: runs at exactly the sample rate and is pulled gently toward the bursty engine reads
  const smooth = useSharedValue({ frame: 0, t: -1 });

  useEffect(() => {
    latency.value = latencyFrames;
  }, [latency, latencyFrames]);

  useFrameCallback((f) => {
    const loop = clock.loopFrames;
    if (!clock.playing || loop <= 0) {
      pos.value = -1;
      frames.value = -1;
      stats.value = FRESH;
      smooth.value = { frame: 0, t: -1 };
      return;
    }
    const frame = clock.frame;
    const prev = smooth.value;
    const predicted = prev.t < 0 ? frame : prev.frame + ((f.timestamp - prev.t) * sampleRate) / 1000;
    const error = frame - predicted;
    // snap on a restart, a seek or a long stall; otherwise ease toward the measured clock
    const drawn = Math.abs(error) > (SNAP_MS * sampleRate) / 1000 ? frame : predicted + PULL * error;
    smooth.value = { frame: drawn, t: f.timestamp };
    const shown = drawn - latency.value;
    frames.value = shown;
    pos.value = (((shown % loop) + loop) % loop) / loop;
    if (!onStats) return;

    const line = (f.timestamp * sampleRate) / 1000;
    const off = frame - line;
    const offS = drawn - line;
    const s = stats.value;
    if (s.t0 < 0) {
      stats.value = { t0: f.timestamp, n: 1, dropped: 0, minOff: off, maxOff: off, minS: offS, maxS: offS };
      return;
    }
    const next = {
      t0: s.t0,
      n: s.n + 1,
      dropped: s.dropped + ((f.timeSincePreviousFrame ?? 0) > 25 ? 1 : 0),
      minOff: Math.min(s.minOff, off),
      maxOff: Math.max(s.maxOff, off),
      minS: Math.min(s.minS, offS),
      maxS: Math.max(s.maxS, offS),
    };
    const seconds = (f.timestamp - s.t0) / 1000;
    if (seconds >= 5) {
      scheduleOnRN(onStats, {
        fps: next.n / seconds,
        droppedFrames: next.dropped,
        jitterMs: ((next.maxOff - next.minOff) / sampleRate) * 1000,
        smoothJitterMs: ((next.maxS - next.minS) / sampleRate) * 1000,
        seconds,
      });
      stats.value = FRESH;
    } else {
      stats.value = next;
    }
  });

  return { pos, frames };
}
