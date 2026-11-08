import { describe, expect, it, vi } from "vitest";
import type { Take } from "@/audio/take";
import { loopBars, songFromTake, takeLoop } from "./forgeTake";

describe("take → song in the app", () => {
  it("loops the most whole bars recorded, as 2, 4 or 8", () => {
    expect([0.4, 1.95, 3.2, 3.95, 4, 7.5, 9].map(loopBars)).toEqual([2, 2, 2, 4, 4, 4, 8]);
  });

  it("measures the take's own round trip from its count-in clicks when the mic heard them", async () => {
    const sr = 48000, bpm = 120, bar = 2 * sr, beat = sr / 2, lag = Math.round(0.137 * sr);
    const output = new Float32Array(5 * bar), input = new Float32Array(5 * bar);
    for (let k = 0; k < 4; k++) for (let i = 0; i < 480; i++) output[k * beat + i] = Math.sin(i * 0.3) * (1 - i / 480);
    for (let i = 0; i + lag < input.length; i++) input[i + lag] = 0.3 * output[i]! + 0.001 * Math.sin(i * 1.7);
    const take: Take = { input, output, sampleRate: sr, bpm, mood: "trap", countInFrames: bar, stoppedAt: 0 };
    const analyze = vi.fn(async () => ({ hits: [], f0: new Float32Array(0), f0Hop: 512 / sr }));
    const { rtl } = await songFromTake({ analyze, reportedLatency: () => ({}) }, take, null, 120);
    expect(rtl.from).toBe("count-in");
    expect(rtl.ms).toBeCloseTo(137, 0); // drifted 17 ms from the stored 120
  });

  it("plays back the looped bars of the take, shifted and peaked at −1 dBFS", () => {
    const sr = 48000, bar = 2 * sr;
    const input = new Float32Array(5 * bar + 4800);
    input[4800 + bar] = 0.25; // bar 1's first sample once shifted by the 100 ms round trip
    const take: Take = { input, output: new Float32Array(input.length), sampleRate: sr, bpm: 120, mood: "trap", countInFrames: bar, stoppedAt: 0 };
    const loop = takeLoop(take, { bars: 2 }, {}, 100);
    expect(loop.length).toBe(2 * bar);
    expect(loop[0]).toBeCloseTo(0.891, 3);
  });

  it("shifts the take by the measured round trip and gives the engine the click it played", async () => {
    const sr = 48000, bpm = 120, bar = 2 * sr;
    const take: Take = { input: new Float32Array(5 * bar + 4800), output: new Float32Array(5 * bar + 4800), sampleRate: sr, bpm, mood: "trap", countInFrames: bar, stoppedAt: 0 };
    const analyze = vi.fn(async () => ({ hits: [{ t: 2 + 0.25, strength: 1, features: new Array(18).fill(0) }], f0: new Float32Array(0), f0Hop: 512 / sr }));
    const { song, rtl } = await songFromTake({ analyze, reportedLatency: () => ({ outputLatency: 0.5 }) }, take, null, 100);
    expect(rtl.from).toBe("calibration"); // the mic heard no clicks (silent take)
    const [input, ref] = analyze.mock.calls[0] as unknown as [Float32Array, Float32Array];
    expect(input.length).toBe(take.input.length - 4800); // 100 ms measured, not the OS's 500 ms
    expect(ref.length).toBe(input.length);
    expect(song.bars).toBe(4);
    expect(song.tracks[0]!.notes.map((n) => [n.tick / 240, n.confidence])).toEqual([[2, 0]]); // no kit: unsure
  });
});
