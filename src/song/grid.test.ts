import { describe, expect, it } from "vitest";
import { boomBapDemo, trapDemo } from "./demoGrooves";
import { barCells, STEP_TICKS, toggleStep } from "./grid";

const LANES = ["kick", "snare", "hatClosed", "hatOpen", "perc", "bass"] as const;

describe("Studio grid", () => {
  it("shows one bar of 16ths per lane, loudest hit per step", () => {
    const cells = barCells(boomBapDemo(), 0, LANES);
    expect(cells).toHaveLength(6);
    expect(cells.every((r) => r.length === 16)).toBe(true);
    expect(cells[0]![0]).toBeGreaterThan(0); // the kick on 1
    expect(cells[2]!.filter((v) => v > 0)).toHaveLength(8); // 8th hats
  });

  it("counts off-grid roll hits in the step they start in", () => {
    const trap = trapDemo();
    const roll = trap.tracks.flatMap((t) => t.notes).filter((n) => n.lane === "hatClosed" && n.tick % STEP_TICKS !== 0);
    expect(roll.length).toBeGreaterThan(0);
    const bar = Math.floor(roll[0]!.tick / (16 * STEP_TICKS));
    const step = Math.floor((roll[0]!.tick % (16 * STEP_TICKS)) / STEP_TICKS);
    expect(barCells(trap, bar, LANES)[2]![step]).toBeGreaterThan(0);
  });

  it("toggles a step off (all its hits) and back on (one user note on the grid)", () => {
    const song = boomBapDemo();
    const off = toggleStep(song, "kick", 0, 0);
    expect(barCells(off, 0, LANES)[0]![0]).toBe(0);
    const on = toggleStep(off, "kick", 0, 0);
    const added = on.tracks.flatMap((t) => t.notes).filter((n) => n.lane === "kick" && n.tick === 0);
    expect(added).toEqual([expect.objectContaining({ source: "user", velocity: 0.8, offsetMs: 0 })]);
  });

  it("gives a new 808 note the pitch of the bass note before it", () => {
    const song = trapDemo();
    const bass = song.tracks.flatMap((t) => t.notes).filter((n) => n.lane === "bass").sort((a, b) => a.tick - b.tick);
    const empty = Array.from({ length: 32 }, (_, s) => s).find((s) => !bass.some((n) => Math.floor(n.tick / STEP_TICKS) === s) && s * STEP_TICKS > bass[0]!.tick)!;
    const next = toggleStep(song, "bass", Math.floor(empty / 16), empty % 16);
    const added = next.tracks.flatMap((t) => t.notes).find((n) => n.id.startsWith("ubass"))!;
    expect(added.pitch).toBe(bass.filter((n) => n.tick < empty * STEP_TICKS).at(-1)!.pitch);
    expect(added.durationTicks).toBe(STEP_TICKS);
  });
});
