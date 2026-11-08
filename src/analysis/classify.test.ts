import { describe, expect, it } from "vitest";
import { classify, makeKit, type Template } from "./classify";

// two features on very different scales (like an MFCC and a zero-crossing rate): scaling must make both count
const kit = makeKit([
  ...[0, 1, 2].map((i): Template => ({ cls: "kick", f: [100 + i, 0.1] })),
  ...[0, 1, 2].map((i): Template => ({ cls: "snare", f: [100 + i, 0.9] })),
  ...[0, 1, 2].map((i): Template => ({ cls: "hatClosed", f: [200 + i, 0.5] })),
]);

describe("hit classifier (k-NN on the user's kit)", () => {
  it("picks the class of the nearest examples, with the small-scale feature counting too", () => {
    expect(classify([101, 0.12], kit).cls).toBe("kick");
    expect(classify([101, 0.88], kit).cls).toBe("snare");
    expect(classify([199, 0.5], kit).cls).toBe("hatClosed");
  });

  it("is confident far from other classes and unsure halfway between two", () => {
    expect(classify([101, 0.1], kit).confidence).toBeGreaterThan(0.8);
    expect(classify([101, 0.5], kit).confidence).toBeLessThan(0.2);
  });
});
