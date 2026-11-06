import { LANES } from "@/song/time";
import type { Mood } from "./kit";

/** gf::Buses fields in engine layout order (engine/include/gf/Engine.h); mix.test.ts checks them against the header. */
export const BUS_FIELDS = [
  "glueThreshDb", "glueRatio", "glueAttackMs", "glueReleaseMs",
  "smashThreshDb", "smashRatio", "smashMix",
  "tapeDrive", "tapeToneHz", "busLpfHz",
  "reverbRoomMs", "reverbRt20", "reverbHighCutHz", "reverbReturn",
  "delaySec", "delayFeedback", "delayLpfHz", "delayReturn",
  "masterGainDb", "limitDb",
] as const;
/** gf::Strip fields in engine layout order. */
export const STRIP_FIELDS = [
  "bus", "hpfHz", "lowHz", "lowDb", "midHz", "midDb", "highHz", "highDb", "lpfHz",
  "attackDb", "sustainDb", "satDrive", "satToneHz", "satCutHz", "reverbSend", "delaySend",
] as const;

export type Buses = Record<(typeof BUS_FIELDS)[number], number>;
export type Strip = Record<(typeof STRIP_FIELDS)[number], number>;

/** The engine's defaults: every stage bypassed. */
export const DEFAULT_STRIP: Strip = {
  bus: 1, hpfHz: 0, lowHz: 100, lowDb: 0, midHz: 1000, midDb: 0, highHz: 8000, highDb: 0, lpfHz: 0,
  attackDb: 0, sustainDb: 0, satDrive: 0, satToneHz: 8000, satCutHz: 20, reverbSend: 0, delaySend: 0,
};
export const DEFAULT_BUSES: Buses = {
  glueThreshDb: 0, glueRatio: 1, glueAttackMs: 20, glueReleaseMs: 150,
  smashThreshDb: -30, smashRatio: 1, smashMix: 0,
  tapeDrive: 0, tapeToneHz: 8000, busLpfHz: 0,
  reverbRoomMs: 60, reverbRt20: 1, reverbHighCutHz: 9000, reverbReturn: 0,
  delaySec: 0.375, delayFeedback: 0.3, delayLpfHz: 5000, delayReturn: 0,
  masterGainDb: 0, limitDb: 0,
};

const DRUM_BUS = 0;
type Lane = (typeof LANES)[number];
interface Preset {
  strips: Partial<Record<Lane, Partial<Strip>>>;
  buses: Partial<Buses> & { delayBeats: number };
}

/**
 * Mood mixes. Boom Bap: dusty — tape-saturated, low-passed drum bus, warm short room, round 808.
 * Trap: tight and bright — clean bus, airy hats, longer verb, gritty 808.
 */
const PRESETS: Record<Mood, Preset> = {
  boomBap: {
    strips: {
      kick: { bus: DRUM_BUS, hpfHz: 30, lowHz: 70, lowDb: 2.5, midHz: 380, midDb: -3, highHz: 4500, highDb: 1, attackDb: 3, sustainDb: -1 },
      snare: { bus: DRUM_BUS, hpfHz: 90, lowHz: 220, lowDb: 1.5, midHz: 900, midDb: -2, highHz: 6000, highDb: 1.5, attackDb: 2, reverbSend: 0.14 },
      hatClosed: { bus: DRUM_BUS, hpfHz: 350, highHz: 9000, highDb: -1.5, reverbSend: 0.04 },
      hatOpen: { bus: DRUM_BUS, hpfHz: 350, highHz: 9000, highDb: -1.5, reverbSend: 0.06 },
      perc: { bus: DRUM_BUS, hpfHz: 400, reverbSend: 0.08 },
      bass: { hpfHz: 28, lowHz: 60, lowDb: 1, satDrive: 2.5, satToneHz: 2500 },
      melody: { hpfHz: 120, reverbSend: 0.2, delaySend: 0.15 },
    },
    buses: {
      glueThreshDb: -16, glueRatio: 2.5, glueAttackMs: 25, glueReleaseMs: 160,
      smashThreshDb: -32, smashRatio: 8, smashMix: 0.25,
      tapeDrive: 2, tapeToneHz: 7000, busLpfHz: 11000,
      reverbRoomMs: 60, reverbRt20: 0.8, reverbHighCutHz: 7000, reverbReturn: 0.6,
      delayBeats: 0.75, delayFeedback: 0.3, delayLpfHz: 3500, delayReturn: 0.5,
    },
  },
  trap: {
    strips: {
      kick: { bus: DRUM_BUS, hpfHz: 30, lowHz: 60, lowDb: 1.5, midHz: 320, midDb: -3, highHz: 6000, highDb: 2, attackDb: 2, sustainDb: -2 },
      snare: { bus: DRUM_BUS, hpfHz: 150, midHz: 1000, midDb: -1, highHz: 7000, highDb: 2.5, attackDb: 1, reverbSend: 0.15 },
      hatClosed: { bus: DRUM_BUS, hpfHz: 500, highHz: 10000, highDb: 2, reverbSend: 0.02 },
      hatOpen: { bus: DRUM_BUS, hpfHz: 450, highHz: 10000, highDb: 1.5, reverbSend: 0.05 },
      perc: { bus: DRUM_BUS, hpfHz: 300, highHz: 8000, highDb: 2, reverbSend: 0.15, delaySend: 0.1 },
      bass: { hpfHz: 25, satDrive: 4, satToneHz: 5000 },
      melody: { hpfHz: 120, reverbSend: 0.25, delaySend: 0.2 },
    },
    buses: {
      glueThreshDb: -14, glueRatio: 2, glueAttackMs: 10, glueReleaseMs: 100,
      smashThreshDb: -30, smashRatio: 6, smashMix: 0.15,
      reverbRoomMs: 50, reverbRt20: 1.2, reverbHighCutHz: 10000, reverbReturn: 0.6,
      delayBeats: 0.75, delayFeedback: 0.35, delayLpfHz: 6000, delayReturn: 0.5,
    },
  },
};

/** The studio's macro knobs, 0–1 (0.5 = the preset as voiced). */
export interface Knobs {
  /** Drum transients + parallel smash. */
  punch: number;
  /** Reverb + delay sends. */
  space: number;
}
export const DEFAULT_KNOBS: Knobs = { punch: 0.5, space: 0.5 };

/** True-peak ceiling of every mood's master (CLAUDE.md export bar: ≤ −1 dBTP). */
const CEILING_DB = -1;

/**
 * The flat mix setMix() takes: buses, then one strip per lane (LANES order = instrument index).
 * `gainDb` drives the master limiter (masterTo() finds the value that hits a loudness target).
 */
export function mixFor(mood: Mood, knobs: Knobs, bpm: number, gainDb = 0): Float32Array {
  const { strips, buses } = PRESETS[mood];
  const punch = 2 * knobs.punch, space = 2 * knobs.space;
  const { delayBeats, ...rest } = buses;
  const b: Buses = { ...DEFAULT_BUSES, ...rest, delaySec: (delayBeats * 60) / bpm, masterGainDb: gainDb, limitDb: CEILING_DB };
  b.smashMix = Math.min(1, b.smashMix * punch);
  const rows = LANES.map((lane) => {
    const s: Strip = { ...DEFAULT_STRIP, ...strips[lane] };
    if (s.bus === DRUM_BUS) s.attackDb *= punch;
    s.reverbSend *= space;
    s.delaySend *= space;
    return STRIP_FIELDS.map((f) => s[f]);
  });
  return Float32Array.from([...BUS_FIELDS.map((f) => b[f]), ...rows.flat()]);
}
