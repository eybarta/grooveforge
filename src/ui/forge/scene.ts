/**
 * The forge transition's data, laid out exactly as docs/motion/forge-film/film.html (390 × 844 frame): 44 waveform
 * bars, some of them hits that become lane-shaped dots and fly into a 3 × 16 grid, in play order.
 */
import { STEP_TICKS } from "@/song/grid";
import type { Song } from "@/song/types";

export const FRAME = { w: 390, h: 844 } as const;
export const N = 44, GAP = 3, BW = (342 - (N - 1) * GAP) / N, WY = 320;
export const COLW = (326 - 15 * 4) / 16, ROWH = 18;
export const cellX = (j: number) => {
  "worklet";
  return 32 + j * (COLW + 4);
};
export const cellY = (r: number) => {
  "worklet";
  return 532 + r * (ROWH + 4);
};
/** The film's own take: k kick, s snare, h hat, p perc (a non-hit bar), . quiet. */
export const FILM_PATTERN = "k..h.s.hk.h..sh.k.kh.s.hk..h.s.h.k.h.sk.h.ph";
const LANE: Record<string, number> = { k: 0, s: 1, h: 2 };

export interface Bar { hit: boolean; lane: number; h: number; x: number; step: number; ts: number; ph: number; p: boolean }
export interface Cell { r: number; j: number; land: number }
export interface ForgeScene {
  /** Seconds per beat: the film is 14 beats. */
  B: number;
  bars: Bar[];
  cells: Cell[];
  stats: [string, string, string][];
  timer: string;
  duration: number;
}

export function forgeScene(pattern: string, bpm: number, stats: ForgeScene["stats"], timer: string): ForgeScene {
  const B = 60 / bpm;
  const bars: Bar[] = [...pattern].map((ch, i) => {
    const lane = LANE[ch] ?? -1, hit = lane >= 0;
    const base = 10 + Math.round(Math.abs(Math.sin(i * 1.7)) * 14);
    return {
      hit, lane, h: hit ? (lane === 0 ? 70 : lane === 1 ? 58 : 42) : ch === "p" ? 30 : base,
      x: 24 + i * (BW + GAP) + BW / 2, step: Math.floor((i * 16) / N), ts: 4 * B + (i / N) * 3.1 * B, ph: i * 0.13, p: ch === "p",
    };
  });
  const cells: Cell[] = [];
  for (let r = 0; r < 3; r++) for (let j = 0; j < 16; j++) cells.push({ r, j, land: Infinity });
  for (const b of bars) if (b.hit) {
    const c = cells[b.lane * 16 + b.step]!;
    c.land = Math.min(c.land, b.ts + 0.5);
  }
  return { B, bars, cells, stats, timer, duration: 14 * B };
}

/** The film scene for the side-by-side check (dev route). */
export const filmScene = () =>
  forgeScene(FILM_PATTERN, 112, [["Tempo locked", "112 BPM", "#C6FF3D"], ["Your swing", "58%", "#C6FF3D"], ["Hits matched to your kit", "31 · 4 bars", "#00E5FF"]], "00:08");

/**
 * A song's first bar as a 44-bar pattern: each 16th owns 2–3 bars, filled kick, snare, hat in that order; perc
 * becomes a purple non-hit bar. (P2: the real take's bars and detected hits replace this.)
 */
export function patternFromSong(song: Song): string {
  const out = new Array<string>(N).fill(".");
  const first = (j: number) => Math.ceil((j * N) / 16);
  const notes = song.tracks.flatMap((t) => t.notes).filter((n) => n.tick < 16 * STEP_TICKS);
  for (const [lane, ch] of [["kick", "k"], ["snare", "s"], ["hatClosed", "h"], ["perc", "p"]] as const) {
    for (const n of notes.filter((x) => x.lane === lane)) {
      const j = Math.floor(n.tick / STEP_TICKS);
      for (let i = first(j); i < first(j + 1); i++) if (out[i] === ".") { out[i] = ch; break; }
    }
  }
  return out.join("");
}
