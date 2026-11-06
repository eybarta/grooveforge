/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANES } from "@/song/time";
import { BUS_FIELDS, DEFAULT_BUSES, DEFAULT_KNOBS, DEFAULT_STRIP, STRIP_FIELDS, mixFor } from "./mix";

const header = readFileSync(new URL("../../engine/include/gf/Engine.h", import.meta.url), "utf8");

/** Field names and default values of a C++ struct, in declaration order. */
function structFields(name: string): [string, number][] {
  const body = header.match(new RegExp(`struct ${name} \\{([\\s\\S]*?)\\n\\};`))![1]!.replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/(\w+)\s*=\s*(-?[\d.]+)f?/g)].map((m) => [m[1]!, Number(m[2])]);
}
const constant = (name: string) => Number(header.match(new RegExp(`${name} = (\\d+);`))![1]);

describe("mix layout matches the engine (Engine.h)", () => {
  it("bus fields, order and defaults", () => {
    expect(BUS_FIELDS.length).toBe(constant("kBusParams"));
    expect(structFields("Buses")).toEqual(BUS_FIELDS.map((f) => [f, DEFAULT_BUSES[f]]));
  });
  it("strip fields, order and defaults", () => {
    expect(STRIP_FIELDS.length).toBe(constant("kStripStride"));
    expect(structFields("Strip")).toEqual(STRIP_FIELDS.map((f) => [f, DEFAULT_STRIP[f]]));
  });
});

describe("mixFor", () => {
  const at = (mix: Float32Array, lane: (typeof LANES)[number], field: (typeof STRIP_FIELDS)[number]) =>
    mix[BUS_FIELDS.length + LANES.indexOf(lane) * STRIP_FIELDS.length + STRIP_FIELDS.indexOf(field)]!;
  const bus = (mix: Float32Array, field: (typeof BUS_FIELDS)[number]) => mix[BUS_FIELDS.indexOf(field)]!;

  it.each(["boomBap", "trap"] as const)("%s: one strip per lane, drums on the drum bus, 808 straight to master", (mood) => {
    const mix = mixFor(mood, DEFAULT_KNOBS, 90);
    expect(mix.length).toBe(BUS_FIELDS.length + LANES.length * STRIP_FIELDS.length);
    for (const lane of ["kick", "snare", "hatClosed", "hatOpen", "perc"] as const) expect(at(mix, lane, "bus")).toBe(0);
    expect(at(mix, "bass", "bus")).toBe(1);
    expect(at(mix, "bass", "satDrive")).toBeGreaterThan(0);
  });

  it("times the delay to the tempo (dotted 8th)", () => {
    expect(bus(mixFor("boomBap", DEFAULT_KNOBS, 90), "delaySec")).toBeCloseTo(0.5);
    expect(bus(mixFor("trap", DEFAULT_KNOBS, 140), "delaySec")).toBeCloseTo((0.75 * 60) / 140);
  });

  it("Punch scales drum attack and the smash; Space scales the sends; 0.5 = the preset", () => {
    const mid = mixFor("boomBap", DEFAULT_KNOBS, 90);
    const loud = mixFor("boomBap", { punch: 1, space: 0 }, 90);
    expect(at(loud, "kick", "attackDb")).toBeCloseTo(2 * at(mid, "kick", "attackDb"));
    expect(bus(loud, "smashMix")).toBeCloseTo(2 * bus(mid, "smashMix"));
    expect(at(loud, "snare", "reverbSend")).toBe(0);
    expect(at(loud, "bass", "satDrive")).toBe(at(mid, "bass", "satDrive")); // the 808 isn't a Punch target
  });
});
