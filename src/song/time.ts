import { PPQ, type Lane, type NoteEvent, type Song } from "./types";

const SIXTEENTH = PPQ / 4;

export const secPerTick = (bpm: number) => 60 / (bpm * PPQ);

export const loopSeconds = (song: Song) => song.bars * 4 * 60 / song.bpm;

/** When a note sounds, in seconds from loop start: swung grid + the user's offset scaled by (1 − quantize). */
export function noteTimeSec(note: NoteEvent, song: Song): number {
  const offBeat16th = note.tick % (2 * SIXTEENTH) === SIXTEENTH;
  const swingTicks = offBeat16th ? (song.swing - 0.5) * 2 * SIXTEENTH : 0;
  return (note.tick + swingTicks) * secPerTick(song.bpm) + (note.offsetMs / 1000) * (1 - song.quantize);
}

/** Note length when a NoteEvent has none (one-shot samples ignore it; sine and 808 voices use it). */
const DEFAULT_DUR_SEC: Record<Lane, number> = {
  kick: 0.25, snare: 0.12, hatClosed: 0.04, hatOpen: 0.2, perc: 0.06, bass: 0.4, melody: 0.3,
};

export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/** Instrument slot per lane: the engine's instrument table is indexed in this order. */
export const LANES: readonly Lane[] = ["kick", "snare", "hatClosed", "hatOpen", "perc", "bass", "melody"];

/** Fields per event / per instrument in the flat buffers handed to the C++ engine (engine/include/gf/Engine.h). */
export const ENGINE_EVENT_STRIDE = 6;
export const ENGINE_INSTRUMENT_STRIDE = 4;

/** [kind, chokeGroup, gain, pan] per lane slot. Closed and open hat share choke group 1 (closed cuts open). */
export function defaultInstruments(): Float32Array {
  const SINE = 0;
  return Float32Array.from(
    LANES.flatMap((lane) => [SINE, lane === "hatClosed" || lane === "hatOpen" ? 1 : -1, 1, 0]),
  );
}

/**
 * Flattens the audible notes of a Song into [frame, instrument, velocity, note, durationFrames, glideNote] × n,
 * sorted by frame, for the C++ engine (JSI ArrayBuffer on native, postMessage on web). Frames wrap into [0, loopFrames).
 */
export function songToEngineEvents(song: Song, sampleRate: number): { events: Float32Array; loopFrames: number } {
  const loopFrames = Math.round(loopSeconds(song) * sampleRate);
  const rows: number[][] = [];
  for (const track of song.tracks) {
    if (track.muted) continue;
    const gain = 10 ** (track.gainDb / 20);
    for (const n of track.notes) {
      const frame = Math.round(noteTimeSec(n, song) * sampleRate);
      const note = n.pitch ?? 60; // sampler: 60 = the sample's original pitch
      const dur = n.durationTicks === undefined
        ? DEFAULT_DUR_SEC[n.lane] * sampleRate
        : n.durationTicks * secPerTick(song.bpm) * sampleRate;
      const wrapped = ((frame % loopFrames) + loopFrames) % loopFrames;
      rows.push([wrapped, LANES.indexOf(n.lane), n.velocity * gain, note, Math.round(dur), -1]);
    }
  }
  rows.sort((a, b) => a[0]! - b[0]!);
  return { events: Float32Array.from(rows.flat()), loopFrames };
}
