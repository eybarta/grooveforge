import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav, fingerprint } from "./wav";

describe("wav", () => {
  const x = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000));

  it("round-trips 24-bit mono at 48 kHz within one LSB", () => {
    const bytes = encodeWav(x, 48000);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(bytes.length).toBe(44 + x.length * 3);
    const { samples, sampleRate } = decodeWav(bytes);
    expect(sampleRate).toBe(48000);
    expect(samples).toHaveLength(x.length);
    for (let i = 0; i < x.length; i++) expect(Math.abs(samples[i]! - x[i]!)).toBeLessThan(2 / 2 ** 23);
  });

  it("keeps near-silence silent (wavefile's own quantiser turns 1e-15 into 9 LSB)", () => {
    const { samples } = decodeWav(encodeWav(Float32Array.from([1e-15, -1e-15, 1e-9]), 48000, "16"));
    expect(Array.from(samples)).toEqual([0, 0, 0]);
  });

  it("fingerprints mean |x| and peak", () => {
    const f = fingerprint(Float32Array.from([0.5, -1, 0, 0.5]));
    expect(f).toEqual({ frames: 4, meanAbs: 0.5, peak: 1 });
  });
});
