import type { Song } from "@/song/types";
import type { Measured } from "./master";

/** The engine's transport clock, readable every frame from the UI thread (worklets) without touching React state. */
export interface AudioClock {
  /** Engine frames processed since play(): ahead of what's audible by the output latency. */
  readonly frame: number;
  readonly loopFrames: number;
  readonly playing: boolean;
}

/** Decoded audio for the sampler (r === l for mono). */
export interface DecodedSample {
  l: Float32Array;
  r: Float32Array;
  sampleRate: number;
}

/** Instrument table, sampler zones and mix (flat rows, see engine/include/gf/Engine.h). Swapped lock-free while playing. */
export interface EngineProgram {
  instruments: Float32Array;
  zones?: Float32Array;
  /** Strips + buses (src/audio/mix.ts); omitted = the transparent mix. */
  mix?: Float32Array;
}

/**
 * iOS audio-session mode (web: no-op). measurement = no system processing on mic or output (Apple: lower playback
 * level); default = normal processing, louder speaker.
 */
export type SessionMode = "measurement" | "default";

/** The C++ engine on each platform: engine.web.ts (Web Audio + WASM worklet), engine.native.ts (audio-api + JSI). */
export interface AudioEngine {
  platform: string;
  sampleRate: number;
  clock: AudioClock;
  /** Loads a Song's notes. Safe while playing: lands at the next audio block. */
  setSong(song: Song): Promise<void>;
  /** Instruments + zones (e.g. a kit mood). Safe while playing. */
  setProgram(p: EngineProgram): Promise<void>;
  /** Decodes a bundled audio asset (a `require()`d module). */
  decode(file: number | string): Promise<DecodedSample>;
  /** Copies a decoded sample into a write-once engine slot. */
  loadSample(slot: number, s: DecodedSample): Promise<boolean>;
  /** Opens the mic (processing off) and starts the loop from bar 1. */
  start(): Promise<void>;
  stop(): Promise<void>;
  setDrive(amount: number): void;
  setSessionMode(mode: SessionMode): void;
  captureStart(): void;
  /** Mic input and engine output (left), sample-aligned on the engine's frame clock. */
  captureStop(): Promise<{ input: Float32Array; output: Float32Array }>;
  /** OS / browser reported latencies in seconds, for comparison with the measured round trip. */
  reportedLatency(): Record<string, number>;
  /** The ports actually in use (iOS reports the current route; web only knows the mic label). */
  route(): Promise<{ inputs: string[]; outputs: string[] }>;
  /** Plays samples once through the live context, one array per channel (for listening back to takes). */
  playBuffer(channels: Float32Array[]): void;
  /** Renders `song` offline through the same engine, kit and program (or `program`): one loop, or `frames`. [L, R]. */
  renderOffline(song: Song, drive: number, frames?: number, program?: EngineProgram): Promise<Float32Array[]>;
  /** EBU R128 integrated loudness + true peak (libebur128 in the engine). */
  loudness(channels: Float32Array[]): Promise<Measured>;
  close(): Promise<void>;
}

export const SAMPLE_RATE = 48000;
export const CAPTURE_SECONDS = 30;
