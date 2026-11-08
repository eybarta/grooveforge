/**
 * A take's detected hits → the Song's drum notes (CLAUDE.md: hits keep their timing offset, quantize is a blend
 * knob). Tempo and bar 1 come from the click: the take was recorded over it, so no tempo detection is needed.
 */
import { STEP_TICKS } from "@/song/grid";
import { emptySong } from "@/song/store";
import { noteTimeSec } from "@/song/time";
import type { DrumLane, NoteEvent, Song } from "@/song/types";
import type { DetectedHit } from "./analyze";
import { classify, type Kit } from "./classify";

export interface TakeInfo {
  bpm: number;
  bars: Song["bars"];
  mood: Song["mood"];
  /** Seconds before bar 1 in the (latency-aligned) take: the count-in. */
  countInSec: number;
}

/** Without a kit: a crude guess by brightness (log₂ spectral centroid, feature 13), always marked unsure. */
function guess(features: number[]): DrumLane {
  const centroid = features[13]!;
  return centroid < 9.2 ? "kick" : centroid > 12.2 ? "hatClosed" : "snare";
}

/** Off-beat 16ths' median position inside their 8th (0.5 = straight), from hits snapped to the straight grid. */
export function estimateSwing(times: number[], sixteenth: number): number | null {
  const pos = times
    .map((t) => ({ t, i: Math.round(t / sixteenth) }))
    .filter(({ i }) => i % 2 === 1)
    .map(({ t, i }) => (t - (i - 1) * sixteenth) / (2 * sixteenth))
    .sort((a, b) => a - b);
  if (pos.length < 4) return null;
  return Math.min(0.75, Math.max(0.5, pos[Math.floor(pos.length / 2)]!));
}

type Placed = NoteEvent & { strength: number };

export function takeToSong(hits: DetectedHit[], kit: Kit | null, info: TakeInfo): Song {
  const s16 = 60 / info.bpm / 4;
  const steps = info.bars * 16;
  const rel = hits.map((h) => ({ ...h, t: h.t - info.countInSec })).filter((h) => h.t > -s16 / 2 && h.t < steps * s16 - s16 / 2);
  const swing = estimateSwing(rel.map((h) => h.t), s16) ?? (info.mood === "boomBap" ? 0.58 : 0.5);
  const grid = { ...emptySong(), bpm: info.bpm, swing, quantize: 1 };
  const at = (tick: number) => noteTimeSec({ tick, offsetMs: 0 } as NoteEvent, grid); // where the engine plays a tick
  const loud = [...rel.map((h) => h.strength)].sort((a, b) => a - b)[Math.floor(rel.length * 0.9)] ?? 1;

  // each hit → its lane and nearest 32nd, as the engine plays them (a tie goes to the 16th)
  const H = STEP_TICKS / 2;
  const off = (t: number, k: number) => Math.abs(t - at(k * H)) + (k % 2 ? 1e-4 : 0);
  const placed = rel.map((h) => {
    const k0 = Math.round(h.t / (s16 / 2));
    const k = [k0 - 1, k0, k0 + 1].reduce((a, b) => (off(h.t, b) < off(h.t, a) ? b : a));
    return { h, k, c: kit ? classify(h.features, kit) : { cls: guess(h.features), confidence: 0 } };
  });
  const on32 = new Set(placed.map((p) => `${p.c.cls}:${p.k}`));

  const notes = new Map<string, Placed>();
  for (const { h, k, c } of placed) {
    // an off-16th hit stays on its 32nd only inside a roll (the same sound on a neighbouring 32nd)
    const roll = k % 2 === 1 && (on32.has(`${c.cls}:${k - 1}`) || on32.has(`${c.cls}:${k + 1}`));
    const tick = k % 2 === 0 || roll ? k * H : [k - 1, k + 1].reduce((a, b) => (off(h.t, b) < off(h.t, a) ? b : a)) * H;
    if (tick < 0 || tick >= steps * STEP_TICKS) continue;
    const key = `${c.cls}:${tick}`;
    const prev = notes.get(key);
    if (prev && prev.strength >= h.strength) continue; // two of one sound on one step: keep the louder
    notes.set(key, {
      id: `d${tick}-${c.cls}`, tick, lane: c.cls, source: "detected", strength: h.strength,
      velocity: Math.min(1, Math.max(0.2, h.strength / loud)),
      offsetMs: Math.round((h.t - at(tick)) * 10000) / 10, // the user's feel, 0.1 ms
      confidence: Math.round(c.confidence * 100) / 100,
    });
  }
  return {
    ...emptySong(), id: `take-${Date.now()}`, bpm: info.bpm, bars: info.bars, mood: info.mood, swing, quantize: 0.75,
    tracks: [{
      id: "drums", kind: "drums", name: "Drums", gainDb: 0, muted: false, frozen: false,
      notes: [...notes.values()].map(({ strength: _, ...n }) => n).sort((a, b) => a.tick - b.tick),
    }],
  };
}
