/** Loudness targets (integrated LUFS): Loud is hip-hop-typical and the default; Streaming is what Spotify plays at.
 *  The engine's limiter holds the true peak at or under −1 dBTP. */
export const LOUDNESS_TARGETS = { loud: -9, streaming: -14 } as const;
export type LoudnessTarget = keyof typeof LOUDNESS_TARGETS;

/** The CLAUDE.md export bar: target ± 0.5 LU, ≤ −1 dBTP. */
export const LUFS_TOLERANCE = 0.5;
export const MAX_TRUE_PEAK_DB = -1;

export interface Measured {
  lufs: number;
  truePeakDb: number;
}

export interface Mastered extends Measured {
  channels: Float32Array[];
  /** Master gain into the limiter that got there. */
  gainDb: number;
  renders: number;
  /** Within the bar (± LUFS_TOLERANCE, ≤ MAX_TRUE_PEAK_DB). */
  ok: boolean;
}

/**
 * Finds the master gain that lands a render on `targetLufs`: render → measure → adjust, until within `aim` LU.
 * Through a limiter, loudness grows slower than gain, so each step divides by the slope measured so far (secant).
 */
export async function masterTo(
  targetLufs: number,
  render: (gainDb: number) => Promise<Float32Array[]>,
  measure: (channels: Float32Array[]) => Promise<Measured>,
  { aim = 0.2, maxRenders = 6 } = {},
): Promise<Mastered> {
  let gainDb = 0, slope = 1;
  let prev: { gainDb: number; lufs: number } | null = null;
  let best: Mastered | null = null;
  for (let renders = 1; renders <= maxRenders; renders++) {
    const channels = await render(gainDb);
    const m = await measure(channels);
    if (!Number.isFinite(m.lufs)) break; // silence: no gain will help
    const miss = targetLufs - m.lufs;
    const ok = Math.abs(miss) <= LUFS_TOLERANCE && m.truePeakDb <= MAX_TRUE_PEAK_DB;
    if (!best || Math.abs(miss) < Math.abs(targetLufs - best.lufs)) best = { ...m, channels, gainDb, renders, ok };
    else best.renders = renders;
    if (Math.abs(miss) <= aim) break;
    if (prev && gainDb !== prev.gainDb) slope = Math.min(1, Math.max(0.1, (m.lufs - prev.lufs) / (gainDb - prev.gainDb)));
    prev = { gainDb, lufs: m.lufs };
    gainDb += miss / slope;
  }
  if (!best) throw new Error("master: the render is silent");
  return best;
}
