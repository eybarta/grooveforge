import { alignTake, takeShiftSec } from "@/audio/latency";
import type { Take } from "@/audio/take";
import type { AudioEngine } from "@/audio/types";
import type { Song } from "@/song/types";
import { makeKit, type Template } from "./classify";
import { takeToSong } from "./takeToSong";

/** The loop length for a take: the most whole bars recorded, as 2, 4 or 8 (a take stopped early still makes 2). */
export function loopBars(recordedBars: number): Song["bars"] {
  const full = Math.floor(recordedBars + 0.1);
  return full >= 8 ? 8 : full >= 4 ? 4 : 2;
}

/**
 * The stretch of the take its song loops (bar 1 on, `song.bars` bars), shifted by the round trip like the analysis,
 * peaked at −1 dBFS: what "Your mouth" plays against the Studio.
 */
export function takeLoop(take: Take, song: Pick<Song, "bars">, reported: Record<string, number>, rtlMs: number | null): Float32Array {
  const sr = take.sampleRate;
  const input = alignTake(take.input, takeShiftSec(reported, rtlMs) * sr);
  const loop = input.slice(take.countInFrames, take.countInFrames + Math.round(song.bars * ((4 * 60 * sr) / take.bpm)));
  let peak = 0;
  for (const v of loop) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < loop.length; i++) loop[i]! *= 0.891 / peak;
  return loop;
}

/**
 * A recorded take → its song (BUILD_PLAN P2): shifted by the round trip, analysed by the engine off the UI thread
 * (native: the JS thread; web: a worker) with the click subtracted, then hits → drums and hum → 808 with the user's
 * taught kit (none yet: lanes guessed, all marked unsure).
 */
export async function songFromTake(audio: Pick<AudioEngine, "analyze" | "reportedLatency">, take: Take, templates: Template[] | null, rtlMs: number | null) {
  const sr = take.sampleRate;
  const input = alignTake(take.input, takeShiftSec(audio.reportedLatency(), rtlMs) * sr);
  const t0 = performance.now();
  const analysis = await audio.analyze(input, take.output.subarray(0, input.length));
  const analysedMs = performance.now() - t0;
  const bars = loopBars((input.length - take.countInFrames) / ((4 * 60 * sr) / take.bpm));
  const song = takeToSong(analysis, templates?.length ? makeKit(templates) : null, { bpm: take.bpm, bars, mood: take.mood, countInSec: take.countInFrames / sr });
  return { song, analysis, analysedMs };
}
