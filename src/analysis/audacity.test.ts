import { describe, expect, it } from "vitest";
import { fromAudacityLabels, takeFileName, takeMetaFromName, toAudacityLabels } from "./audacity";

describe("Audacity labels", () => {
  it("round-trips hits and reads short class names and hum regions", () => {
    const out = toAudacityLabels([{ t: 0.5, class: "kick" }, { t: 0.75, class: "hatClosed" }]);
    expect(fromAudacityLabels(out).hits).toEqual([{ t: 0.5, class: "kick" }, { t: 0.75, class: "hatClosed" }]);
    const mine = "1.0\t1.0\tk\n0.2\t0.2\tSN\n2\t2.9\thum 36\n3\t3.5\thum\n1.5\t1.5\toh\n\\\t20\t8000\n";
    const r = fromAudacityLabels(mine);
    expect(r.hits.map((h) => h.class)).toEqual(["snare", "kick", "hatOpen"]); // sorted by time
    expect(r.hum).toEqual([{ start: 2, end: 2.9, midi: 36 }, { start: 3, end: 3.5 }]);
  });

  it("rejects unknown labels and point-labelled hums, naming the line", () => {
    expect(() => fromAudacityLabels("0.1\t0.1\tcowbell\n", "t.txt")).toThrow(/t\.txt:1: "cowbell"/);
    expect(() => fromAudacityLabels("0.1\t0.1\thum\n")).toThrow(/needs a region/);
  });

  it("carries the take's tempo and count-in in its file name", () => {
    const name = takeFileName({ mood: "trap", bpm: 140, countInSec: 60 / 140 * 4, route: "Speaker (iPhone)", stamp: "20261108-1402" });
    expect(name).toBe("take-trap-140bpm-ci1.714s-speaker_iphone-20261108-1402");
    expect(takeMetaFromName(name)).toEqual({ mood: "trap", bpm: 140, countInSec: 1.714, route: "speaker_iphone", stamp: "20261108-1402" });
    expect(takeMetaFromName(`${name}-unaligned`)?.bpm).toBe(140);
    expect(takeMetaFromName("something-else")).toBeNull();
  });
});
