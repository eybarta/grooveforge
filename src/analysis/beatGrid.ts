/**
 * A take's beat grid (P2 re-scope: no click by default). The engine finds the beats (engine/src/Beats.cpp); here bar 1
 * is chosen and times become positions on the beat, so hits land on the grid even when the user drifted.
 */
import type { DrumLane, Song } from "@/song/types";

/** The loop length for a take: the most whole bars recorded, as 2, 4 or 8 (a take stopped early still makes 2). */
export function loopBars(recordedBars: number): Song["bars"] {
  const full = Math.floor(recordedBars + 0.1);
  return full >= 8 ? 8 : full >= 4 ? 4 : 2;
}

/** Beats of a click take: one every 60 / bpm s from bar 1 (the count-in's end) to the end of the take. */
export function clickBeats(bpm: number, bar1Sec: number, durationSec: number): number[] {
  const spb = 60 / bpm;
  return Array.from({ length: Math.max(0, Math.floor((durationSec - bar1Sec) / spb) + 1) }, (_, k) => bar1Sec + k * spb);
}

/** `t` (s) as a beat position: k + how far it is from beat k to beat k + 1 (outside the beats: the edge spacing). */
export function beatPosition(beats: number[], t: number): number {
  const n = beats.length;
  if (n < 2) return 0;
  let k = 0;
  while (k < n - 2 && t >= beats[k + 1]!) k++; // shortcut: linear scan, a take has at most a few hundred beats
  return k + (t - beats[k]!) / (beats[k + 1]! - beats[k]!);
}

/** Beat k's time (s); outside the beats, extrapolated at the edge spacing (the inverse of beatPosition). */
export function beatTime(beats: number[], k: number): number {
  const n = beats.length;
  if (k >= 0 && k < n) return beats[k]!;
  const [a, b] = k < 0 ? [0, 1] : [n - 2, n - 1];
  return beats[a]! + (k - a) * (beats[b]! - beats[a]!);
}

/** The beats at half or double the tempo, or bar 1 a beat earlier / later (the Studio's tempo and bar 1 fixes). */
export function retimeBeats(beats: number[], bar1: number, change: "half" | "double" | -1 | 1): { beats: number[]; bar1: number } {
  if (change === "half") return { beats: beats.filter((_, i) => (i - bar1) % 2 === 0), bar1: Math.floor(bar1 / 2) };
  if (change === "double") return { beats: beats.flatMap((b, i) => (i + 1 < beats.length ? [b, (b + beats[i + 1]!) / 2] : [b])), bar1: 2 * bar1 };
  if (bar1 + change >= 0) return { beats, bar1: bar1 + change };
  return { beats: [beatTime(beats, -1), ...beats], bar1: 0 }; // before the first beat: one more, a beat earlier
}

/** The tempo of the beats: their median spacing. */
export function beatsBpm(beats: number[]): number {
  const gaps = beats.slice(1).map((b, i) => b - beats[i]!).sort((a, b) => a - b);
  return gaps.length ? 60 / gaps[gaps.length >> 1]! : 0;
}

/** Where kicks and snares sit in a 4-beat bar (beat 0 = the one): Boom Bap backbeat on 2 and 4; Trap half-time snare on 3. */
const ACCENTS: Record<Song["mood"], { kick: number[]; snare: number[] }> = {
  boomBap: { kick: [0, 2], snare: [1, 3] },
  trap: { kick: [0], snare: [2] },
};

/**
 * Which beat is bar 1's: of the four phases, the one whose kicks fall on the mood's kick beats and snares on its snare
 * beats (hits within an 8th of a beat count); ties go to the earliest (people usually start on the one).
 */
export function findBar1(beats: number[], hits: { t: number; cls: DrumLane }[], mood: Song["mood"]): number {
  const { kick, snare } = ACCENTS[mood];
  const score = [0, 0, 0, 0];
  for (const h of hits) {
    const pos = beatPosition(beats, h.t), k = Math.round(pos);
    if (Math.abs(pos - k) > 0.125 || (h.cls !== "kick" && h.cls !== "snare")) continue;
    for (let phase = 0; phase < 4; phase++) {
      const inBar = (((k - phase) % 4) + 4) % 4;
      if (h.cls === "kick" && kick.includes(inBar)) score[phase]! += inBar === 0 ? 2 : 1;
      if (h.cls === "snare" && snare.includes(inBar)) score[phase]! += 2;
      if (h.cls === "snare" && inBar === 0) score[phase]! -= 1; // a snare on the one is rare
    }
  }
  return score.reduce((best, s, i) => (s > score[best]! ? i : best), 0);
}
