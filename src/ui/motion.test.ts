import { describe, expect, it } from "vitest";
import { spring, track } from "./motion";

describe("motion spec helpers", () => {
  it("spring matches a damped oscillator from rest (z 0.8: one small overshoot, settles at 1)", () => {
    expect(spring(0)).toBe(0);
    const samples = Array.from({ length: 200 }, (_, i) => spring(i / 100));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThan(1.02); // z 0.8 overshoots ~1.5 %
    expect(spring(2)).toBeCloseTo(1, 3);
    // the closed form solves x'' = −w²(x − 1) − 2zw·x': check it numerically at t = 0.2
    const w = 12, z = 0.8, t = 0.2, h = 1e-4;
    const x = spring(t), v = (spring(t + h) - spring(t - h)) / (2 * h), a = (spring(t + h) - 2 * x + spring(t - h)) / (h * h);
    expect(a).toBeCloseTo(-w * w * (x - 1) - 2 * z * w * v, 0);
  });

  it("track eases between keys and holds the ends", () => {
    expect(track(0, [[1, 0], [2, 1]])).toBe(0);
    expect(track(1.5, [[1, 0], [2, 1]])).toBeCloseTo(0.5);
    expect(track(3, [[1, 0], [2, 1]])).toBe(1);
  });
});
