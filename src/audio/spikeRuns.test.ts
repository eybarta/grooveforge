import { describe, expect, it } from "vitest";
import { mixTakeWithLoop, takeLevel } from "./spikeRuns";

describe("mixTakeWithLoop", () => {
  it("lines the take up with the loop by removing the round trip", () => {
    const rtl = 100;
    const output = new Float32Array(1000);
    const input = new Float32Array(1000);
    output[200] = 1; // the loop played a hit at frame 200…
    input[200 + rtl] = 1; // …and the mic heard the user's hit rtl frames later
    const mix = mixTakeWithLoop(input, output, rtl);
    expect(mix).toHaveLength(1000 - rtl);
    expect(mix[200]).toBeCloseTo(1, 6); // both land on the same frame (0.7 normalised take + 0.5 loop, clipped to 1)
    expect(mix.filter((x) => x !== 0)).toHaveLength(1);
  });
});

describe("takeLevel", () => {
  it("reports peak in dBFS and counts clipped samples", () => {
    const l = takeLevel(Float32Array.from([0.5, -1, 0.999, 0.2]));
    expect(l.peak).toBe(1);
    expect(l.peakDbfs).toBeCloseTo(0, 6);
    expect(l.clipped).toBe(2);
  });
});
