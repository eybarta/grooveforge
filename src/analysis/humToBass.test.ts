import { describe, expect, it } from "vitest";
import { kickBassline } from "./bassline";
import { STEP_TICKS } from "@/song/grid";
import { midiToHz } from "@/song/time";
import type { NoteEvent } from "@/song/types";
import { detectKey, humNotes, humToBass, intoRange, snap, type Place } from "./humToBass";

const hop = 512 / 48000;
/** A pitch track from [seconds, midi or a [from, to] slide or 0 = unvoiced] pieces, with a little wobble. */
function track(pieces: [number, number | [number, number]][]) {
  const f0: number[] = [];
  for (const [sec, m] of pieces) {
    const n = Math.round(sec / hop);
    for (let k = 0; k < n; k++) {
      const midi = typeof m === "number" ? m : m[0] + ((m[1] - m[0]) * k) / (n - 1);
      f0.push(midi ? midiToHz(midi + 0.15 * Math.sin(k * 0.7)) : 0);
    }
  }
  return Float32Array.from(f0);
}

describe("hum → notes", () => {
  it("splits a hum into its notes and tells a slide from a jump", () => {
    const notes = humNotes(track([[0.1, 0], [0.3, 45], [0.1, [45, 50]], [0.3, 50], [0.1, 0], [0.04, 47], [0.1, 0], [0.2, 48], [0.2, 52]]), hop);
    expect(notes.map((n) => [Math.round(n.midi), n.slid])).toEqual([[45, false], [50, true], [48, false], [52, false]]); // the 40 ms blip is dropped
    expect(notes[0]!.start).toBeCloseTo(0.1, 1);
    expect(notes[1]!.start).toBeCloseTo(0.4, 1); // a slid note starts where the slide starts
  });

  it("drops a drum's own tone and starts a note on the kick that masked it", () => {
    // 0.1 s kick thump at 0.2 s (31.5), a hum note heard 0.09 s after a kick at 0.6 s, a click's ring at 1.4 s
    const f0 = track([[0.2, 0], [0.1, 31.5], [0.39, 0], [0.4, 45], [0.31, 0], [0.08, 77], [0.1, 0]]);
    const drums = { hits: [0.2, 0.6, 1.38], kicks: [0.2, 0.6], sixteenth: 60 / 90 / 4 };
    expect(humNotes(f0, hop).length).toBe(3);
    const notes = humNotes(f0, hop, drums);
    expect(notes.map((n) => Math.round(n.midi))).toEqual([45]);
    expect(notes[0]!.start).toBe(0.6);
    expect(humNotes(f0, hop, { ...drums, sixteenth: 0.05 })[0]!.start).toBeCloseTo(0.69, 1); // beyond a 16th: its own step
  });

  it("drops a boomy kick's low tail and joins a note a snare cut through", () => {
    // kick at 0.1 s ringing down to ~55 Hz (33) for 0.45 s; a hummed C3 from 0.7 s, cut by a snare at 1.1 s for 60 ms
    const f0 = track([[0.1, 0], [0.05, [42, 34]], [0.4, 33.1], [0.15, 0], [0.4, 48], [0.06, 0], [0.4, 48], [0.1, 0]]);
    const notes = humNotes(f0, hop, { hits: [0.1, 1.1], kicks: [0.1], sixteenth: 60 / 90 / 4 });
    expect(notes.map((n) => [Math.round(n.midi), +n.start.toFixed(1), +n.end.toFixed(1)])).toEqual([[48, 0.7, 1.6]]);
  });

  it("finds the key and snaps into it", () => {
    const n = (midi: number, d = 0.5) => ({ start: 0, end: d, midi, slid: false });
    expect(detectKey([n(45, 1), n(48), n(50), n(52), n(55), n(45)])).toEqual(expect.objectContaining({ root: 9, mode: "minor" }));
    const cMinor = { root: 0, mode: "minor" as const };
    expect(snap(39.4, cMinor)).toBe(39);
    expect(snap(40.4, cMinor)).toBe(41); // E isn't in C minor: F is nearer
    expect(snap(40, cMinor)).toBe(39); // halfway between E♭ and F: down
  });

  it("moves the line into the 808's C1–C2 by octaves, folding outliers", () => {
    expect(intoRange([45, 50, 48])).toEqual([33, 38, 36]);
    expect(intoRange([45, 48, 52])).toEqual([33, 36, 40]); // the shape kept: E2 is still in range
    expect(intoRange([60, 62, 84])).toEqual([36, 38, 36]); // the outlier folds
    expect(intoRange([36, 39])).toEqual([36, 39]); // hummed low enough already: stays
  });

  const place: Place = (t, unit) => { // straight 16ths at 90 BPM
    const s16 = 60 / 90 / 4, tick = Math.round(t / ((s16 * unit) / STEP_TICKS)) * unit;
    return { tick, offsetMs: Math.round((t - (tick / STEP_TICKS) * s16) * 1000) };
  };

  it("places notes on 16ths, legato, with the slide as glideFrom", () => {
    const s16 = 60 / 90 / 4;
    const hum = [
      { start: 0.005, end: 4 * s16, midi: 45.2, slid: false }, // A
      { start: 4 * s16, end: 7 * s16, midi: 47.9, slid: true }, // slid up to C
      { start: 8 * s16 - 0.01, end: 10 * s16, midi: 52.1, slid: false }, // E, a bit early
    ];
    const notes = humToBass(hum, { bars: 2, mood: "boomBap" }, place, []);
    expect(notes.map((n) => [n.tick / STEP_TICKS, n.pitch, n.durationTicks! / STEP_TICKS, n.glideFrom])).toEqual([[0, 33, 4, undefined], [4, 36, 3, 33], [8, 40, 2, undefined]]);
    expect(notes[2]!.offsetMs).toBe(-10);
  });

  it("without a hum, the 808 plays a bassline on the kicks (src/analysis/bassline.ts)", () => {
    const kick = (step: number): NoteEvent => ({ id: `k${step}`, tick: step * STEP_TICKS, lane: "kick", velocity: 1, offsetMs: 3, source: "detected" });
    const kicks = [kick(0), kick(10), kick(16)];
    expect(humToBass([], { bars: 2, mood: "boomBap" }, place, kicks)).toEqual(kickBassline(kicks, { bars: 2, mood: "boomBap" }));
  });
});
