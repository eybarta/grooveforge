import { alignTake, takeRoundTrip } from "@/audio/latency";
import type { Heard, Take } from "@/audio/take";
import type { AudioEngine } from "@/audio/types";
import type { Song } from "@/song/types";
import { beatTime, clickBeats, loopBars, retimeBeats } from "./beatGrid";
import { makeKit, type Template } from "./classify";
import { takeToSong, type TakeInfo } from "./takeToSong";

export { loopBars } from "./beatGrid";

const userKit = (templates: Template[] | null) => (templates?.length ? makeKit(templates) : null);

/** The stretch of the take its song loops (bar 1's beat to the beat after the last bar), peaked at −1 dBFS: "Your mouth". */
export function takeLoop(take: Take, heard: Pick<Heard, "beats" | "bar1" | "shiftSec">, song: Pick<Song, "bars">): Float32Array {
  const sr = take.sampleRate;
  const input = alignTake(take.input, heard.shiftSec * sr);
  const loop = input.slice(Math.round(beatTime(heard.beats, heard.bar1) * sr), Math.round(beatTime(heard.beats, heard.bar1 + 4 * song.bars) * sr));
  let peak = 0;
  for (const v of loop) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < loop.length; i++) loop[i]! *= 0.891 / peak;
  return loop;
}

/**
 * A recorded take → its song (BUILD_PLAN P2), analysed by the engine off the UI thread (native: the JS thread; web: a
 * worker). Over the click: shifted by the round trip (the take's own count-in, else the route's calibration), the click
 * subtracted, its beats the click's. With no click: as recorded (nothing played, nothing to line up), the beats the
 * engine found around the mood's tempo. The user's kit (taught + fixes) names the sounds when it can.
 */
export async function songFromTake(audio: Pick<AudioEngine, "analyze" | "reportedLatency">, take: Take, templates: Template[] | null, rtlMs: number | null) {
  const sr = take.sampleRate;
  const rtl = take.click ? takeRoundTrip(take, audio.reportedLatency(), rtlMs) : null;
  const shiftSec = rtl ? rtl.ms / 1000 : 0;
  const input = alignTake(take.input, shiftSec * sr);
  const t0 = performance.now();
  const analysis = await audio.analyze(input, take.click ? take.output.subarray(0, input.length) : undefined, take.bpm);
  const analysedMs = performance.now() - t0;
  const info: TakeInfo = take.click
    ? {
      mood: take.mood, beats: clickBeats(take.bpm, take.countInFrames / sr, input.length / sr), bar1: 0,
      bars: loopBars((input.length - take.countInFrames) / ((4 * 60 * sr) / take.bpm)),
    }
    : { mood: take.mood, beats: analysis.beats };
  const { song, sounds, bar1, beats } = takeToSong(analysis, userKit(templates), info);
  const heard: Heard = { analysis, beats, bar1, sounds, shiftSec };
  return { song, analysis, analysedMs, rtl, heard };
}

/** The take's song again at half or double the tempo, or with bar 1 a beat earlier / later (the user's edits reset). */
export function retakeSong(heard: Heard, mood: Song["mood"], templates: Template[] | null, change: "half" | "double" | -1 | 1) {
  const grid = retimeBeats(heard.beats, heard.bar1, change);
  const { song, sounds, bar1, beats } = takeToSong(heard.analysis, userKit(templates), { mood, ...grid });
  return { song, heard: { ...heard, beats, bar1, sounds } };
}
