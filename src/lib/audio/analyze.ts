import type { Analysis, DetectedHit, DrumLane } from "./music.ts";
import { STEPS_PER_BAR } from "./music.ts";

const MIN_BPM = 75;
const MAX_BPM = 155;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function percentile(values: Float32Array, p: number): number {
  const copy = Array.from(values);
  copy.sort((a, b) => a - b);
  if (!copy.length) return 0;
  const idx = Math.min(copy.length - 1, Math.max(0, Math.floor(p * (copy.length - 1))));
  return copy[idx] ?? 0;
}

function avg(data: Float32Array, start: number, end: number): number {
  const a = Math.max(0, start);
  const b = Math.min(data.length, end);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += data[i] ?? 0;
  return s / (b - a);
}

export function bufferToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i] ?? 0;
  }
  const inv = 1 / channels;
  for (let i = 0; i < length; i++) out[i] *= inv;
  return out;
}

function estimateBpm(times: number[]): number {
  if (times.length < 3) return 96;
  const bin = 0.005;
  const last = times[times.length - 1] ?? 0;
  const n = Math.max(2, Math.ceil(last / bin) + 2);
  const env = new Float32Array(n);
  for (const t of times) {
    const i = Math.round(t / bin);
    if (i >= 0 && i < n) env[i] += 1;
  }
  const minLag = Math.round(60 / MAX_BPM / bin);
  const maxLag = Math.round(60 / MIN_BPM / bin);
  let bestLag = Math.round(0.625 / bin);
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (env[i] ?? 0) * (env[i + lag] ?? 0);
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  const raw = 60 / (bestLag * bin);
  const candidates = [raw, raw * 2, raw / 2].filter((b) => b >= MIN_BPM && b <= MAX_BPM);
  const pool = candidates.length ? candidates : [clamp(raw, MIN_BPM, MAX_BPM)];
  let chosen = pool[0] ?? 96;
  let top = -1;
  const scored = pool.map((bpm) => {
    const step = 60 / bpm / 4;
    let score = 0;
    for (const t of times) {
      const q = t / step;
      const nearest = Math.round(q);
      const err = Math.abs(q - nearest);
      const close = Math.exp(-(err * err) / 0.018);
      const beatBonus = nearest % 4 === 0 ? 0.45 : nearest % 2 === 0 ? 0.18 : 0;
      score += close * (1 + beatBonus);
    }
    return { bpm, score };
  });
  for (const row of scored) {
    if (row.score > top) top = row.score;
  }
  const close = scored.filter((row) => row.score >= top * 0.94);
  close.sort((a, b) => Math.abs(a.bpm - 98) - Math.abs(b.bpm - 98));
  chosen = close[0]?.bpm ?? chosen;
  return clamp(Math.round(chosen), MIN_BPM, MAX_BPM);
}

function scoreOrigin(hits: DetectedHit[], origin: number, step: number): number {
  let score = 0;
  for (const hit of hits) {
    const rel = hit.time - origin;
    if (rel < -0.04) continue;
    const q = rel / step;
    const nearest = Math.round(q);
    const err = Math.abs(q - nearest);
    const close = Math.exp(-(err * err) / 0.02);
    const weight = hit.lane === "kick" ? 1.45 : hit.lane === "snare" ? 1.25 : 0.75;
    const down = nearest % 16 === 0 ? 0.35 : nearest % 4 === 0 ? 0.15 : 0;
    score += close * hit.velocity * weight * (1 + down);
  }
  return score;
}

function estimateOrigin(hits: DetectedHit[], bpm: number, duration: number): number {
  if (!hits.length) return 0;
  const step = 60 / bpm / 4;
  const bar = step * STEPS_PER_BAR;
  const anchors = hits.filter((h) => h.lane === "kick" || h.lane === "snare");
  const pool = anchors.length ? anchors : hits;
  let bestO = 0;
  let bestS = scoreOrigin(hits, 0, step);
  for (const hit of pool) {
    for (const landing of [0, 4, 8, 12]) {
      const origin = hit.time - landing * step;
      if (origin < -0.08 || origin > duration * 0.55) continue;
      if (duration - Math.max(0, origin) < bar * 0.72) continue;
      const s = scoreOrigin(hits, origin, step);
      if (s > bestS) {
        bestS = s;
        bestO = origin;
      }
    }
  }
  return Math.max(0, bestO);
}

export function analyzeChannel(samples: Float32Array, sampleRate: number): Analysis {
  const duration = samples.length / sampleRate;
  const hop = 64;
  const frames = Math.max(0, Math.floor(samples.length / hop));
  const eLow = new Float32Array(frames);
  const eMid = new Float32Array(frames);
  const eHigh = new Float32Array(frames);

  const coef = (freq: number) => Math.exp((-2 * Math.PI * freq) / sampleRate);
  const aLow = coef(160);
  const aMidLo = coef(200);
  const aMidHi = coef(2200);
  const aHigh = coef(4500);
  const aEnv = Math.exp(-1 / (0.014 * sampleRate));
  const keep = 1 - aEnv;

  let lp = 0;
  let midIn = 0;
  let midOut = 0;
  let highLp = 0;
  let envL = 0;
  let envM = 0;
  let envH = 0;
  let bucket = 0;
  let frame = 0;

  const usable = frames * hop;
  for (let i = 0; i < usable; i++) {
    const x = samples[i] ?? 0;
    lp = (1 - aLow) * x + aLow * lp;
    midIn = (1 - aMidLo) * x + aMidLo * midIn;
    const hpMid = x - midIn;
    midOut = (1 - aMidHi) * hpMid + aMidHi * midOut;
    highLp = (1 - aHigh) * x + aHigh * highLp;
    const high = x - highLp;
    envL = aEnv * envL + keep * lp * lp;
    envM = aEnv * envM + keep * midOut * midOut;
    envH = aEnv * envH + keep * high * high;
    bucket++;
    if (bucket === hop) {
      eLow[frame] = envL;
      eMid[frame] = envM;
      eHigh[frame] = envH;
      bucket = 0;
      frame++;
    }
  }

  const scaleL = percentile(eLow, 0.96) + 1e-12;
  const scaleM = percentile(eMid, 0.96) + 1e-12;
  const scaleH = percentile(eHigh, 0.96) + 1e-12;
  for (let i = 0; i < frames; i++) {
    eLow[i] = (eLow[i] ?? 0) / scaleL;
    eMid[i] = (eMid[i] ?? 0) / scaleM;
    eHigh[i] = (eHigh[i] ?? 0) / scaleH;
  }

  const flux = new Float32Array(frames);
  for (let i = 1; i < frames; i++) {
    const dL = Math.max(0, (eLow[i] ?? 0) - (eLow[i - 1] ?? 0));
    const dM = Math.max(0, (eMid[i] ?? 0) - (eMid[i - 1] ?? 0));
    const dH = Math.max(0, (eHigh[i] ?? 0) - (eHigh[i - 1] ?? 0));
    flux[i] = dL * 1.15 + dM + dH;
  }

  const maxFlux = Math.max(percentile(flux, 0.99), 1e-8);
  const thresh = maxFlux * 0.2;
  const minGap = Math.max(2, Math.round((0.07 * sampleRate) / hop));
  const hits: DetectedHit[] = [];
  let last = -minGap;

  const mean = (data: Float32Array, start: number, end: number) => avg(data, start, end);

  for (let i = 2; i < frames - 2; i++) {
    if (i - last < minGap) continue;
    const f = flux[i] ?? 0;
    if (f < thresh || f < (flux[i - 1] ?? 0) || f < (flux[i + 1] ?? 0)) continue;

    const bodyL = mean(eLow, i + 12, i + 55);
    const bodyM = mean(eMid, i + 12, i + 55);
    const bodyH = mean(eHigh, i + 12, i + 55);
    const atkL = mean(eLow, i, i + 8);
    const atkH = mean(eHigh, i, i + 8);
    const early = mean(eMid, i + 4, i + 16) + mean(eHigh, i + 4, i + 16);
    const midlife = mean(eMid, i + 28, i + 55) + mean(eHigh, i + 28, i + 55);
    const total = bodyL + bodyM + bodyH + 1e-9;
    const lowShare = bodyL / total;
    const time = (i * hop) / sampleRate;
    const zStart = Math.min(samples.length - 2, Math.floor((time + 0.006) * sampleRate));
    const zEnd = Math.min(samples.length - 1, zStart + Math.floor(0.045 * sampleRate));
    let crossings = 0;
    for (let s = zStart + 1; s <= zEnd; s++) {
      const prev = samples[s - 1] ?? 0;
      const cur = samples[s] ?? 0;
      if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crossings++;
    }
    const zcr = crossings / Math.max(0.001, (zEnd - zStart) / sampleRate);
    const noisy = zcr > 2200;

    let lane: DrumLane;
    if (lowShare > 0.4 && bodyL > bodyH && zcr < 1800) lane = "kick";
    else if (noisy && midlife > early * 0.2) lane = "snare";
    else if (noisy || (atkH > atkL * 1.4 && midlife < early * 0.3)) lane = "hat";
    else lane = "perc";

    const prev = hits[hits.length - 1];
    if (prev && prev.lane === "kick" && lane === "kick" && time - prev.time < 0.13) {
      last = i;
      continue;
    }

    const velocity = clamp(0.45 + 0.55 * (f / maxFlux), 0.45, 1);
    hits.push({ time, lane, velocity });
    last = i;
  }

  const bpm = estimateBpm(hits.map((hit) => hit.time));
  const origin = estimateOrigin(hits, bpm, duration);
  const bar = (60 / bpm) * 4;
  const remain = Math.max(0, duration - origin);
  let bars = Math.round(remain / bar);
  bars = clamp(bars, 1, 4);

  return { duration, bpm, hits, origin, bars };
}
