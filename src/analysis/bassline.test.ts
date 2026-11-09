import { describe, expect, it } from "vitest";
import { STEP_TICKS } from "@/song/grid";
import type { NoteEvent } from "@/song/types";
import { kickBassline } from "./bassline";

const kick = (step: number, offsetMs = 0): NoteEvent => ({ id: `k${step}`, tick: step * STEP_TICKS, lane: "kick", velocity: 1, offsetMs, source: "detected" });
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const inKey = (pitch: number, root: number) => MINOR.includes((((pitch - root) % 12) + 12) % 12);
// 2 bars: kicks on 1, the a of 2, the and of 3 (Boom Bap-ish) in both bars
const KICKS = [0, 7, 10, 16, 23, 26].map((s) => kick(s, s === 7 ? 12 : 0));

describe("the 808 without a hum", () => {
  it("Boom Bap: short notes on every kick, in F minor, i then iv, an octave pop, a turnaround", () => {
    const line = kickBassline(KICKS, { bars: 2, mood: "boomBap" });
    const onKicks = line.filter((n) => KICKS.some((k) => k.tick === n.tick));
    expect(onKicks.map((n) => n.tick)).toEqual(KICKS.map((k) => k.tick));
    expect(onKicks.find((n) => n.tick === 7 * STEP_TICKS)!.offsetMs).toBe(12); // the kick's feel
    expect(line.every((n) => inKey(n.pitch!, 29))).toBe(true);
    expect(onKicks.map((n) => n.pitch)).toEqual([29, 29, 29, 34, 34, 36]); // F1 F1 F1 | Bb1 Bb1 C2 (the fifth leads back)
    expect(onKicks.every((n) => n.pitch! >= 24 && n.pitch! <= 40)).toBe(true);
    expect(line.some((n) => n.pitch === 41 && n.durationTicks === STEP_TICKS)).toBe(true); // F2 pop
    line.forEach((n, i) => { if (line[i + 1]) expect(n.tick + n.durationTicks!).toBeLessThanOrEqual(line[i + 1]!.tick); });
  });

  it("Trap: long 808s in C# minor that slide into each new note", () => {
    const line = kickBassline(KICKS, { bars: 2, mood: "trap" });
    expect(line.map((n) => n.tick)).toEqual(KICKS.map((k) => k.tick)); // no pops: one long note per kick
    expect(line.every((n) => inKey(n.pitch!, 25))).toBe(true);
    expect(line.map((n) => n.pitch)).toEqual([25, 25, 25, 33, 33, 35]); // C#1 … | A1 … B1 (VI, then the VII leads back)
    expect(line[1]!.durationTicks).toBe(3 * STEP_TICKS); // rings until the next kick
    expect(line[3]!.glideFrom).toBe(25);
    expect(line[1]!.glideFrom).toBeUndefined();
  });

  it("is the same every time, and plays the root on each bar's one without kicks", () => {
    expect(kickBassline(KICKS, { bars: 2, mood: "trap" })).toEqual(kickBassline(KICKS, { bars: 2, mood: "trap" }));
    const bare = kickBassline([], { bars: 2, mood: "boomBap" });
    expect(bare.filter((n) => n.velocity === 1).map((n) => [n.tick, n.pitch])).toEqual([[0, 29], [16 * STEP_TICKS, 34]]);
  });
});
