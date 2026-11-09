import { describe, expect, it } from "vitest";
import { UNSURE } from "@/song/grid";
import { noteTimeSec } from "@/song/time";
import type { DetectedHit } from "./analyze";
import { clickBeats } from "./beatGrid";
import { makeKit } from "./classify";
import { estimateSwing, takeToSong as fromAnalysis, type TakeInfo } from "./takeToSong";

const takeToSong = (hits: DetectedHit[], kit: Parameters<typeof fromAnalysis>[1], info: TakeInfo) =>
  fromAnalysis({ hits, f0: new Float32Array(0), f0Hop: 512 / 48000, beats: [], bpm: 0 }, kit, info);

const bpm = 90, s16 = 60 / bpm / 4, countIn = 4 * 4 * s16;
/** A click take's grid: the click's beats from the count-in's end, bar 1 known. */
const click = (mood: "boomBap" | "trap", bars: 2 | 4 = 2): TakeInfo => ({ mood, beats: clickBeats(bpm, countIn, countIn + 20), bar1: 0, bars });
// features: [0] tells the classes apart for the test kit (which covers kick, snare and hat: each hit is named alone)
const f = (kind: number) => { const x = new Array<number>(18).fill(0); x[0] = kind; return x; };
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
      { t: 0.5, strength: 20, features: f(0) }, // in the count-in: not part of the song
      { t: at(0, 0.6, 4), strength: 10, features: f(0) }, // kick, 4 ms late
      { t: at(1, 0.6, -3), strength: 5, features: f(20) }, // hat on a swung off-beat, 3 ms early
      { t: at(3, 0.6, 2), strength: 6, features: f(20.1) },
      { t: at(4, 0.6), strength: 9, features: f(10) }, // snare
      { t: at(5, 0.6, 1), strength: 5, features: f(20.2) },
      { t: at(7, 0.6, -1), strength: 5, features: f(20) },
    ];
    const { song } = takeToSong(hits, kit, click("boomBap"));
    const notes = song.tracks[0]!.notes;
    expect(notes.map((n) => [n.tick / 240, n.lane])).toEqual([[0, "kick"], [1, "hatClosed"], [3, "hatClosed"], [4, "snare"], [5, "hatClosed"], [7, "hatClosed"]]);
    expect(song.bpm).toBe(90);
    expect(song.swing).toBeCloseTo(0.6, 1);
    expect(notes[0]!.offsetMs).toBeCloseTo(4, 0);
    // with quantize 0 the song plays every hit where it was played (≤ 1.5 ms: the swing estimate is a median)
    const raw = { ...song, quantize: 0 };
    hits.slice(1).forEach((h, k) => expect(Math.abs(noteTimeSec(notes[k]!, raw) - (h.t - countIn))).toBeLessThan(0.0015));
    expect(notes.every((n) => (n.confidence ?? 0) > UNSURE)).toBe(true);
  });

  it("keeps a 1/32 roll: two hits of one sound in one 16th go to 32nds", () => {
    const roll = [0, 1, 2, 3].map((k) => countIn + 8 * s16 + k * (s16 / 2)); // 4 hats over two 16ths
    const { song } = takeToSong([...roll.map((t) => ({ t, strength: 1, features: f(20) })), { t: countIn, strength: 1, features: f(0) }, { t: countIn + 4 * s16, strength: 1, features: f(10) }], kit, click("trap"));
    const hats = song.tracks[0]!.notes.filter((n) => n.lane === "hatClosed");
    expect(hats.map((n) => n.tick / 240)).toEqual([8, 8.5, 9, 9.5]);
    const raw = { ...song, quantize: 0 };
    hats.forEach((n, k) => expect(Math.abs(noteTimeSec(n, raw) - (roll[k]! - countIn))).toBeLessThan(0.0005));
  });

  it("with no click, places hits by the take's own beats (drift lands on the grid) and finds bar 1 from the backbeat", () => {
    // the user starts on beat 4 (a snare), then a bar of kick, hat, snare, hat… slowing from 0.5 to 0.62 s per beat
    const beats = [1, 1.5, 2.02, 2.56, 3.12, 3.7, 4.3, 4.92, 5.54];
    const hits: DetectedHit[] = [];
    beats.forEach((b, k) => {
      const inBar = (k + 3) % 4; // beat 0 is the bar's 4th
      if (inBar === 0) hits.push({ t: b + 0.003, strength: 10, features: f(0) });
      if (inBar === 1 || inBar === 3) hits.push({ t: b - 0.002, strength: 8, features: f(10) });
      if (k + 1 < beats.length) hits.push({ t: (b + beats[k + 1]!) / 2, strength: 4, features: f(20) }); // hats on the and
    });
    hits.sort((a, b) => a.t - b.t);
    const { song, bar1 } = takeToSong(hits, kit, { mood: "boomBap", beats });
    expect(bar1).toBe(1); // the second beat is the one
    const notes = song.tracks[0]!.notes;
    expect(notes.filter((n) => n.lane === "kick").map((n) => n.tick / 240)).toEqual([0, 16]); // every bar's one
    expect(song.bars).toBe(2);
    expect(notes.filter((n) => n.lane === "snare").map((n) => n.tick / 240)).toEqual([4, 12, 20, 28]); // 2 and 4
    expect(notes.filter((n) => n.lane === "hatClosed").map((n) => n.tick / 240)).toEqual([2, 6, 10, 14, 18, 22, 26]); // every and
    expect(notes.every((n) => Math.abs(n.offsetMs) < 6)).toBe(true); // the drift isn't "feel"
  });

  it("untaught, groups the take's hits by sound: a group never mixes two sounds (so one fix fixes a sound)", () => {
    const a = [3, -2, 1, 0.5], b = [-4, 3, 0, -1], c = [1, 2, -3, 2]; // three distinct sounds (first 4 features)
    const feat = (v: number[]) => [...v, ...new Array<number>(14).fill(0.1)];
    const hits = Array.from({ length: 12 }, (_, i) => ({ t: countIn + i * 2 * s16, strength: 1, features: feat([a, b, c][i % 3]!.map((x) => x + 0.01 * i)) }));
    const notes = takeToSong(hits, null, click("boomBap")).song.tracks[0]!.notes;
    expect(notes).toHaveLength(12);
    for (const g of new Set(notes.map((n) => n.sound))) {
      const members = notes.flatMap((n, i) => (n.sound === g ? [i % 3] : []));
      expect(new Set(members).size).toBe(1); // one sound per group
      expect(new Set(notes.filter((n) => n.sound === g).map((n) => n.lane)).size).toBe(1);
    }
    expect(notes.every((n) => n.sound !== undefined && n.confidence !== undefined)).toBe(true);
  });
});
