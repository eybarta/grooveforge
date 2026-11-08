import { describe, expect, it, vi } from "vitest";
import type { Take } from "@/audio/take";
import { loopBars, songFromTake } from "./forgeTake";

describe("take → song in the app", () => {
  it("loops the most whole bars recorded, as 2, 4 or 8", () => {
    expect([0.4, 1.95, 3.2, 3.95, 4, 7.5, 9].map(loopBars)).toEqual([2, 2, 2, 4, 4, 4, 8]);
  });

  it("shifts the take by the measured round trip and gives the engine the click it played", async () => {
    const sr = 48000, bpm = 120, bar = 2 * sr;
    const take: Take = { input: new Float32Array(5 * bar + 4800), output: new Float32Array(5 * bar + 4800), sampleRate: sr, bpm, mood: "trap", countInFrames: bar, stoppedAt: 0 };
    const analyze = vi.fn(async () => ({ hits: [{ t: 2 + 0.25, strength: 1, features: new Array(18).fill(0) }], f0: new Float32Array(0), f0Hop: 512 / sr }));
    const { song } = await songFromTake({ analyze, reportedLatency: () => ({ outputLatency: 0.5 }) }, take, null, 100);
    const [input, ref] = analyze.mock.calls[0] as unknown as [Float32Array, Float32Array];
    expect(input.length).toBe(take.input.length - 4800); // 100 ms measured, not the OS's 500 ms
    expect(ref.length).toBe(input.length);
    expect(song.bars).toBe(4);
    expect(song.tracks[0]!.notes.map((n) => [n.tick / 240, n.confidence])).toEqual([[2, 0]]); // no kit: unsure
  });
});
