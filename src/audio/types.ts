import type { Song } from "@/song/types";

/** What the spike screen needs from each platform (spike.web.ts: Web Audio + WASM, spike.native.ts: audio-api + JSI). */
export interface SpikeAudio {
  platform: string;
  sampleRate: number;
  /** Loads a Song into the engine (only while stopped). */
  setSong(song: Song): Promise<void>;
  /** Opens the mic (processing off) and starts the loop from bar 1. */
  start(): Promise<void>;
  stop(): Promise<void>;
  setDrive(amount: number): void;
  captureStart(): void;
  /** Mic input and engine output, sample-aligned on the engine's frame clock. */
  captureStop(): Promise<{ input: Float32Array; output: Float32Array }>;
  /** OS / browser reported latencies in seconds, for comparison with the measured round trip. */
  reportedLatency(): Record<string, number>;
  /** The ports actually in use (iOS reports the current route; web only knows the mic label). */
  route(): Promise<{ inputs: string[]; outputs: string[] }>;
  /** Plays mono samples once through the live context (for listening back to takes). */
  playBuffer(samples: Float32Array): void;
  /** Renders exactly one loop of `song` offline through the same engine. */
  renderOffline(song: Song, drive: number): Promise<Float32Array>;
  close(): Promise<void>;
}

export const SAMPLE_RATE = 48000;
export const CAPTURE_SECONDS = 30;
