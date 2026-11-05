import { describe, expect, it } from "vitest";
import { parseTakeLabels, scoreHits, summarizeScore, type LabelledHit } from "./golden";

const h = (t: number, c: LabelledHit["class"] = "kick"): LabelledHit => ({ t, class: c });

describe("scoreHits (onset F1 at ±30 ms)", () => {
  it("counts exact and near hits, misses and extras", () => {
    const s = scoreHits([h(1), h(2), h(3)], [h(1.02), h(2.05), h(3), h(4)]);
    expect(s).toEqual({ tp: 2, fp: 2, fn: 1, classCorrect: 2 });
    expect(summarizeScore(s).onsetF1).toBeCloseTo(4 / 7, 9); // P = 2/4, R = 2/3
  });

  it("matches each estimate at most once (mir_eval semantics)", () => {
    expect(scoreHits([h(1), h(1.01)], [h(1.005)])).toEqual({ tp: 1, fp: 0, fn: 1, classCorrect: 1 });
  });

  it("finds the maximum matching where a nearest-neighbour choice would not", () => {
    // nearest-neighbour would pair 0.025↔0.04 and leave 0.0 and 0.065 unmatched; the max matching is 2
    expect(scoreHits([h(0.0), h(0.04)], [h(0.025), h(0.065)]).tp).toBe(2);
  });

  it("treats a hit exactly on the ±30 ms edge as matched", () => {
    expect(scoreHits([h(0.04)], [h(0.07)]).tp).toBe(1);
  });

  it("scores class accuracy over matched hits only", () => {
    const s = scoreHits([h(1, "kick"), h(2, "snare"), h(3, "hatClosed")], [h(1, "kick"), h(2, "hatClosed")]);
    expect(summarizeScore(s).classAccuracy).toBe(0.5);
  });
});

describe("parseTakeLabels", () => {
  const ok = { version: 1, performer: "eyal", device: "iPhone 15", hits: [h(0.5), h(1, "perc")], hum: [] };

  it("accepts a well-formed file", () => {
    expect(parseTakeLabels(ok, 2, "t").hits).toHaveLength(2);
  });
  it.each([
    [{ ...ok, hits: [{ t: 0.5, class: "hat" }] }, /not one of/],
    [{ ...ok, hits: [h(3)] }, /outside/],
    [{ ...ok, hits: [h(1), h(0.5)] }, /sorted/],
    [{ ...ok, version: 2 }, /version/],
    [{ ...ok, hum: [{ start: 1, end: 0.5 }] }, /hum\[0\]/],
  ])("rejects malformed labels %#", (raw, msg) => {
    expect(() => parseTakeLabels(raw, 2, "t")).toThrow(msg);
  });
});
