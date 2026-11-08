/**
 * Neon Forge design tokens (CLAUDE.md "Design system"; values from docs/design/ mockups and docs/motion/).
 * Glow means "sound is happening now", never decoration: idle UI is quiet glass.
 */
import type { DrumLane } from "@/song/types";

export const color = {
  ground: "#07060B",
  glass: "rgba(255,255,255,.04)",
  glassLine: "rgba(255,255,255,.08)",
  cellOff: "rgba(255,255,255,.045)",
  cellBeat: "rgba(255,255,255,.09)",
  text: "#F4F1FF",
  soft: "#CFC8E8",
  muted: "#A69DC4",
  cyan: "#00E5FF",
  magenta: "#FF2BD6",
  lime: "#C6FF3D",
  beam: "#FFFFFF",
} as const;

export type LaneShape = "circle" | "diamond" | "square" | "squareOutline" | "triangle" | "note";
export interface LaneStyle {
  color: string;
  shape: LaneShape;
  /** The shape as text, for labels next to a colour (colour-blind safe). */
  glyph: string;
  name: string;
}

/**
 * Lane colour + shape. Shapes follow CLAUDE.md where the mockups differ (snare ◆, perc ▲; decided for P3).
 * Melody lanes get their colours with P4.
 */
export const LANES_UI: Record<DrumLane | "bass", LaneStyle> = {
  kick: { color: "#FF2BD6", shape: "circle", glyph: "●", name: "Kick" },
  snare: { color: "#00E5FF", shape: "diamond", glyph: "◆", name: "Snare" },
  hatClosed: { color: "#C6FF3D", shape: "square", glyph: "■", name: "Hat" },
  hatOpen: { color: "#FFB020", shape: "squareOutline", glyph: "□", name: "Open hat" },
  perc: { color: "#8B5CFF", shape: "triangle", glyph: "▲", name: "Perc" },
  bass: { color: "#FF5A1F", shape: "note", glyph: "♪", name: "808" },
};

/** expo-font names (loaded in src/app/_layout.tsx). */
export const font = {
  display: "Unbounded_700Bold",
  brand: "Unbounded_800ExtraBold",
  ui: "Figtree_500Medium",
  uiRegular: "Figtree_400Regular",
  uiBold: "Figtree_600SemiBold",
  mono: "JetBrainsMono_500Medium",
} as const;

export const type = {
  brand: { fontFamily: font.brand, fontSize: 18, letterSpacing: -0.36 },
  title: { fontFamily: font.display, fontSize: 17 },
  stat: { fontFamily: font.mono, fontSize: 12 },
  timer: { fontFamily: font.mono, fontSize: 34 },
  body: { fontFamily: font.uiRegular, fontSize: 15 },
  label: { fontFamily: font.uiBold, fontSize: 12 },
  button: { fontFamily: font.uiBold, fontSize: 14 },
  caps: { fontFamily: font.ui, fontSize: 12, letterSpacing: 2.2 },
} as const;

export const space = { page: 16, pageTop: 20, pageBottom: 24, gap: 16, row: 10 } as const;
export const radius = { cell: 5, chip: 14, button: 16, panel: 18 } as const;
/** CLAUDE.md: touch targets ≥ 44 px. */
export const TOUCH = 44;

export const motion = {
  /** Spring damping ratio for every spring (CLAUDE.md, docs/motion). */
  damping: 0.8,
  /** Flashes decay as exp(−flashDecay · seconds). */
  flashDecay: 6,
} as const;
