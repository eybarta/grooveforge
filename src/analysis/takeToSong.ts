/**
 * A take's detected hits → the Song's drum notes (CLAUDE.md: hits keep their timing offset, quantize is a blend
 * knob). Tempo and bar 1 come from the click: the take was recorded over it, so no tempo detection is needed.
 */
import { STEP_TICKS } from "@/song/grid";
import { emptySong } from "@/song/store";
import { noteTimeSec } from "@/song/time";
import type { DrumLane, NoteEvent, Song } from "@/song/types";
import type { TakeAnalysis } from "./analyze";
import { classify, type Kit } from "./classify";
import { humNotes, humToBass, type Place } from "./humToBass";

export interface TakeInfo {
  bpm: number;
  bars: Song["bars"];
  mood: Song["mood"];
  /** Seconds before bar 1 in the (latency-aligned) take: the count-in. */
  countInSec: number;
}

/**
 * Without a kit: a crude guess by log₁₀(energy < 300 Hz / > 3 kHz) (feature 17), always marked unsure. On the golden
 * takes kicks are 0.1…1.3, snares −1.9…−1.5, hats down to −6 (brightness, feature 13, overlaps across all three).
 * shortcut: synthetic takes only; re-fit on the real golden takes, or replace with the bundled default kit (P2 plan).
 */
function guess(features: number[]): DrumLane {
  const lowHigh = features[17]!;
  return lowHigh > 0 ? "kick" : lowHigh < -3.5 ? "hatClosed" : "snare";
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

/** The take's song: drums from its hits, the 808 from its hum (src/analysis/humToBass.ts). */
export function takeToSong(take: TakeAnalysis, kit: Kit | null, info: TakeInfo): Song {
  const s16 = 60 / info.bpm / 4;
  const steps = info.bars * 16;
  const rel = take.hits.map((h) => ({ ...h, t: h.t - info.countInSec })).filter((h) => h.t > -s16 / 2 && h.t < steps * s16 - s16 / 2);
  const swing = estimateSwing(rel.map((h) => h.t), s16) ?? (info.mood === "boomBap" ? 0.58 : 0.5);
  const grid = { ...emptySong(), bpm: info.bpm, swing, quantize: 1 };
  const at = (tick: number) => noteTimeSec({ tick, offsetMs: 0 } as NoteEvent, grid); // where the engine plays a tick
  // the nearest tick in `unit`s as the engine plays them (a tie goes to the 16th), and the feel to 0.1 ms
  const place: Place = (t, unit) => {
    const off = (k: number) => Math.abs(t - at(k * unit)) + ((k * unit) % STEP_TICKS ? 1e-4 : 0);
    const k0 = Math.round(t / ((s16 * unit) / STEP_TICKS));
    const tick = [k0 - 1, k0, k0 + 1].reduce((a, b) => (off(b) < off(a) ? b : a)) * unit;
    return { tick, offsetMs: Math.round((t - at(tick)) * 10000) / 10 };
  };
  const loud = [...rel.map((h) => h.strength)].sort((a, b) => a - b)[Math.floor(rel.length * 0.9)] ?? 1;

  // each hit → its lane and nearest 32nd
  const H = STEP_TICKS / 2;
  const placed = rel.map((h) => ({ h, p: place(h.t, H), c: kit ? classify(h.features, kit) : { cls: guess(h.features), confidence: 0 } }));
  const on32 = new Set(placed.map(({ p, c }) => `${c.cls}:${p.tick}`));

  const drums = new Map<string, Placed>();
  for (const { h, p: p32, c } of placed) {
    // an off-16th hit stays on its 32nd only inside a roll (the same sound on a neighbouring 32nd)
    const roll = p32.tick % STEP_TICKS !== 0 && (on32.has(`${c.cls}:${p32.tick - H}`) || on32.has(`${c.cls}:${p32.tick + H}`));
    const { tick, offsetMs } = p32.tick % STEP_TICKS === 0 || roll ? p32 : place(h.t, STEP_TICKS);
    if (tick < 0 || tick >= steps * STEP_TICKS) continue;
    const key = `${c.cls}:${tick}`;
    const prev = drums.get(key);
    if (prev && prev.strength >= h.strength) continue; // two of one sound on one step: keep the louder
    drums.set(key, {
      id: `d${tick}-${c.cls}`, tick, lane: c.cls, source: "detected", strength: h.strength, offsetMs,
      velocity: Math.min(1, Math.max(0.2, h.strength / loud)),
      confidence: Math.round(c.confidence * 100) / 100,
    });
  }
  const drumNotes = [...drums.values()].map(({ strength: _, ...n }) => n).sort((a, b) => a.tick - b.tick);
  const kicks = placed.filter(({ c }) => c.cls === "kick").map(({ h }) => h.t + info.countInSec);
  const drumsHeard = { hits: take.hits.map((h) => h.t), kicks: kicks.sort((a, b) => a - b), sixteenth: s16 };
  const hum = humNotes(take.f0, take.f0Hop, drumsHeard).map((n) => ({ ...n, start: n.start - info.countInSec, end: n.end - info.countInSec }));
  const bass = humToBass(hum, info, place, drumNotes.filter((n) => n.lane === "kick"));
  return {
    ...emptySong(), id: `take-${Date.now()}`, bpm: info.bpm, bars: info.bars, mood: info.mood, swing, quantize: 0.75,
    tracks: [
      { id: "drums", kind: "drums", name: "Drums", gainDb: 0, muted: false, frozen: false, notes: drumNotes },
      { id: "bass", kind: "bass", name: "808", gainDb: 0, muted: false, frozen: false, notes: bass },
    ],
  };
}
