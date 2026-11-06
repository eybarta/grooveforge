import { describe, expect, it } from "vitest";
import { mixTakeWithLoop } from "./spikeRuns";

describe("mixTakeWithLoop", () => {
  it("lines the take up with the loop by removing the round trip", () => {
    const rtl = 100;
    const output = new Float32Array(1000);
    const input = new Float32Array(1000);
    output[200] = 1; // the loop played a hit at frame 200…
    input[200 + rtl] = 1; // …and the mic heard the user's hit rtl frames later
    const mix = mixTakeWithLoop(input, output, rtl);
    expect(mix).toHaveLength(1000 - rtl);
    expect(mix[200]).toBeCloseTo(1, 6); // both land on the same frame (0.9 + 0.5, clipped to 1)
    expect(mix.filter((x) => x !== 0)).toHaveLength(1);
  });
});
