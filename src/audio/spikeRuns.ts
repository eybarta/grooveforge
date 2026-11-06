import { loopSeconds } from "@/song/time";
import { alignTake, estimateLags, summarize, type LatencyResult } from "./latency";
import { clickSong } from "./spikeSongs";
import type { SpikeAudio } from "./types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plays one loop of 8 calibration clicks and returns the aligned mic + engine-output capture. */
export async function recordClicks(audio: SpikeAudio) {
  const song = clickSong();
  await audio.stop();
  await audio.setSong(song);
  audio.captureStart(); // before play, so the first click is captured too
  await audio.start();
  await wait(loopSeconds(song) * 1000 + 700); // + headroom for a Bluetooth-sized round trip
  const cap = await audio.captureStop();
  await audio.stop();
  return cap;
}

export interface Calibration {
  runs: LatencyResult[];
  rtlMs: number;
  /** max − min of the per-run round trips: the ±1 ms repeatability criterion. */
  repeatabilityMs: number;
  /** Every run heard ≥ 6 of its clicks clearly; otherwise re-run (mic covered? too quiet?). */
  reliable: boolean;
}

export async function calibrate(audio: SpikeAudio, runs = 3): Promise<Calibration> {
  const results: LatencyResult[] = [];
  for (let i = 0; i < runs; i++) {
    const { input, output } = await recordClicks(audio);
    results.push(summarize(estimateLags(output, input, audio.sampleRate), audio.sampleRate));
  }
  const rtls = results.map((r) => r.rtlMs).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    runs: results,
    rtlMs: rtls.length ? rtls[rtls.length >> 1]! : NaN,
    repeatabilityMs: rtls.length ? rtls[rtls.length - 1]! - rtls[0]! : NaN,
    reliable: results.every((r) => r.clicks >= 6),
  };
}

/** Records the clicks again, shifts the take by the calibrated round trip, and measures what's left (target ≤ 1 ms). */
export async function verifyAlignment(audio: SpikeAudio, rtlMs: number) {
  const { input, output } = await recordClicks(audio);
  const aligned = alignTake(input, (rtlMs / 1000) * audio.sampleRate);
  return summarize(estimateLags(output, aligned, audio.sampleRate, -0.01, 0.05), audio.sampleRate);
}

/**
 * Your take over the loop you heard: mic input shifted by the round trip, plus the engine's own output capture.
 * Both were captured on the engine's frame clock, so the mix is sample-accurate (no scheduling guesswork).
 */
export function mixTakeWithLoop(input: Float32Array, output: Float32Array, rtlFrames: number): Float32Array {
  const take = alignTake(input, rtlFrames);
  const g = 0.7 / Math.max(1e-6, takeLevel(take).peak); // take normalised to −3 dBFS (BUILD_PLAN capture step)
  return Float32Array.from(take, (x, i) => Math.max(-1, Math.min(1, g * x + 0.5 * output[i]!)));
}

/** Peak and clipped-sample count of a raw take: was the mic overdriven, or just loud? */
export function takeLevel(x: Float32Array) {
  let peak = 0, clipped = 0;
  for (const v of x) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
  }
  return { peak, peakDbfs: 20 * Math.log10(Math.max(peak, 1e-9)), clipped };
}
