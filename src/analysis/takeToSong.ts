/**
 * A take → its Song: drum hits → drum notes, hum → the 808 (CLAUDE.md: hits keep their timing offset, quantize is a
 * blend knob). Each hit's lane comes from the take's own sounds (src/analysis/sounds.ts: named untaught against the
 * generic kit, or by the user's kit); its place from the beat grid (src/analysis/beatGrid.ts): the engine's beats for a
 * take with no click, the click's otherwise, so a performance that drifts still lands on the grid.
 */
import GENERIC_KIT from "../../assets/kits/generic-kit.json";
import { STEP_TICKS } from "@/song/grid";
import { emptySong } from "@/song/store";
import { noteTimeSec } from "@/song/time";
import type { NoteEvent, Song } from "@/song/types";
import type { TakeAnalysis } from "./analyze";
import { beatPosition, beatsBpm, clickBeats, findBar1, loopBars } from "./beatGrid";
import type { Kit } from "./classify";
import { humNotes, humToBass, type Place } from "./humToBass";
import { nameSounds, type SoundKit } from "./sounds";

export interface TakeInfo {
  mood: Song["mood"];
  /** The take's beats (s, on the analysed take's timeline): the engine's (no click) or the click's. */
  beats: number[];
  /** Bar 1's beat (its index in `beats`) when known (a click take: 0); else found from the kicks and snares. */
  bar1?: number;
  /** The loop's length when known (a click take: the bars recorded); else the whole bars from bar 1. */
  bars?: Song["bars"];
}

export interface TakeSong {
  song: Song;
  /** Per sound (a note's `sound`): its hits' features, so a fix can teach the user's kit that sound. */
  sounds: number[][][];
  /** The beats the song was placed on (the given ones, or the mood's tempo if too few were found) and bar 1's index. */
  beats: number[];
  bar1: number;
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

export function takeToSong(take: TakeAnalysis, user: Kit | null, info: TakeInfo): TakeSong {
  const named = nameSounds(take.hits.map((h) => h.features), GENERIC_KIT as SoundKit, user);
  // no beats found (a take with a single hit, say): the mood's tempo from the first hit
  const beats = info.beats.length >= 2 ? info.beats
    : clickBeats(info.mood === "trap" ? 140 : 90, take.hits[0]?.t ?? 0, take.f0.length * take.f0Hop);
  const bar1 = info.bar1 ?? findBar1(beats, take.hits.map((h, i) => ({ t: h.t, cls: named[i]!.cls })), info.mood);
  const bpm = Math.round(beatsBpm(beats) * 10) / 10;
  const spb = 60 / bpm, s16 = spb / 4;
  const toGrid = (t: number) => (beatPosition(beats, t) - bar1) * spb; // seconds from bar 1 at a steady tempo
  const lastHit = take.hits.length ? toGrid(take.hits[take.hits.length - 1]!.t) / spb : 0;
  const bars = info.bars ?? loopBars(Math.max(beats.length - bar1, lastHit + 1) / 4 + 0.15); // a bar short by a beat still counts
  const steps = bars * 16;

  const rel = take.hits
    .map((h, i) => ({ ...h, t: toGrid(h.t), sound: named[i]! }))
    .filter((h) => h.t > -s16 / 2 && h.t < steps * s16 - s16 / 2);
  const swing = estimateSwing(rel.map((h) => h.t), s16) ?? (info.mood === "boomBap" ? 0.58 : 0.5);
  const grid = { ...emptySong(), bpm, swing, quantize: 1 };
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
  const placed = rel.map((h) => ({ h, p: place(h.t, H), c: h.sound }));
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
      confidence: Math.round(c.confidence * 100) / 100, sound: c.group,
    });
  }
  const drumNotes = [...drums.values()].map(({ strength: _, ...n }) => n).sort((a, b) => a.tick - b.tick);
  const kicks = take.hits.filter((_, i) => named[i]!.cls === "kick").map((h) => h.t);
  const hum = humNotes(take.f0, take.f0Hop, { hits: take.hits.map((h) => h.t), kicks, sixteenth: s16 })
    .map((n) => ({ ...n, start: toGrid(n.start), end: toGrid(n.end) }));
  const bass = humToBass(hum, { bars, mood: info.mood }, place, drumNotes.filter((n) => n.lane === "kick"));

  const sounds: number[][][] = [];
  named.forEach((n, i) => (sounds[n.group] ??= []).push(take.hits[i]!.features));
  return {
    song: {
      ...emptySong(), id: `take-${Date.now()}`, bpm, bars, mood: info.mood, swing, quantize: 0.75,
      tracks: [
        { id: "drums", kind: "drums", name: "Drums", gainDb: 0, muted: false, frozen: false, notes: drumNotes },
        { id: "bass", kind: "bass", name: "808", gainDb: 0, muted: false, frozen: false, notes: bass },
      ],
    },
    sounds,
    beats,
    bar1,
  };
}
