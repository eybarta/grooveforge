import { describe, expect, it } from "vitest";
import { degreeToMidi } from "../../reference/poc-audio/music.ts";
import { boomBapDemo, trapDemo } from "@/song/demoGrooves";
import { onGrid, toPoc } from "./pocPattern";

describe("toPoc", () => {
  it("Boom Bap: same hits on the 16th grid, bass degrees land on the song's pitch classes in the POC's register", () => {
    const song = boomBapDemo();
    const { steps, mix } = toPoc(song);
    expect(steps).toHaveLength(32);
    expect(mix).toMatchObject({ flavor: "bap", root: 41, swing: 0.58, humanize: true });
    expect(steps.flat()).toHaveLength(song.tracks.flatMap((t) => t.notes).length); // every Boom Bap note is on the grid
    const bass = song.tracks[1]!.notes;
    for (const n of bass) {
      const e = steps[n.tick / 240]!.find((x) => x.lane === "bass")!;
      expect(degreeToMidi(29, "bap", e.degree, 0)).toBe(n.pitch); // F1 = 29 is the song's first bass note
    }
    expect(steps[30]!.filter((e) => e.lane === "hat")).toHaveLength(1); // the open hat becomes a POC hat
  });

  it("Trap: drops the off-grid half of the 1/32 roll; onGrid keeps only the asked lanes", () => {
    const song = trapDemo();
    const all = song.tracks.flatMap((t) => t.notes).length;
    expect(toPoc(song).steps.flat()).toHaveLength(all - 4); // 8-hit roll → 4 on-grid
    expect(toPoc(song).mix.root).toBe(37); // C#1 → C#2, the nearest to the POC's F2 default
    const low = onGrid(song, ["kick", "bass"]);
    expect(new Set(low.tracks.flatMap((t) => t.notes.map((n) => n.lane)))).toEqual(new Set(["kick", "bass"]));
  });
});
