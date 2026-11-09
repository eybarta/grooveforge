import { describe, expect, it } from "vitest";
import type { DrumLane } from "@/song/types";
import { beatPosition, beatsBpm, clickBeats, findBar1 } from "./beatGrid";

describe("beat grid", () => {
  it("lays a click take's beats from bar 1", () => {
    expect(clickBeats(120, 2, 4.2)).toEqual([2, 2.5, 3, 3.5, 4]);
  });

  it("turns times into beat positions, following drift", () => {
    const beats = [1, 1.5, 2.1, 2.8]; // speeding down: 0.5, 0.6, 0.7 s per beat
    expect(beatPosition(beats, 1.25)).toBeCloseTo(0.5);
    expect(beatPosition(beats, 2.1)).toBeCloseTo(2);
    expect(beatPosition(beats, 2.45)).toBeCloseTo(2.5);
    expect(beatPosition(beats, 3.15)).toBeCloseTo(3.5); // past the last beat: its spacing
    expect(beatPosition(beats, 0.75)).toBeCloseTo(-0.5); // before the first
    expect(beatsBpm(beats)).toBeCloseTo(100); // median spacing 0.6 s
  });

  // a groove starting on beat `start` of the bar: a kick on 1 and one off the beat (on the and of 3: kicks on both 1
  // and 3 with snares on 2 and 4 would look the same two beats later), snares per mood
  function groove(mood: "boomBap" | "trap", start: number) {
    const beats = Array.from({ length: 16 }, (_, k) => k * 0.5);
    const hits: { t: number; cls: DrumLane }[] = [];
    for (let k = 0; k < 16; k++) {
      const inBar = (k + start) % 4;
      if (inBar === 0) hits.push({ t: k * 0.5 + 0.004, cls: "kick" });
      if (inBar === 2) hits.push({ t: k * 0.5 + 0.25, cls: "kick" });
      if (mood === "boomBap" ? inBar % 2 === 1 : inBar === 2) hits.push({ t: k * 0.5 - 0.003, cls: "snare" });
      hits.push({ t: k * 0.5 + 0.25, cls: "hatClosed" });
    }
    return { beats, hits };
  }

  it("finds bar 1 from the backbeat (Boom Bap) and the half-time snare (Trap)", () => {
    for (const start of [0, 1, 2, 3]) {
      const want = (4 - start) % 4; // the first beat whose place in the bar is the one
      const bb = groove("boomBap", start), tr = groove("trap", start);
      expect(findBar1(bb.beats, bb.hits, "boomBap")).toBe(want);
      expect(findBar1(tr.beats, tr.hits, "trap")).toBe(want);
    }
  });

  it("starts on the first beat when nothing says otherwise", () => {
    expect(findBar1([0, 0.5, 1, 1.5], [{ t: 0.25, cls: "hatClosed" }], "boomBap")).toBe(0);
  });
});
