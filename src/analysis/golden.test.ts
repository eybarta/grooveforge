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

  it("pairs a detection with the label it names when two labels are within tolerance, never changing the count", () => {
    const hat = (t: number): LabelledHit => ({ t, class: "hatClosed" });
    const kick = (t: number): LabelledHit => ({ t, class: "kick" });
    // a hat and a kick 1 ms apart, one detection calling it a kick: the kick is found, the hat is the miss
    expect(scoreHits([hat(1.4997), kick(1.5003)], [kick(1.5)])).toEqual({ tp: 1, fp: 0, fn: 1, classCorrect: 1 });
    // two detections whose time order is the opposite of the labels': swapped so both agree
    expect(scoreHits([hat(1.0), kick(1.01)], [kick(1.004), hat(1.006)])).toEqual({ tp: 2, fp: 0, fn: 0, classCorrect: 2 });
    // the maximum matching still wins over class agreement (both detections stay matched)
    expect(scoreHits([hat(0.0), kick(0.02)], [kick(0.01), hat(0.045)]).tp).toBe(2);
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
