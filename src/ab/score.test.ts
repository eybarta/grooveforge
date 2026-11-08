import { describe, expect, it } from "vitest";
import { score } from "./score";

const IDS = ["p1", "p2", "p3", "p4", "p5", "p6"];
const V2 = { p1: "y", p2: "y", p3: "y", p4: "x", p5: "x", p6: "y" } as const; // a made-up key

describe("A/B scoring", () => {
  it("counts v2 picks per listener, pair and device, and finds codes inside pasted chat text", () => {
    const s = score("Dana: GF1.h.yyyxxy\nomer -> GF1.s.yyyyxx (took 5 min)\nGF1.p.xxxyyx", IDS, V2);
    expect(s.listeners).toBe(3);
    expect(s.preferV2).toBe(2); // 6/6 and 4/6 prefer v2; 0/6 doesn't
    expect(s.perPair).toEqual({ p1: 2, p2: 2, p3: 2, p4: 1, p5: 2, p6: 1 });
    expect(s.perDevice.h).toEqual({ listeners: 1, preferV2: 1 });
    expect(s.perDevice.p).toEqual({ listeners: 1, preferV2: 0 });
    expect(s.voteShare).toBeCloseTo(10 / 18);
    expect(s.pass).toBe(false); // fewer than 20 listeners
  });

  it("passes at ≥ 16 of 20, fails at 15 of 20, and ignores malformed codes", () => {
    const codes = (yes: number, no: number) => [...Array(yes).fill("GF1.h.yyyxxy"), ...Array(no).fill("GF1.h.xxxyyx")].join(" ");
    expect(score(codes(16, 4), IDS, V2).pass).toBe(true);
    expect(score(codes(15, 5), IDS, V2).pass).toBe(false);
    expect(score("GF1.q.yyyxxy GF1.h.yyyxx GF1.h.yyyxxyy", IDS, V2).listeners).toBe(0);
  });
});
