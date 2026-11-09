import { describe, expect, it, vi } from "vitest";
import type { Take } from "@/audio/take";
import { clickBeats } from "./beatGrid";
import { loopBars, retakeSong, songFromTake, takeLoop } from "./forgeTake";

const none = { beats: [] as number[], bpm: 0 };

describe("take → song in the app", () => {
  it("loops the most whole bars recorded, as 2, 4 or 8", () => {
    expect([0.4, 1.95, 3.2, 3.95, 4, 7.5, 9].map(loopBars)).toEqual([2, 2, 2, 4, 4, 4, 8]);
  });

  it("measures the take's own round trip from its count-in clicks when the mic heard them", async () => {
    const sr = 48000, bpm = 120, bar = 2 * sr, beat = sr / 2, lag = Math.round(0.137 * sr);
    const output = new Float32Array(5 * bar), input = new Float32Array(5 * bar);
    for (let k = 0; k < 4; k++) for (let i = 0; i < 480; i++) output[k * beat + i] = Math.sin(i * 0.3) * (1 - i / 480);
    for (let i = 0; i + lag < input.length; i++) input[i + lag] = 0.3 * output[i]! + 0.001 * Math.sin(i * 1.7);
    const take: Take = { input, output, sampleRate: sr, bpm, mood: "trap", click: true, countInFrames: bar, stoppedAt: 0 };
    const analyze = vi.fn(async () => ({ hits: [], f0: new Float32Array(0), f0Hop: 512 / sr, ...none }));
    const { rtl } = await songFromTake({ analyze, reportedLatency: () => ({}) }, take, null, 120);
    expect(rtl!.from).toBe("count-in");
    expect(rtl!.ms).toBeCloseTo(137, 0); // drifted 17 ms from the stored 120
  });

  it("plays back the looped bars of the take from bar 1's beat, shifted and peaked at −1 dBFS", () => {
    const sr = 48000, bar = 2 * sr;
    const input = new Float32Array(5 * bar + 4800);
    input[4800 + bar] = 0.25; // bar 1's first sample once shifted by the 100 ms round trip
    const take: Take = { input, output: new Float32Array(input.length), sampleRate: sr, bpm: 120, mood: "trap", click: true, countInFrames: bar, stoppedAt: 0 };
    const loop = takeLoop(take, { beats: clickBeats(120, 2, 5), bar1: 0, shiftSec: 0.1 }, { bars: 2 }); // 2 bars run past the beats: extrapolated
    expect(loop.length).toBe(2 * bar);
    expect(loop[0]).toBeCloseTo(0.891, 3);
  });

  it("over the click: shifts the take by the measured round trip, gives the engine the click it played, uses the click's beats", async () => {
    const sr = 48000, bpm = 120, bar = 2 * sr;
    const take: Take = { input: new Float32Array(5 * bar + 4800), output: new Float32Array(5 * bar + 4800), sampleRate: sr, bpm, mood: "trap", click: true, countInFrames: bar, stoppedAt: 0 };
    const analyze = vi.fn(async () => ({ hits: [{ t: 2 + 0.25, strength: 1, features: new Array(18).fill(0) }], f0: new Float32Array(0), f0Hop: 512 / sr, ...none }));
    const { song, rtl, heard } = await songFromTake({ analyze, reportedLatency: () => ({ outputLatency: 0.5 }) }, take, null, 100);
    expect(rtl!.from).toBe("calibration"); // the mic heard no clicks (silent take)
    const [input, ref] = analyze.mock.calls[0] as unknown as [Float32Array, Float32Array];
    expect(input.length).toBe(take.input.length - 4800); // 100 ms measured, not the OS's 500 ms
    expect(ref.length).toBe(input.length);
    expect(song.bars).toBe(4);
    expect(song.bpm).toBe(120);
    expect(song.tracks[0]!.notes.map((n) => n.tick / 240)).toEqual([2]);
    expect(heard.shiftSec).toBeCloseTo(0.1);
    expect(heard.beats[0]).toBe(2); // bar 1 = the count-in's end
  });

  it("with no click: analysed as recorded (nothing to subtract or line up), placed on the engine's beats", async () => {
    const sr = 48000;
    const take: Take = { input: new Float32Array(10 * sr), output: new Float32Array(10 * sr), sampleRate: sr, bpm: 90, mood: "boomBap", click: false, countInFrames: 0, stoppedAt: 0 };
    const beats = Array.from({ length: 13 }, (_, k) => 0.8 + k * 0.6); // 100 BPM, from 0.8 s
    const hit = (t: number, kind: number) => ({ t, strength: 1, features: Array.from({ length: 18 }, (_, i) => (i === 0 ? kind : 0)) });
    const hits = beats.slice(0, 12).flatMap((b, k) => [hit(b, k % 2 ? 10 : 0), hit(b + 0.3, 20)]);
    const analyze = vi.fn(async () => ({ hits, f0: new Float32Array(0), f0Hop: 512 / sr, beats, bpm: 100 }));
    const { song, rtl, heard } = await songFromTake({ analyze, reportedLatency: () => ({ outputLatency: 0.5 }) }, take, null, 100);
    expect(rtl).toBeNull();
    const [input, ref, centre] = analyze.mock.calls[0] as unknown as [Float32Array, Float32Array | undefined, number];
    expect(input.length).toBe(take.input.length);
    expect(ref).toBeUndefined();
    expect(centre).toBe(90); // the mood's tempo: where the beat tracker looks
    expect(song.bpm).toBe(100);
    expect(heard.shiftSec).toBe(0);
    expect(song.tracks[0]!.notes.length).toBeGreaterThan(0);

    const half = retakeSong(heard, "boomBap", null, "half");
    expect(half.song.bpm).toBe(50);
    const later = retakeSong(heard, "boomBap", null, 1);
    expect(later.heard.bar1).toBe(heard.bar1 + 1);
  });
});
