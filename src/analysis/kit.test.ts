import { describe, expect, it } from "vitest";
import type { DetectedHit } from "./analyze";
import { templatesFromTeach } from "./kit";

const hit = (t: number, strength: number, tag: number): DetectedHit => ({ t, strength, features: [tag] });

describe("teach take → kit templates", () => {
  it("labels each beat's strongest hit with that beat's sound, and reports sounds with too few examples", () => {
    const beat = 0.6, first = 2.4; // 100 BPM after a one-bar count-in
    const hits: DetectedHit[] = [];
    for (let k = 0; k < 25; k++) {
      if (k >= 15 && k < 19) continue; // open hats: only 1 of 5 heard
      hits.push(hit(first + k * beat + 0.03, 10, k));
      if (k === 2) hits.push(hit(first + k * beat + 0.1, 3, 99)); // a weaker extra (a breath) in the same beat
    }
    hits.push(hit(1.2, 20, -1)); // during the count-in: ignored
    const r = templatesFromTeach(hits, first, beat);
    expect(r.templates.filter((t) => t.cls === "kick").map((t) => t.f[0])).toEqual([0, 1, 2, 3, 4]); // not the breath
    expect(r.templates.find((t) => t.f[0] === 20)?.cls).toBe("perc");
    expect(r.heard.hatOpen).toBe(1);
    expect(r.missing).toEqual(["hatOpen"]);
  });
});
