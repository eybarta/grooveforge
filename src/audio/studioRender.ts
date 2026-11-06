import { songToEngineEvents } from "@/song/time";
import type { Song } from "@/song/types";
import { kitProgram } from "./kit";
import { LOUDNESS_TARGETS, masterTo, type LoudnessTarget } from "./master";
import { mixFor, type Knobs } from "./mix";
import type { AudioEngine, EngineProgram } from "./types";

/** Kit + mix for a song's mood, at the knob settings and master gain (the delay follows the song's tempo). */
export const studioProgram = (song: Song, knobs: Knobs, gainDb = 0): EngineProgram => ({
  ...kitProgram(song.mood),
  mix: mixFor(song.mood, knobs, song.bpm, gainDb),
});

/** Renders `loops` passes of a song, mastered to a loudness target (render → measure → adjust). */
export function masterSong(a: AudioEngine, song: Song, knobs: Knobs, target: LoudnessTarget, loops: number) {
  const frames = loops * songToEngineEvents(song, a.sampleRate).loopFrames;
  return masterTo(
    LOUDNESS_TARGETS[target],
    (g) => a.renderOffline(song, 0, frames, studioProgram(song, knobs, g)),
    (ch) => a.loudness(ch),
  );
}
