/** Scores the blind A/B listening page's result codes (docs/p1-ab/listening-test.html) against the answer key. */

/** The page's code: GF1.<device>.<the x/y file picked for p1…p6, in pair-id order>. */
const CODE = /GF1\.([hsp])\.([xy]{6})(?![xy])/g;
export const DEVICES = { h: "headphones", s: "good speaker", p: "phone/laptop speaker" } as const;
type Device = keyof typeof DEVICES;

/** Gate (BUILD_PLAN P1): ≥ 80 % of ≥ 20 listeners prefer v2; a listener prefers v2 when they pick it in ≥ 4 of 6 pairs. */
export const GATE = { listeners: 20, share: 0.8, perListener: 4 } as const;

export interface Score {
  listeners: number;
  preferV2: number;
  pass: boolean;
  /** v2 picks / all picks. */
  voteShare: number;
  /** Per pair id: how many listeners picked v2. */
  perPair: Record<string, number>;
  perDevice: Record<Device, { listeners: number; preferV2: number }>;
}

/** Finds every result code in pasted text (chat dumps welcome). `v2File` maps pair id → the file ("x" | "y") that is v2. */
export function score(text: string, pairIds: readonly string[], v2File: Record<string, "x" | "y">): Score {
  const perPair = Object.fromEntries(pairIds.map((id) => [id, 0]));
  const perDevice = Object.fromEntries(Object.keys(DEVICES).map((d) => [d, { listeners: 0, preferV2: 0 }])) as Score["perDevice"];
  let listeners = 0, preferV2 = 0, v2Votes = 0;
  for (const [, device, picks] of text.matchAll(CODE)) {
    const v2 = pairIds.filter((id, i) => picks![i] === v2File[id]);
    v2.forEach((id) => perPair[id]!++);
    const prefers = v2.length >= GATE.perListener;
    listeners++;
    v2Votes += v2.length;
    preferV2 += Number(prefers);
    perDevice[device as Device].listeners++;
    perDevice[device as Device].preferV2 += Number(prefers);
  }
  return {
    listeners, preferV2, perPair, perDevice,
    pass: listeners >= GATE.listeners && preferV2 >= GATE.share * listeners,
    voteShare: listeners ? v2Votes / (listeners * pairIds.length) : 0,
  };
}
