import { describe, expect, it } from "vitest";
import { noteTimeSec } from "@/song/time";
import type { DetectedHit } from "./analyze";
import { makeKit } from "./classify";
import { UNSURE } from "@/song/grid";
import { estimateSwing, takeToSong as fromAnalysis, type TakeInfo } from "./takeToSong";

const takeToSong = (hits: DetectedHit[], kit: Parameters<typeof fromAnalysis>[1], info: TakeInfo) => fromAnalysis({ hits, f0: new Float32Array(0), f0Hop: 512 / 48000 }, kit, info);

const bpm = 90, s16 = 60 / bpm / 4, countIn = 4 * 4 * s16;
// features: [0] tells the classes apart for the test kit; [13] is the brightness the no-kit guess uses
const f = (kind: number, centroid = 10) => { const x = new Array<number>(18).fill(0); x[0] = kind; x[13] = centroid; return x; };
const kit = makeKit([0, 1, 2].flatMap((k) => [0, 0.1, 0.2].map((d) => ({ cls: (["kick", "snare", "hatClosed"] as const)[k]!, f: f(k * 10 + d) }))));
const at = (i: number, swing: number, offMs = 0) => countIn + i * s16 + (i % 2 ? (swing - 0.5) * 2 * s16 : 0) + offMs / 1000;

describe("take → song", () => {
  it("estimates swing from the off-beat 16ths", () => {
    const times = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => at(i, 0.6) - countIn);
    expect(estimateSwing(times, s16)).toBeCloseTo(0.6, 2);
    expect(estimateSwing([0, 2 * s16], s16)).toBeNull(); // no off-beats: unknown
  });

  it("puts each hit on its swung 16th, keeps the feel as offsetMs, and plays back where it was hit", () => {
    const hits: DetectedHit[] = [
      { t: at(0, 0.6, 4), strength: 10, features: f(0) }, // kick, 4 ms late
      { t: at(1, 0.6, -3), strength: 5, features: f(20) }, // hat on a swung off-beat, 3 ms early
      { t: at(3, 0.6, 2), strength: 6, features: f(20.1) },
      { t: at(4, 0.6), strength: 9, features: f(10) }, // snare
      { t: at(5, 0.6, 1), strength: 5, features: f(20.2) },
      { t: at(7, 0.6, -1), strength: 5, features: f(20) },
      { t: 0.5, strength: 20, features: f(0) }, // in the count-in: not part of the song
    ];
    const song = takeToSong(hits, kit, { bpm, bars: 2, mood: "boomBap", countInSec: countIn });
    const notes = song.tracks[0]!.notes;
    expect(notes.map((n) => [n.tick / 240, n.lane])).toEqual([[0, "kick"], [1, "hatClosed"], [3, "hatClosed"], [4, "snare"], [5, "hatClosed"], [7, "hatClosed"]]);
    expect(song.swing).toBeCloseTo(0.6, 1);
    expect(notes[0]!.offsetMs).toBeCloseTo(4, 0);
    // with quantize 0 the song plays every hit where it was played (≤ 1 ms: the swing estimate is a median)
    const raw = { ...song, quantize: 0 };
    hits.slice(0, 6).forEach((h, k) => expect(Math.abs(noteTimeSec(notes[k]!, raw) - (h.t - countIn))).toBeLessThan(0.0015));
    expect(notes.every((n) => (n.confidence ?? 0) > UNSURE)).toBe(true);
  });

  it("keeps a 1/32 roll: two hits of one sound in one 16th go to 32nds", () => {
    const roll = [0, 1, 2, 3].map((k) => countIn + 8 * s16 + k * (s16 / 2)); // 4 hats over two 16ths
    const song = takeToSong(roll.map((t) => ({ t, strength: 1, features: f(20) })), kit, { bpm, bars: 2, mood: "trap", countInSec: countIn });
    const notes = song.tracks[0]!.notes;
    expect(notes.map((n) => n.tick / 240)).toEqual([8, 8.5, 9, 9.5]);
    const raw = { ...song, quantize: 0 };
    notes.forEach((n, k) => expect(Math.abs(noteTimeSec(n, raw) - (roll[k]! - countIn))).toBeLessThan(0.0005));
  });

  it("without a kit, guesses by brightness and marks every hit unsure", () => {
    const song = takeToSong([{ t: at(0, 0.5), strength: 1, features: f(0, 8) }, { t: at(2, 0.5), strength: 1, features: f(0, 13) }], null, { bpm, bars: 2, mood: "trap", countInSec: countIn });
    expect(song.tracks[0]!.notes.map((n) => [n.lane, n.confidence])).toEqual([["kick", 0], ["hatClosed", 0]]);
  });
});
