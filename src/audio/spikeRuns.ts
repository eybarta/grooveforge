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
  return Float32Array.from(take, (x, i) => Math.max(-1, Math.min(1, 0.9 * x + 0.5 * output[i]!)));
}
