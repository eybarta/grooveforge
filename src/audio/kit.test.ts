import { describe, expect, it } from "vitest";
import { ENGINE_INSTRUMENT_STRIDE, LANES } from "@/song/time";
import { KIT_FILES, kitProgram } from "./kit";

const ZONE_STRIDE = 3;

describe("kitProgram", () => {
  it.each(["boomBap", "trap"] as const)("%s maps every drum lane to a sampled piece with valid slots", (mood) => {
    const { instruments, zones } = kitProgram(mood);
    expect(instruments.length).toBe(LANES.length * ENGINE_INSTRUMENT_STRIDE);
    const kind = (lane: (typeof LANES)[number]) => instruments[LANES.indexOf(lane) * ENGINE_INSTRUMENT_STRIDE];
    for (const lane of ["kick", "snare", "hatClosed", "hatOpen", "perc"] as const) {
      expect(kind(lane)).toBe(1); // sampler
      const rows = Array.from({ length: zones!.length / ZONE_STRIDE }, (_, r) => zones!.slice(r * ZONE_STRIDE, r * ZONE_STRIDE + 3));
      const mine = rows.filter((z) => z[0] === LANES.indexOf(lane));
      expect(mine.length).toBeGreaterThan(0);
      for (const z of mine) expect(z[2]).toBeLessThan(KIT_FILES.length);
    }
    expect(kind("bass")).toBe(2); // synthesised 808
  });

  it("puts closed and open hats in the same choke group", () => {
    const { instruments } = kitProgram("boomBap");
    const choke = (lane: (typeof LANES)[number]) => instruments[LANES.indexOf(lane) * ENGINE_INSTRUMENT_STRIDE + 1];
    expect(choke("hatClosed")).toBeGreaterThanOrEqual(0);
    expect(choke("hatClosed")).toBe(choke("hatOpen"));
  });

  it("gives every kit file its own slot within the engine's 256", () => {
    expect(new Set(KIT_FILES).size).toBe(KIT_FILES.length);
    expect(KIT_FILES.length).toBeLessThanOrEqual(256);
  });
});
