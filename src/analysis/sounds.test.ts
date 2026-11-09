import { describe, expect, it } from "vitest";
import { makeKit } from "./classify";
import { groupSounds, nameSounds, soundKit, standardise } from "./sounds";
import type { DrumLane } from "@/song/types";

// three sounds in a 3-feature space; a person's version of each is shifted (their mouth, their mic)
const BASE: Record<string, number[]> = { kick: [4, -2, 0], snare: [0, 2, 1], hatClosed: [-4, 0, -1] };
function take(shift: number[], order: DrumLane[], jitter = 0.3) {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * jitter;
  return { features: order.map((c) => BASE[c]!.map((v, i) => v * 1.5 + shift[i]! + r())), classes: order };
}
const ORDER: DrumLane[] = ["kick", "hatClosed", "snare", "hatClosed", "kick", "hatClosed", "snare", "hatClosed", "kick", "kick", "snare", "hatClosed"];

describe("sounds: grouping and naming a take's hits", () => {
  it("standardises each feature within the take", () => {
    const z = standardise([[1, 5], [3, 5]]);
    expect(z).toEqual([[-1, 0], [1, 0]]); // a constant feature stays 0
  });

  it("groups the same sound together, the same way every time", () => {
    const { features, classes } = take([0, 0, 0], ORDER);
    const g = groupSounds(standardise(features), 3);
    for (const c of ["kick", "snare", "hatClosed"]) expect(new Set(g.filter((_, i) => classes[i] === c)).size).toBe(1);
    expect(new Set(g).size).toBe(3);
    expect(groupSounds(standardise(features), 3)).toEqual(g);
  });

  it("names a stranger's sounds by where they sit among the take's own sounds, despite an offset", () => {
    const kit = soundKit([take([0, 0, 0], ORDER), take([1, 1, 0], ORDER)]);
    const stranger = take([10, -6, 3], ORDER); // far away in absolute terms; same shape relative to itself
    const named = nameSounds(stranger.features, kit);
    expect(named.map((n) => n.cls)).toEqual(stranger.classes);
    for (const n of named) expect(n.confidence).toBeGreaterThan(0.3);
  });

  it("uses the user's own kit when it covers ≥ 2 sounds", () => {
    const kit = soundKit([take([0, 0, 0], ORDER)]);
    const mine = take([0, 0, 0], ORDER);
    // the user taught that their "kick" is called perc (say): the user's kit wins for that group
    const user = makeKit(mine.features.map((f, i) => ({ cls: mine.classes[i] === "kick" ? "perc" : mine.classes[i]!, f })));
    const named = nameSounds(mine.features, kit, user);
    expect(named.filter((_, i) => mine.classes[i] === "kick").every((n) => n.cls === "perc")).toBe(true);
  });

  it("handles takes with fewer hits than groups", () => {
    expect(groupSounds([[0, 1]])).toEqual([0]);
    expect(nameSounds([], soundKit([take([0, 0, 0], ORDER)]))).toEqual([]);
  });
});
