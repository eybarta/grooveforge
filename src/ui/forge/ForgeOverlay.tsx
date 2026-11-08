import { Canvas, Picture, Skia, TileMode, createPicture, type SkCanvas } from "@shopify/react-native-skia";
import { StyleSheet } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";
import { clamp, easeInOut, lerp, prog, spring, track } from "../motion";
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
 * Studio grid cells (the grid then shows each cell as its dot lands); the record button stretches into the progress
 * bar. It starts pixel-identical to Record's ribbon and button, which hide underneath.
 */
export function ForgeOverlay({ t, geom, ribbon, dots }: { t: SharedValue<number>; geom: ForgeGeom; ribbon: SharedValue<RibbonBar[]>; dots: Dot[] }) {
  const picture = useDerivedValue(() => createPicture((canvas) => {
    const now = t.value;
    drawRibbonAndDots(canvas, now, geom, ribbon.value, dots);
    drawButton(canvas, now, geom);
  }));
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  );
}

function drawRibbonAndDots(canvas: SkCanvas, t: number, g: ForgeGeom, list: RibbonBar[], dots: Dot[]) {
  "worklet";
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
      const w = lerp(lerp(bar.w, DOT, col), cell.w, easeInOut(land));
      const h = lerp(lerp(bar.h, DOT, col), cell.h, easeInOut(land));
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

/** The orb's conic rim colours (src/ui/Orb.tsx), for the shape it becomes. */
const RIM = ["#FF2BD6", "#8B5CFF", "#00E5FF", "#C6FF3D", "#FF2BD6"];

/**
 * The record button waits (dipping on the Stop tap) until the falling orb lands on it at its size; then the two are
 * one shape that stretches into the progress bar (the film's button → bar morph): the orb's rim colours and dark glass
 * give way to the bar's track and its magenta → cyan fill. At the button's place, as wide as the ribbon.
 */
function drawButton(canvas: SkCanvas, t: number, g: ForgeGeom) {
  "worklet";
  const alpha = 1 - prog(t, FLOW.barFade[0], FLOW.barFade[1]);
  if (alpha <= 0) return;
  const landed = t - FLOW.orbFall[1];
  canvas.save();
  canvas.translate(g.button.x, g.button.y);
  if (landed < 0) { // still the record button, holding the stop square
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
    return;
  }
  const m = spring(landed, 10, 0.82);
  const bw = lerp(REC, g.ribbon.w, m), bh = lerp(REC, 6, m), rr = lerp(REC / 2, 3, m);
  if (alpha < 1) canvas.saveLayer(paintOf("#FFFFFF", alpha));
  const box = Skia.RRectXY(Skia.XYWHRect(-bw / 2, -bh / 2, bw, bh), rr, rr);
  // the orb's halo, plus one flash as it lands (decay 6/s)
  const halo = 0.5 * (1 - m) + 0.8 * Math.exp(-6 * landed);
  if (halo > 0.02) {
    canvas.drawRRect(box, paintOf("#FF2BD6", Math.min(1, halo), 22));
    canvas.drawRRect(box, paintOf("#00E5FF", Math.min(1, halo) * 0.6, 40));
  }
  // the bar's track comes in as the orb's look goes
  canvas.drawRRect(box, paintOf("#FFFFFF", 0.08 * prog(m, 0.4, 1)));
  const rimA = 1 - prog(m, 0.5, 1);
  if (rimA > 0) {
    const rim = Skia.Paint();
    rim.setAntiAlias(true);
    rim.setShader(Skia.Shader.MakeSweepGradient(0, 0, RIM.map((c) => Skia.Color(c)), null, TileMode.Clamp));
    rim.setAlphaf(rimA);
    canvas.drawRRect(box, rim);
    // the dark glass disc and its highlight, draining away as it flattens
    const glassA = 0.85 * (1 - prog(m, 0, 0.45));
    if (glassA > 0) {
      const inset = 0.13 * Math.min(bw, bh);
      const inner = Skia.RRectXY(Skia.XYWHRect(-bw / 2 + inset, -bh / 2 + inset, bw - 2 * inset, bh - 2 * inset), Math.max(0, rr - inset), Math.max(0, rr - inset));
      const glass = Skia.Paint();
      glass.setAntiAlias(true);
      glass.setShader(Skia.Shader.MakeRadialGradient({ x: -0.17 * bw / 2, y: -0.25 * bh / 2 }, Math.max(bw, bh) * 0.6,
        [Skia.Color(`rgba(255,255,255,${0.35 * glassA / 0.85})`), Skia.Color(`rgba(7,6,11,${glassA})`)], [0, 0.7], TileMode.Clamp));
      canvas.drawRRect(inner, glass);
    }
  }
  canvas.save();
  canvas.clipRRect(box, 1, true);
  const fill = track(t, [[FLOW.fill, 0], [FLOW.beam[0], 1]]) * bw;
  const fillA = prog(t, FLOW.fill, FLOW.fill + 0.2);
  if (fill > 0 && fillA > 0) {
    const fp = Skia.Paint();
    fp.setShader(Skia.Shader.MakeLinearGradient({ x: -bw / 2, y: 0 }, { x: -bw / 2 + fill, y: 0 }, [Skia.Color("#FF2BD6"), Skia.Color("#00E5FF")], null, TileMode.Clamp));
    fp.setAlphaf(fillA);
    canvas.drawRect(Skia.XYWHRect(-bw / 2, -bh / 2, fill, bh), fp);
  }
  canvas.restore();
  if (alpha < 1) canvas.restore();
  canvas.restore();
}
