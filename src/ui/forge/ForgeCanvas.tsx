import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { Unbounded_800ExtraBold } from "@expo-google-fonts/unbounded/800ExtraBold";
import { BlurStyle, Canvas, Picture, Skia, TileMode, createPicture, useTypeface, type SkCanvas, type SkFont, type SkPaint } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";
import { clamp, easeInOut, lerp, prog, spring, track } from "../motion";
import { BW, cellX, cellY, COLW, FRAME, type ForgeScene, ROWH, WY } from "./scene";

const LANE = ["#FF2BD6", "#00E5FF", "#C6FF3D"];
const SHAPE = ["circle", "diamond", "square"] as const;
interface Fonts { brand: SkFont; label: SkFont; ready: SkFont; stat: SkFont; mono14: SkFont; mono15: SkFont }

/**
 * The forge transition as a pure function of time: docs/motion/forge-film/film.html `seek(t)`, ported line for line
 * onto one Skia canvas (the 390 × 844 frame, scaled to fit). Drawn on the UI thread from `t` (seconds).
 */
export function ForgeCanvas({ scene, t, fixed = false }: { scene: ForgeScene; t: SharedValue<number>; fixed?: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const unbounded = useTypeface(Unbounded_800ExtraBold);
  const figtree5 = useTypeface(Figtree_500Medium);
  const figtree6 = useTypeface(Figtree_600SemiBold);
  const mono = useTypeface(JetBrainsMono_500Medium);
  const fonts = useMemo<Fonts | null>(() => (unbounded && figtree5 && figtree6 && mono ? {
    brand: Skia.Font(unbounded, 18), label: Skia.Font(figtree6, 12), ready: Skia.Font(figtree6, 14), stat: Skia.Font(figtree5, 15),
    mono14: Skia.Font(mono, 14), mono15: Skia.Font(mono, 15),
  } : null), [unbounded, figtree5, figtree6, mono]);

  const picture = useDerivedValue(() => createPicture((canvas) => {
    if (!fonts || size.w === 0) return;
    if (!fixed) { // fit the frame to the screen; `fixed` = the bare 390 × 844 frame at the top-left (captures)
      const s = Math.min(size.w / FRAME.w, size.h / FRAME.h);
      canvas.translate((size.w - FRAME.w * s) / 2, (size.h - FRAME.h * s) / 2);
      canvas.scale(s, s);
    }
    drawForge(canvas, t.value, scene, fonts);
  }));

  return (
    <View style={{ flex: 1, alignSelf: "stretch" }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size.w > 0 && (
        <Canvas style={{ width: size.w, height: size.h }}>
          <Picture picture={picture} />
        </Canvas>
      )}
    </View>
  );
}

export function paintOf(hex: string, alpha = 1, blur = 0): SkPaint {
  "worklet";
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(hex));
  p.setAlphaf(alpha);
  if (blur > 0) p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, blur / 2, true)); // CSS blur ≈ 2σ
  return p;
}

/** Baseline for text whose CSS box starts at `top` (line-height: normal). */
function baseline(font: SkFont, top: number) {
  "worklet";
  const m = font.getMetrics();
  return top + (m.leading ?? 0) / 2 - m.ascent;
}
function lineHeight(font: SkFont) {
  "worklet";
  const m = font.getMetrics();
  return m.descent - m.ascent + (m.leading ?? 0);
}

/** Advance widths (measureText gives ink bounds: a space would measure 0). */
function advance(font: SkFont, text: string) {
  "worklet";
  return font.getGlyphWidths(font.getGlyphIDs(text)).reduce((a, b) => a + b, 0);
}

/** CSS letter-spacing: Skia text has none, so glyphs go one by one at their advances. Returns the width. */
function spaced(canvas: SkCanvas, text: string, x: number, y: number, font: SkFont, spacing: number, paint: SkPaint) {
  "worklet";
  const widths = font.getGlyphWidths(font.getGlyphIDs(text));
  let cx = x, i = 0;
  for (const ch of text) {
    canvas.drawText(ch, cx, y, paint, font);
    cx += widths[i++]! + spacing;
  }
  return cx - x;
}

/** The film's masked "rise": the line slides in from below (or out the top) inside its mask. */
function rise(canvas: SkCanvas, t: number, t0: number, out: boolean, mask: [number, number, number, number], h: number, draw: (dy: number) => void) {
  "worklet";
  const u = spring(t - t0, 14, 0.85);
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(mask[0], mask[1], mask[2], mask[3]), 1, true); // 1 = intersect
  draw(out ? -1.7 * h * u : 1.7 * h * (1 - u));
  canvas.restore();
}

function drawForge(canvas: SkCanvas, t: number, sc: ForgeScene, f: Fonts) {
  "worklet";
  const B = sc.B;
  // ambient light: violet always, cyan growing in as the grid arrives
  const amb = (cx: number, cy: number, r: number, rgb: [number, number, number], a: number) => {
    const p = Skia.Paint();
    // CSS radial-gradient(circle) sizes to the box's farthest corner: r·√2, not r
    p.setShader(Skia.Shader.MakeRadialGradient({ x: cx, y: cy }, r * Math.SQRT2,
      [Skia.Color(`rgba(${rgb.join(",")},${a})`), Skia.Color(`rgba(${rgb.join(",")},0)`)], [0, 0.62], TileMode.Clamp));
    canvas.drawCircle(cx, cy, r, p);
  };
  amb(195, 455, 335, [139, 92, 255], 0.2);
  const amb2 = prog(t, 3 * B, 6 * B);
  if (amb2 > 0) amb(195, 585, 255, [0, 229, 255], 0.14 * amb2);

  // ---- grid panel + cells
  const gIn = spring(t - 3 * B, 12, 0.85);
  const gy = (1 - gIn) * 24;
  if (gIn > 0.001) {
    const panel = Skia.RRectXY(Skia.XYWHRect(20.5, 520.5 + gy, 349, 85), 16, 16);
    canvas.drawRRect(panel, paintOf("#FFFFFF", 0.04 * gIn));
    const line = paintOf("#FFFFFF", 0.08 * gIn);
    line.setStyle(1);
    line.setStrokeWidth(1);
    canvas.drawRRect(panel, line);
  }
  for (const c of sc.cells) {
    const x = cellX(c.j), y = cellY(c.r);
    if (t < c.land) {
      if (gIn > 0.001) canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y + gy, COLW, ROWH), 4, 4), paintOf("#FFFFFF", (c.j % 4 === 0 ? 0.09 : 0.05) * gIn));
      continue;
    }
    const flash = Math.exp(-(t - c.land) * 6);
    const tPass = 10 * B + (c.j / 16) * 4 * B;
    const k = Math.max(flash, t >= tPass ? Math.exp(-(t - tPass) * 7) : 0);
    const z = 1 + 0.18 * k, w = COLW * z, h = ROWH * z;
    const rect = Skia.RRectXY(Skia.XYWHRect(x + COLW / 2 - w / 2, y + ROWH / 2 - h / 2, w, h), 4 * z, 4 * z);
    canvas.drawRRect(rect, paintOf(LANE[c.r]!, 1, 10 + 18 * k));
    canvas.drawRRect(rect, paintOf(LANE[c.r]!));
  }

  // ---- waveform → dots → flight
  const live = 1 - prog(t, 2 * B, 2.5 * B);
  sc.bars.forEach((b, i) => {
    const wob = 0.78 + 0.22 * Math.sin(2 * Math.PI * (t * 1.87 + b.ph));
    const h = b.h * (1 - live * (1 - wob));
    const col = spring(t - (2.5 * B + i * 0.007), 11, 0.82);
    if (!b.hit) {
      const k = Math.max(0, 1 - col);
      if (k > 0.01) canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(b.x - BW / 2, WY - (h * k) / 2, BW, h * k), 3, 3), b.p ? paintOf("#8B5CFF") : paintOf("#FFFFFF", 0.16));
      return;
    }
    if (t >= b.ts + 0.5) return; // landed: its cell carries on
    const shape = SHAPE[b.lane]!, dot = 11;
    let w = lerp(BW, dot, col), hh = lerp(h, dot, col);
    let rad = shape === "circle" ? lerp(3, dot / 2, col) : shape === "square" ? lerp(3, 2, col) : lerp(3, 1.5, col);
    let rot = shape === "diamond" ? 45 * col : 0;
    const fl = spring(t - b.ts, 9.5, 0.8);
    const x = lerp(b.x, cellX(b.step) + COLW / 2, fl);
    const y = lerp(WY, cellY(b.lane) + ROWH / 2, fl) - 80 * Math.sin(Math.PI * clamp(fl));
    const g = prog(fl, 0.72, 1);
    w = lerp(w, COLW, easeInOut(g));
    hh = lerp(hh, ROWH, easeInOut(g));
    rad = lerp(rad, 4, g);
    rot = lerp(rot, 0, g);
    canvas.save();
    canvas.translate(x, y);
    canvas.rotate(rot, 0, 0);
    const r = Skia.RRectXY(Skia.XYWHRect(-w / 2, -hh / 2, w, hh), rad, rad);
    canvas.drawRRect(r, paintOf(LANE[b.lane]!, 1, 10 + 8 * (1 - g) * clamp(fl * 4)));
    canvas.drawRRect(r, paintOf(LANE[b.lane]!));
    canvas.restore();
  });

  // ---- beam
  const beamA = prog(t, 10 * B, 10.4 * B) * (1 - prog(t, 13.7 * B, 14 * B));
  if (beamA > 0) {
    const bx = lerp(32, 358, prog(t, 10 * B, 14 * B));
    const beam = Skia.RRectXY(Skia.XYWHRect(bx - 1.5, 524, 3, 78), 2, 2);
    canvas.drawRRect(beam, paintOf("#00E5FF", beamA, 26));
    canvas.drawRRect(beam, paintOf("#FFFFFF", beamA, 10));
    canvas.drawRRect(beam, paintOf("#FFFFFF", beamA));
  }

  // ---- text: brand, timer, labels, status lines, ready
  const by = baseline(f.brand, 28);
  const gw = spaced(canvas, "GROOVE", 24, by, f.brand, -0.36, paintOf("#F4F1FF"));
  spaced(canvas, "FORGE", 24 + gw, by, f.brand, -0.36, paintOf("#FF2BD6", 0.7, 14));
  spaced(canvas, "FORGE", 24 + gw, by, f.brand, -0.36, paintOf("#FF2BD6"));
  const timerA = 1 - prog(t, 2 * B, 2.6 * B);
  if (timerA > 0) canvas.drawText(sc.timer, 366 - advance(f.mono14, sc.timer), baseline(f.mono14, 30), paintOf("#A69DC4", timerA), f.mono14);
  const lh = lineHeight(f.label);
  rise(canvas, t, 2.5 * B, true, [24, 236, 342, 18], lh, (dy) => spaced(canvas, "RECORDING · BAR 4 OF 4", 24, baseline(f.label, 236) + dy, f.label, 2.16, paintOf("#FFB8F1")));
  rise(canvas, t, 2.6 * B, false, [24, 236, 342, 18], lh, (dy) => spaced(canvas, "FORGING YOUR BEAT", 24, baseline(f.label, 236) + dy, f.label, 2.16, paintOf("#7FF3FF")));
  sc.stats.forEach(([name, value, color], i) => {
    const top = 636 + i * 30;
    rise(canvas, t, (8 + i) * B, false, [24, top, 342, 24], lineHeight(f.stat), (dy) => {
      canvas.drawText(name, 24, baseline(f.stat, top) + dy, paintOf("#F4F1FF"), f.stat);
      canvas.drawText(value, 366 - advance(f.mono15, value), baseline(f.stat, top) + dy, paintOf(color), f.mono15);
    });
  });
  rise(canvas, t, 12 * B, false, [24, 800, 342, 22], lineHeight(f.ready), (dy) => {
    const text = "Ready · tap to play";
    canvas.drawText(text, 195 - advance(f.ready, text) / 2, baseline(f.ready, 800) + dy, paintOf("#C6FF3D"), f.ready);
  });

  // ---- record button → progress bar
  const press = spring(t - 2 * B, 22, 0.55) - spring(t - 2.2 * B, 22, 0.55);
  const m = spring(t - 2.5 * B, 10, 0.82);
  const bw = lerp(88, 326, m), bh = lerp(88, 6, m), cy = lerp(752, 780, m);
  const btnA = 1 - prog(t, 11.5 * B, 12.2 * B);
  if (btnA <= 0) return;
  canvas.save();
  canvas.translate(195, cy);
  canvas.scale(1 - 0.08 * press, 1 - 0.08 * press);
  if (btnA < 1) canvas.saveLayer(paintOf("#FFFFFF", btnA));
  const rr = lerp(44, 3, m);
  const box = Skia.RRectXY(Skia.XYWHRect(-bw / 2, -bh / 2, bw, bh), rr, rr);
  const glow = lerp(22, 0, m);
  if (glow > 0.5) canvas.drawRRect(box, paintOf("#FF2BD6", 0.5, glow));
  const bg = Skia.Paint();
  bg.setColor(Skia.Color(`rgba(255,${Math.round(lerp(43, 255, m))},${Math.round(lerp(214, 255, m))},${lerp(0.16, 0.08, m)})`));
  canvas.drawRRect(box, bg);
  canvas.save();
  canvas.clipRRect(box, 1, true);
  const fill = track(t, [[3 * B, 0], [10 * B, 1]]) * bw;
  const fillA = prog(t, 3 * B, 3.3 * B);
  if (fill > 0 && fillA > 0) {
    const fp = Skia.Paint();
    fp.setShader(Skia.Shader.MakeLinearGradient({ x: -bw / 2, y: 0 }, { x: -bw / 2 + fill, y: 0 }, [Skia.Color("#FF2BD6"), Skia.Color("#00E5FF")], null, TileMode.Clamp));
    fp.setAlphaf(fillA);
    canvas.drawRect(Skia.XYWHRect(-bw / 2, -bh / 2, fill, bh), fp);
  }
  const stopA = 1 - prog(m, 0, 0.35);
  if (stopA > 0) {
    const z = 1 - 0.6 * prog(m, 0, 0.35);
    const stop = Skia.RRectXY(Skia.XYWHRect(-14 * z, -14 * z, 28 * z, 28 * z), 8 * z, 8 * z);
    canvas.drawRRect(stop, paintOf("#FF2BD6", stopA, 24));
    canvas.drawRRect(stop, paintOf("#FF2BD6", stopA));
  }
  canvas.restore();
  const border = lerp(2, 0, m);
  if (border > 0.05) {
    const bp = paintOf("#FF2BD6");
    bp.setStyle(1);
    bp.setStrokeWidth(border);
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-bw / 2 + border / 2, -bh / 2 + border / 2, bw - border, bh - border), rr, rr), bp);
  }
  if (btnA < 1) canvas.restore();
  canvas.restore();
}
