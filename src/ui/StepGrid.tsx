import { BlurStyle, Canvas, Picture, Skia, createPicture } from "@shopify/react-native-skia";
import { type ComponentRef, type Ref, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";
import { STEPS_PER_BAR } from "@/song/grid";
import { color, LANES_UI, motion, radius, TOUCH, type } from "./theme";

type GridLane = keyof typeof LANES_UI;
const ROW_GAP = 6, CELL_GAP = 3, CELL_H = 38, LABEL_W = 34;

/** A cell's rect inside the grid canvas (`w` = canvas width): shared with the forge's flying dots. */
export function cellRect(row: number, step: number, w: number) {
  "worklet";
  const cw = (w - (STEPS_PER_BAR - 1) * CELL_GAP) / STEPS_PER_BAR;
  return { x: step * (cw + CELL_GAP), y: row * (TOUCH + ROW_GAP) + (TOUCH - CELL_H) / 2, w: cw, h: CELL_H };
}

/** Forge mode: a lit cell shows only once its dot has landed (seconds on `t`), flashing as it lands. */
export interface Reveal { t: SharedValue<number>; land: number[][] }
const SHORT: Record<GridLane, string> = { kick: "KK", snare: "SN", hatClosed: "HH", hatOpen: "OH", perc: "PC", bass: "BS" };
const AMBER = "#FFB020"; // the unsure mark (docs/design/3-studio); no pulse: idle UI stays quiet (CLAUDE.md)

/**
 * One bar of the song as a step grid. Everything that moves (the beam, each hit flashing as the beam passes it,
 * decaying at motion.flashDecay) is one picture recorded per frame on the UI thread from the heard playhead
 * `pos` (0–1 through the loop, −1 stopped): a pure function of (cells, t). Taps and screen readers use a static
 * layer of real buttons on top, ≥ 44 px tall (16 steps can't be 44 px wide on a phone).
 */
export function StepGrid({ lanes, cells, unsure, bar, bars, loopSeconds, pos, reduceMotion, onToggle, onHold, reveal, canvasRef }: {
  lanes: readonly GridLane[]; cells: number[][]; unsure?: boolean[][]; bar: number; bars: number; loopSeconds: number;
  pos: SharedValue<number>; reduceMotion: boolean; onToggle: (row: number, step: number) => void;
  /** Long-press on a hit (the Studio: "that hit is really…"). */
  onHold?: (row: number, step: number) => void;
  reveal?: Reveal; canvasRef?: Ref<ComponentRef<typeof View>>;
}) {
  const [w, setW] = useState(0);
  const h = lanes.length * TOUCH + (lanes.length - 1) * ROW_GAP;
  const colors = lanes.map((l) => LANES_UI[l].color);

  const picture = useDerivedValue(() => createPicture((canvas) => {
    const p = pos.value;
    const rt = reveal ? reveal.t.value : 0;
    const inBar = p >= 0 ? p * bars - bar : -1; // 0–1 while the beam is in this bar
    const paint = Skia.Paint();
    const glow = Skia.Paint();
    glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 7, true));
    for (let r = 0; r < cells.length; r++) {
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        const c = cellRect(r, s, w);
        const rect = Skia.RRectXY(Skia.XYWHRect(c.x, c.y, c.w, c.h), radius.cell, radius.cell);
        const v = cells[r]![s]!;
        const land = reveal ? reveal.land[r]![s]! : -Infinity;
        if (v <= 0 || rt < land) {
          paint.setColor(Skia.Color(s % 4 === 0 ? color.cellBeat : color.cellOff));
          canvas.drawRRect(rect, paint);
          continue;
        }
        // seconds since the beam last crossed this step: the hit's flash (glow = sound happening now)
        let flash = 0;
        if (p >= 0 && !reduceMotion) {
          const at = (bar * STEPS_PER_BAR + s) / (bars * STEPS_PER_BAR);
          flash = Math.exp(-motion.flashDecay * ((((p - at) % 1) + 1) % 1) * loopSeconds);
        }
        if (reveal && !reduceMotion) flash = Math.max(flash, Math.exp(-motion.flashDecay * (rt - land))); // landing
        const tint = unsure?.[r]![s] ? AMBER : colors[r]!;
        if (flash > 0.02) {
          glow.setColor(Skia.Color(tint));
          glow.setAlphaf(flash);
          canvas.drawRRect(rect, glow);
        }
        paint.setColor(Skia.Color(tint));
        paint.setAlphaf(0.55 + 0.45 * v);
        canvas.drawRRect(rect, paint);
        if (flash > 0.02) {
          paint.setColor(Skia.Color("#FFFFFF"));
          paint.setAlphaf(0.45 * flash);
          canvas.drawRRect(rect, paint);
        }
      }
    }
    if (inBar >= 0 && inBar < 1) {
      // reduced motion: the beam steps from 16th to 16th instead of sweeping
      const at = reduceMotion ? Math.floor(inBar * STEPS_PER_BAR) / STEPS_PER_BAR : inBar;
      const x = at * w;
      glow.setColor(Skia.Color(color.cyan));
      glow.setAlphaf(0.9);
      canvas.drawRect(Skia.XYWHRect(x - 2, 0, 5, h), glow);
      paint.setColor(Skia.Color(color.beam));
      paint.setAlphaf(1);
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x - 1.5, 0, 3, h), 1.5, 1.5), paint);
    }
  }));

  return (
    <View style={s.wrap}>
      <View style={[s.labels, { height: h }]}>
        {lanes.map((l) => (
          <Text key={l} style={[type.stat, s.label, { color: LANES_UI[l].color }]} accessibilityElementsHidden importantForAccessibility="no">
            {LANES_UI[l].glyph}{SHORT[l]}
          </Text>
        ))}
      </View>
      <View ref={canvasRef} style={{ flex: 1, height: h }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={picture} />
          </Canvas>
        )}
        <View style={StyleSheet.absoluteFill}>
          {lanes.map((l, r) => (
            <View key={l} style={[s.row, r > 0 && { marginTop: ROW_GAP }]}>
              {cells[r]!.map((v, step) => {
                const q = v > 0 && !!unsure?.[r]![step];
                return (
                  <Pressable key={step} style={s.hit} onPress={() => onToggle(r, step)} accessibilityRole="button"
                    onLongPress={onHold && v > 0 ? () => onHold(r, step) : undefined}
                    accessibilityHint={onHold && v > 0 ? "Long-press to change which sound it is" : undefined}
                    accessibilityLabel={`${LANES_UI[l].name} step ${step + 1}${q ? ", unsure" : ""}`} accessibilityState={{ selected: v > 0 }}>
                    {q && <Text style={s.mark}>?</Text>}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", gap: 4 },
  labels: { width: LABEL_W, justifyContent: "space-between" },
  label: { height: TOUCH, lineHeight: TOUCH, fontSize: 11 },
  row: { flexDirection: "row", height: TOUCH },
  hit: { flex: 1, height: TOUCH, alignItems: "center", justifyContent: "center" },
  mark: { color: color.ground, fontFamily: "Figtree_600SemiBold", fontSize: 11 },
});
