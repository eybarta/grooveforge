import { Canvas, Picture, Skia, createPicture, type SkCanvas } from "@shopify/react-native-skia";
import { StyleSheet } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";
import { clamp, easeInOut, lerp, prog, spring } from "../motion";
import { RIBBON_H, ribbonBar } from "../Ribbon";
import { cellRect } from "../StepGrid";
import type { LaneShape } from "../theme";
import { RIBBON_BARS, type RibbonBar } from "../useMicVisuals";
import { paintOf } from "./ForgeCanvas";
import { B, FLOW, leaves } from "./flow";

export interface Dot { row: number; step: number; color: string; shape: LaneShape }
/** Screen positions (the overlay's coordinates): the ribbon's top-left + width, the record button's centre, the grid canvas at rest. */
export interface ForgeGeom { ribbon: { x: number; y: number; w: number }; button: { x: number; y: number }; grid: { x: number; y: number; w: number } | null }

const REC = 96, DOT = 11;

/**
 * Draws what moves between Record and Studio, over both (`t` = seconds since the Stop tap): the ribbon's bars
 * collapse; the last bar's 16ths become the song's hits as lane-shaped dots that fly, in play order, into the real
 * Studio grid cells (the grid then shows each cell as its dot lands); the record button waits for the orb, which
 * becomes the progress bar (src/ui/Orb.tsx). It starts pixel-identical to Record's ribbon and button, which hide.
 */
export function ForgeOverlay({ t, geom, ribbon, dots, heardAt }: {
  t: SharedValue<number>; geom: ForgeGeom; ribbon: SharedValue<RibbonBar[]>; dots: Dot[]; heardAt: SharedValue<number>;
}) {
  const picture = useDerivedValue(() => createPicture((canvas) => {
    const now = t.value;
    drawRibbonAndDots(canvas, now, geom, ribbon.value, dots, heardAt.value);
    drawButton(canvas, now, geom);
  }));
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  );
}

/** `heard` = when the take's dots exist: before the bars collapse, the bars become them; later, they pop in where their bars were. */
function drawRibbonAndDots(canvas: SkCanvas, t: number, g: ForgeGeom, list: RibbonBar[], dots: Dot[], heard: number) {
  "worklet";
  const pop = heard <= FLOW.collapse ? 1 : clamp(spring(t - heard, 14, 0.8));
  for (let i = 0; i < RIBBON_BARS; i++) {
    const bar = ribbonBar(i, g.ribbon.w, list);
    const x = g.ribbon.x + bar.x, cy = g.ribbon.y + RIBBON_H / 2;
    const col = spring(t - (FLOW.collapse + i * 0.007), 11, 0.82);
    // like the film, the strip spans the bar: step j owns bars ⌈j·44/16⌉…, and its first bar becomes its dots
    const step = Math.floor((i * 16) / RIBBON_BARS);
    const mine = i === Math.ceil((step * RIBBON_BARS) / 16) ? dots.filter((d) => d.step === step) : [];
    if (!mine.length || col <= 0) {
      const k = Math.max(0, 1 - col);
      if (k > 0.01) canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, cy - (bar.h * k) / 2, bar.w, bar.h * k), 3, 3), paintOf(bar.color, bar.alpha));
      continue;
    }
    for (const d of mine) {
      const leave = leaves(d.step, d.row);
      if (t >= leave + FLOW.landAfter || !g.grid) continue; // landed: the grid shows it now
      const cell = cellRect(d.row, d.step, g.grid.w);
      const f = spring(t - leave, 9.5, 0.8);
      const px = lerp(x + bar.w / 2, g.grid.x + cell.x + cell.w / 2, f);
      const py = lerp(cy, g.grid.y + cell.y + cell.h / 2, f) - 80 * Math.sin(Math.PI * clamp(f));
      const land = prog(f, 0.72, 1);
      const w = lerp(lerp(bar.w, DOT, col) * pop, cell.w, easeInOut(land));
      const h = lerp(lerp(bar.h, DOT, col) * pop, cell.h, easeInOut(land));
      const round = d.shape === "circle" || d.shape === "note" ? w / 2 : 2;
      const rad = lerp(lerp(3, round, col), 5, land);
      const rot = lerp(d.shape === "diamond" ? 45 * col : 0, 0, land);
      const glow = 10 + 8 * (1 - land) * clamp(f * 4);
      canvas.save();
      canvas.translate(px, py);
      canvas.rotate(rot, 0, 0);
      if (d.shape === "triangle" && land < 1) { // perc ▲, turning into its cell as it lands
        const tri = Skia.PathBuilder.Make().moveTo(0, -h / 2).lineTo(w / 2, h / 2).lineTo(-w / 2, h / 2).close().detach();
        canvas.drawPath(tri, paintOf(d.color, 1 - land, glow));
        canvas.drawPath(tri, paintOf(d.color, 1 - land));
      }
      const r = Skia.RRectXY(Skia.XYWHRect(-w / 2, -h / 2, w, h), rad, rad);
      const a = d.shape === "triangle" ? land : 1;
      if (d.shape === "squareOutline" && land < 1) { // open hat □
        const p = paintOf(d.color, 1);
        p.setStyle(1);
        p.setStrokeWidth(2);
        canvas.drawRRect(r, paintOf(d.color, 1, glow));
        canvas.drawRRect(r, p);
        canvas.drawRRect(r, paintOf(d.color, land));
      } else if (a > 0) {
        canvas.drawRRect(r, paintOf(d.color, a, glow));
        canvas.drawRRect(r, paintOf(d.color, a));
      }
      canvas.restore();
    }
  }
}

/**
 * The record button, dipping on the Stop tap, until the falling orb lands on it: it dissolves into the orb in the last
 * moment, and the orb (src/ui/Orb.tsx) carries on as the progress bar.
 */
function drawButton(canvas: SkCanvas, t: number, g: ForgeGeom) {
  "worklet";
  if (t >= FLOW.orbFall[1]) return;
  canvas.save();
  canvas.translate(g.button.x, g.button.y);
  const press = spring(t - FLOW.press, 22, 0.55) - spring(t - (FLOW.press + 0.2 * B), 22, 0.55);
  canvas.scale(1 - 0.08 * press, 1 - 0.08 * press);
  const absorbed = prog(t, FLOW.orbFall[1] - 0.12, FLOW.orbFall[1]); // the arriving orb takes it in
  if (absorbed > 0) canvas.saveLayer(paintOf("#FFFFFF", 1 - absorbed));
  const box = Skia.RRectXY(Skia.XYWHRect(-REC / 2, -REC / 2, REC, REC), REC / 2, REC / 2);
  canvas.drawRRect(box, paintOf("#FF2BD6", 0.16));
  const ring = paintOf("#FF2BD6");
  ring.setStyle(1);
  ring.setStrokeWidth(2);
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-REC / 2 + 1, -REC / 2 + 1, REC - 2, REC - 2), REC / 2, REC / 2), ring);
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-15, -15, 30, 30), 8, 8), paintOf("#FF2BD6"));
  if (absorbed > 0) canvas.restore();
  canvas.restore();
}
