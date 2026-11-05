import { describe, expect, it } from "vitest";
import { alignTake, estimateLags, findClicks, summarize } from "./latency";

const SR = 48000;

/** 8 short 2.6 kHz blips one beat apart (90 BPM), like the spike's click loop. */
function clickTrack(): Float32Array {
  const out = new Float32Array(SR * 6);
  for (let b = 0; b < 8; b++) {
    const start = Math.round(b * 0.6667 * SR);
    for (let j = 0; j < 200; j++) out[start + j] = Math.sin((2 * Math.PI * 2637 * j) / SR) * Math.exp(-j / 60);
  }
  return out;
}

// deterministic noise so the test can't flake
function noise(n: number, amp: number, seed = 1): Float32Array {
  const x = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = ((s / 2 ** 32) * 2 - 1) * amp;
  }
  return x;
}

function loopback(out: Float32Array, lag: number, gain: number, noiseAmp: number): Float32Array {
  const input = noise(out.length, noiseAmp);
  for (let i = 0; i + lag < out.length; i++) input[i + lag]! += out[i]! * gain;
  return input;
}

describe("latency estimation", () => {
  const out = clickTrack();

  it("finds every click", () => {
    expect(findClicks(out, SR)).toHaveLength(8);
  });

  it("recovers a known round trip exactly through quiet, noisy loopback", () => {
    const lag = Math.round(0.0237 * SR); // 23.7 ms, a typical wired iPhone figure
    const r = summarize(estimateLags(out, loopback(out, lag, 0.05, 0.01), SR), SR);
    expect(r.clicks).toBe(8);
    expect(r.rtlMs).toBeCloseTo((lag / SR) * 1000, 6);
    expect(r.spreadMs).toBe(0);
    expect(r.minScore).toBeGreaterThan(0.5);
  });

  it("handles Bluetooth-sized delays", () => {
    const lag = Math.round(0.21 * SR);
    expect(summarize(estimateLags(out, loopback(out, lag, 0.3, 0.005), SR), SR).rtlMs).toBeCloseTo(210, 1);
  });

  it("aligning the take by the measured round trip leaves no residual", () => {
    const lag = 1500;
    const aligned = alignTake(loopback(out, lag, 0.2, 0.005), lag);
    const r = summarize(estimateLags(out, aligned, SR, 0, 0.05), SR);
    expect(r.rtlMs).toBe(0);
  });
});
