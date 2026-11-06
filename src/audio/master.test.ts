import { describe, expect, it } from "vitest";
import { LOUDNESS_TARGETS, masterTo, type Measured } from "./master";

/** A fake chain: linear up to −14 LUFS, then a limiter that gives 0.3 LU per dB of gain. */
const limited = (gainDb: number) => (gainDb <= 6 ? -20 + gainDb : -14 + 0.3 * (gainDb - 6));

function fakeChain(lufsAt: (g: number) => number, truePeakDb = -1.1) {
  const gains: number[] = [];
  const render = async (g: number) => {
    gains.push(g);
    return [Float32Array.of(g)]; // carries the gain to measure()
  };
  const measure = async ([c]: Float32Array[]): Promise<Measured> => ({ lufs: lufsAt(c![0]!), truePeakDb });
  return { gains, render, measure };
}

describe("masterTo", () => {
  it("lands a linear chain in two renders", async () => {
    const { gains, render, measure } = fakeChain(limited);
    const m = await masterTo(LOUDNESS_TARGETS.streaming, render, measure);
    expect(gains).toEqual([0, 6]);
    expect(m).toMatchObject({ lufs: -14, gainDb: 6, renders: 2, ok: true });
  });

  it("follows the limiter's flattening slope to the loud target", async () => {
    const { gains, render, measure } = fakeChain(limited);
    const m = await masterTo(LOUDNESS_TARGETS.loud, render, measure);
    expect(Math.abs(m.lufs - LOUDNESS_TARGETS.loud)).toBeLessThanOrEqual(0.2);
    expect(m.ok).toBe(true);
    expect(gains.length).toBeLessThanOrEqual(6);
  });

  it("reports a miss when the true peak is over the ceiling", async () => {
    const { render, measure } = fakeChain(limited, -0.5);
    expect((await masterTo(-14, render, measure)).ok).toBe(false);
  });

  it("refuses a silent render", async () => {
    const { render, measure } = fakeChain(() => -Infinity);
    await expect(masterTo(-14, render, measure)).rejects.toThrow(/silent/);
  });
});
