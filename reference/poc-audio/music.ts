export type Flavor = "funk" | "trap" | "house" | "bap" | "afro";

export type DrumLane = "kick" | "snare" | "hat" | "perc";

export type Lane = DrumLane | "bass";

export type EventSource = "mic" | "dress" | "user";

export interface HitEvent {
  lane: Lane;
  velocity: number;
  source: EventSource;
  degree: number;
}

export interface DetectedHit {
  time: number;
  lane: DrumLane;
  velocity: number;
}

export interface Analysis {
  duration: number;
  bpm: number;
  hits: DetectedHit[];
  origin: number;
  bars: number;
}

export const STEPS_PER_BAR = 16;

export const FLAVORS: { id: Flavor; label: string; blurb: string }[] = [
  {
    id: "funk",
    label: "Funk",
    blurb: "Swing, snap, and a bass line walking the kicks you actually played.",
  },
  {
    id: "trap",
    label: "808",
    blurb: "Tuned sub kicks, tight hats, and a soft clip on the drum bus.",
  },
  {
    id: "house",
    label: "House",
    blurb: "Dry kick, stacked clap, offbeat bass, and a sidechain pump.",
  },
  {
    id: "bap",
    label: "Bap",
    blurb: "Short dusty drums, loose swing, and a round muted bass.",
  },
  {
    id: "afro",
    label: "Afro",
    blurb: "Round kick, shaker hats, bass sitting just beside the kick.",
  },
];

export const FLAVOR_SWING: Record<Flavor, number> = {
  funk: 0.58,
  trap: 0.51,
  house: 0.5,
  bap: 0.61,
  afro: 0.55,
};

export const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export const SCALES: Record<Flavor, number[]> = {
  funk: [0, 2, 3, 5, 7, 9, 10, 12],
  trap: [0, 3, 5, 7, 10, 12, 15],
  house: [0, 3, 7, 10, 12],
  bap: [0, 3, 5, 7, 10, 12],
  afro: [0, 2, 4, 7, 9, 12, 14],
};

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function degreeToMidi(root: number, flavor: Flavor, degree: number, octaveShift: number): number {
  const scale = SCALES[flavor];
  const d = Math.trunc(degree);
  const wrapped = ((d % scale.length) + scale.length) % scale.length;
  const oct = Math.floor(d / scale.length);
  return root + scale[wrapped] + (oct + octaveShift) * 12;
}

export function sliderToGain(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return v * v;
}

export interface Mix {
  kick: number;
  snare: number;
  hat: number;
  perc: number;
  bass: number;
  room: number;
  swing: number;
  humanize: boolean;
  flavor: Flavor;
  root: number;
}
