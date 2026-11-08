/**
 * The continuous Record → Forge → Studio flow (Eyal, 2026-11-08: no cuts). Timing is the film's
 * (docs/motion/forge-film/film.html, 112 BPM beats), counted from the Stop tap (= film beat 2).
 */
export const B = 60 / 112;
export const FLOW = {
  /** Record button dips. */
  press: 0,
  /** Ribbon bars collapse, the button stretches into the progress bar, the orb sinks into it, Record's chrome leaves. */
  collapse: 0.5 * B,
  /** The Studio grid panel rises in where the orb was. */
  gridIn: 1 * B,
  /** First dot leaves; the last leaves `flightSpan` later (play order), each landing 0.5 s after it leaves. */
  flight: 2 * B,
  flightSpan: 3.1 * B,
  landAfter: 0.5,
  /** The beam sweeps the bar; each lit cell flashes as it passes. */
  beam: [8 * B, 12 * B] as const,
  /** The progress bar fades as the Studio controls rise in, staggered. */
  barFade: [9.5 * B, 10.2 * B] as const,
  chrome: [10 * B, 10.4 * B, 10.8 * B, 11.2 * B] as const,
  end: 12.6 * B,
} as const;

/** When the dot for step `step` (0–15) of lane row `row` leaves; it lands FLOW.landAfter later. */
export const leaves = (step: number, row: number) => {
  "worklet";
  return FLOW.flight + (step / 16) * FLOW.flightSpan + row * 0.03;
};
