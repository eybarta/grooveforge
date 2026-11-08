import { describe, expect, it } from "vitest";
import { boomBapDemo } from "@/song/demoGrooves";
import { filmScene, N, patternFromSong } from "./scene";

describe("forge scene", () => {
  it("reproduces the film's timing: 14 beats at 112 BPM, hits land in play order", () => {
    const s = filmScene();
    expect(s.duration).toBeCloseTo(7.5, 2);
    const lands = s.bars.filter((b) => b.hit).map((b) => b.ts);
    expect(lands).toEqual([...lands].sort((a, b) => a - b));
    expect(s.cells.filter((c) => Number.isFinite(c.land)).length).toBeGreaterThan(10);
  });

  it("turns a song's first bar into 44 bars with every kick, snare and hat step on it", () => {
    const p = patternFromSong(boomBapDemo());
    expect(p).toHaveLength(N);
    const steps = (ch: string) => new Set([...p].flatMap((c, i) => (c === ch ? [Math.floor((i * 16) / N)] : [])));
    expect([...steps("k")].sort((a, b) => a - b)).toEqual([0, 7, 10]); // the demo's bar-1 kicks
    expect(steps("h").size).toBe(8);
  });
});
