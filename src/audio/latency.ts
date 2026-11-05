/**
 * Round-trip latency from a loopback recording. The engine captures its own output and the mic input on one
 * frame clock, so the delay of each click in the input vs the output is the hardware round trip.
 */
export interface LagEstimate {
  /** Per-click delay of input vs output, in frames. */
  lags: number[];
  /** Normalised correlation (0–1) of each click's best match: low means the click wasn't heard. */
  scores: number[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Click start frames in the engine output: first loud sample after ≥ 50 ms of near-silence. */
export function findClicks(out: Float32Array, sampleRate: number, threshold = 0.01): number[] {
  const quiet = Math.round(0.05 * sampleRate);
  const clicks: number[] = [];
  let lastLoud = -quiet;
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(out[i]!) > threshold) {
      if (i - lastLoud >= quiet) clicks.push(i);
      lastLoud = i;
    }
  }
  return clicks;
}

/**
 * Normalised cross-correlation of each output click (10 ms template) against the input,
 * searching lags in [minLagSec, maxLagSec].
 */
// shortcut: brute force (~0.5 s on Hermes for 8 clicks); move into the C++ engine if calibration runs in-app per take.
export function estimateLags(
  out: Float32Array, input: Float32Array, sampleRate: number, minLagSec = 0, maxLagSec = 0.5,
): LagEstimate {
  const T = Math.round(0.01 * sampleRate);
  const minLag = Math.round(minLagSec * sampleRate);
  const maxLag = Math.round(maxLagSec * sampleRate);
  const lags: number[] = [];
  const scores: number[] = [];
  for (const c of findClicks(out, sampleRate)) {
    if (c + maxLag + T > input.length || c + minLag < 0) continue;
    let tEnergy = 0;
    for (let j = 0; j < T; j++) tEnergy += out[c + j]! ** 2;
    let best = -Infinity, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let dot = 0, e = 0;
      for (let j = 0; j < T; j++) {
        const x = input[c + lag + j]!;
        dot += out[c + j]! * x;
        e += x * x;
      }
      const r = e > 0 ? dot / Math.sqrt(tEnergy * e) : 0;
      if (r > best) { best = r; bestLag = lag; }
    }
    lags.push(bestLag);
    scores.push(best);
  }
  return { lags, scores };
}

export interface LatencyResult {
  rtlMs: number;
  /** max − min of the per-click lags. */
  spreadMs: number;
  clicks: number;
  minScore: number;
}

export function summarize(est: LagEstimate, sampleRate: number): LatencyResult {
  const ms = (f: number) => (f / sampleRate) * 1000;
  return {
    rtlMs: est.lags.length ? ms(median(est.lags)) : NaN,
    spreadMs: est.lags.length ? ms(Math.max(...est.lags) - Math.min(...est.lags)) : NaN,
    clicks: est.lags.length,
    minScore: est.scores.length ? Math.min(...est.scores) : 0,
  };
}

/** CLAUDE.md: recorded takes are shifted by the measured round trip before analysis. */
export const alignTake = (input: Float32Array, rtlFrames: number) => input.subarray(Math.max(0, Math.round(rtlFrames)));
