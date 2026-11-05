/** Ticks per quarter note (MIDI-standard resolution). One 16th = 240 ticks. */
export const PPQ = 960;

export type DrumLane = "kick" | "snare" | "hatClosed" | "hatOpen" | "perc";
export type Lane = DrumLane | "bass" | "melody";

export interface NoteEvent {
  id: string;
  /** Grid position. */
  tick: number;
  lane: Lane;
  /** 0–1. */
  velocity: number;
  /** How far the performed hit was from `tick`: the user's feel. Quantize blends it out, never deletes it. */
  offsetMs: number;
  source: "detected" | "user";
  /** MIDI note, for bass / melody lanes. */
  pitch?: number;
  durationTicks?: number;
}

export interface Track {
  id: string;
  kind: "drums" | "bass" | "melody";
  name: string;
  notes: NoteEvent[];
  preset?: string;
  gainDb: number;
  muted: boolean;
  /** Rendered to audio while not being edited (saves CPU). */
  frozen: boolean;
}

export interface Song {
  id: string;
  bpm: number;
  bars: 2 | 4 | 8;
  mood: "boomBap" | "trap";
  /** 0 = the user's raw feel, 1 = hard grid. */
  quantize: number;
  /** Off-beat 16th position within its 8th: 0.5 = straight, ~0.55–0.62 = boom-bap swing. */
  swing: number;
  tracks: Track[];
}
