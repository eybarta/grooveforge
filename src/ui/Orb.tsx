import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { BlurStyle, Canvas, Picture, Rect, Shader, Skia, Text, createPicture, useFont } from "@shopify/react-native-skia";
import { StyleSheet } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";
import { FLOW } from "./forge/flow";
import { clamp, lerp, prog, smoothstep, springV, track } from "./motion";
import { advance } from "./skiaText";
import { LANES_UI } from "./theme";
import type { Spark } from "./useMicVisuals";

const R = 105; // the mockup's 210 px orb
const RING = 115;
const SPARK_S = 1.6;
const SPARK_COLORS = [LANES_UI.kick.color, LANES_UI.snare.color, LANES_UI.hatClosed.color];
const BUTTON_R = 48; // the record button it lands on
const BAR_H = 6;
/** How fast it's still squashing as it lands (units of the morph per second): the fall flows into the stretch. */
const LANDING_V = 8;
const HALO = 120; // drawn margin around the shape, for its glow

// docs/design/1-record: a blurred conic rim (magenta → violet → cyan → lime) spinning behind a dark glass disc with a
// highlight, and a magenta + cyan halo that follows the mic (glow = sound). Written on a rounded box's distance field
// rather than a circle's, so the same pixels carry on as the shape stretches into the progress bar, whose look
// (track + magenta → cyan fill) it blends into: one object turning into the next (Eyal: smooth and pixel-perfect).
// With halfSize = (r, r) and corner = r it is exactly the circular orb.
const ORB = Skia.RuntimeEffect.Make(`
uniform float2 center;
uniform float2 halfSize;
uniform float corner;
uniform float spin;
uniform float glow;
uniform float bar;
uniform float fillTo;
uniform float alpha;

half3 conic(float t) {
  t = fract(t) * 4.0;
  half3 a = half3(1.0, 0.169, 0.839);
  half3 b = half3(0.545, 0.361, 1.0);
  half3 c = half3(0.0, 0.898, 1.0);
  half3 d = half3(0.776, 1.0, 0.239);
  if (t < 1.0) return mix(a, b, half(t));
  if (t < 2.0) return mix(b, c, half(t - 1.0));
  if (t < 3.0) return mix(c, d, half(t - 2.0));
  return mix(d, a, half(t - 3.0));
}

float roundBox(float2 p, float2 b, float r) {
  float2 q = abs(p) - b + float2(r);
  return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

half4 main(float2 p) {
  float2 q = p - center;
  float thick = min(halfSize.x, halfSize.y);
  float d = roundBox(q, halfSize, corner);
  float r = 1.0 + d / thick;
  half3 rim = conic(atan(q.y / halfSize.y, q.x / halfSize.x) / 6.2831853 + spin);
  half inside = half(1.0 - smoothstep(-max(0.015 * thick, 0.75), 0.0, d));
  half disc = half(1.0 - smoothstep(0.80, 0.90, r));
  float u = clamp(length(q / halfSize - float2(-0.17, -0.25)) / 1.25, 0.0, 1.0); // the highlight stretches with the shape
  half3 overlay = mix(half3(1.0), half3(0.027, 0.024, 0.043), half(u));
  half3 body = mix(rim, overlay, mix(half(0.35), half(0.85), half(u)) * disc);
  float outside = max(d, 0.0);
  half gm = half(glow * 0.45 * exp(-outside / 30.0));
  half gc = half(glow * 0.25 * exp(-outside / 60.0));
  half3 halo = half3(1.0, 0.169, 0.839) * gm + half3(0.0, 0.898, 1.0) * gc;
  half4 orb = half4(body * inside + halo * (1.0 - inside), inside + (1.0 - inside) * min(half(1.0), gm + gc));
  float x = q.x + halfSize.x;
  half filled = fillTo > 0.0 ? half(1.0 - smoothstep(fillTo - 0.5, fillTo + 0.5, x)) : half(0.0);
  half3 grad = mix(half3(1.0, 0.169, 0.839), half3(0.0, 0.898, 1.0), half(clamp(x / max(fillTo, 1.0), 0.0, 1.0)));
  half4 track = half4(mix(half3(0.08), grad, filled) * inside, mix(half(0.08), half(1.0), filled) * inside);
  return mix(orb, track, half(bar)) * half(alpha);
}`)!;

export interface OrbForge {
  t: SharedValue<number>;
  /** The record button's centre and the progress bar's width (the ribbon's), in this layer's coordinates. */
  button: { x: number; y: number };
  barW: number;
}

/**
 * The Record orb as one full-screen layer, so the same object can leave its place: on the forge it falls onto the
 * record button (accelerating, shrinking to its size) and stretches into the progress bar, all one shader. `center`
 * = where the orb sits on Record; `beat` = count-in position in beats (0–4, else −1); `text` the timer.
 */
export function Orb({ center, level, now, sparks, beat, text, textOpacity, breath, reduceMotion, forge }: {
  center: { x: number; y: number } | null; level: SharedValue<number>; now: SharedValue<number>;
  sparks: SharedValue<Spark[]>; beat: SharedValue<number>; text: SharedValue<string>; textOpacity: SharedValue<number>;
  breath: SharedValue<number>; reduceMotion: boolean; forge: OrbForge | null;
}) {
  const font = useFont(JetBrainsMono_500Medium, 34);
  const cx = center?.x ?? 0, cy = center?.y ?? 0;

  // the shape at this frame: the orb at rest, falling, or stretching into the bar
  const shape = useDerivedValue(() => {
    const r0 = R * (1 + 0.05 * breath.value);
    const glow = 0.25 + 0.75 * Math.min(1, level.value * 2.5);
    const spin = reduceMotion ? 0 : now.value / 9; // one turn per 9 s, like the mockup
    const rest = { x: cx, y: cy, hx: r0, hy: r0, corner: r0, glow, spin, bar: 0, fill: 0, alpha: 1 };
    if (!forge) return rest;
    const t = forge.t.value;
    if (t < FLOW.orbFall[1]) {
      const u = prog(t, FLOW.orbFall[0], FLOW.orbFall[1]);
      const e = u * u; // ease-in
      const rr = lerp(r0, BUTTON_R, e);
      return { ...rest, x: lerp(cx, forge.button.x, e), y: lerp(cy, forge.button.y, e), hx: rr, hy: rr, corner: rr };
    }
    const landed = t - FLOW.orbFall[1];
    const m = springV(landed, 10, 0.82, LANDING_V); // the film's button → bar spring
    const hx = lerp(BUTTON_R, forge.barW / 2, m), hy = Math.max(1, lerp(BUTTON_R, BAR_H / 2, m));
    return {
      ...rest, x: forge.button.x, y: forge.button.y, hx, hy, corner: Math.min(hx, hy),
      glow: glow * (1 - clamp(m)) + 0.8 * Math.exp(-6 * landed), // one flash as it lands
      bar: smoothstep(0.3, 0.9, m),
      fill: track(t, [[FLOW.fill, 0], [FLOW.beam[0], 1]]) * 2 * hx,
      alpha: 1 - prog(t, FLOW.barFade[0], FLOW.barFade[1]),
    };
  });
  const uniforms = useDerivedValue(() => {
    const s = shape.value;
    return { center: [s.x, s.y], halfSize: [s.hx, s.hy], corner: s.corner, spin: s.spin, glow: s.glow, bar: s.bar, fillTo: s.fill, alpha: s.alpha };
  });
  const box = useDerivedValue(() => {
    const s = shape.value;
    return { x: s.x - s.hx - HALO, y: s.y - s.hy - HALO, w: 2 * (s.hx + HALO), h: 2 * (s.hy + HALO) };
  });
  const bx = useDerivedValue(() => box.value.x), by = useDerivedValue(() => box.value.y);
  const bw = useDerivedValue(() => box.value.w), bh = useDerivedValue(() => box.value.h);

  const overlay = useDerivedValue(() => createPicture((canvas) => {
    const paint = Skia.Paint();
    const blur = Skia.Paint();
    blur.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 6, true));
    // count-in: a ring per beat closes in from 1.9× onto the orb and fades
    const b = beat.value;
    if (b >= 0 && b < 4) {
      const u = b - Math.floor(b);
      const alpha = u < 0.3 ? (u / 0.3) * 0.9 : 0.9 * (1 - (u - 0.3) / 0.7);
      paint.setStyle(1); // stroke
      paint.setStrokeWidth(2);
      paint.setColor(Skia.Color(Math.floor(b) % 2 ? "#FF2BD6" : "#00E5FF"));
      paint.setAlphaf(alpha);
      canvas.drawCircle(cx, cy, RING * (1.9 - 0.9 * (1 - (1 - u) * (1 - u))), paint);
      paint.setStyle(0);
    }
    if (reduceMotion) return;
    const t = now.value;
    for (const s of sparks.value) {
      const a = (t - s.t0) / SPARK_S;
      if (a < 0 || a >= 1) continue;
      const d = R + 8 + 90 * (1 - (1 - a) * (1 - a));
      const x = cx + Math.cos(s.angle) * d, y = cy + Math.sin(s.angle) * d;
      const size = 5 * (1 - 0.7 * a);
      for (const p of [blur, paint]) {
        p.setColor(Skia.Color(SPARK_COLORS[s.lane]!));
        p.setAlphaf(1 - a);
        if (s.lane === 0) canvas.drawCircle(x, y, size, p);
        else {
          canvas.save();
          canvas.translate(x, y);
          if (s.lane === 1) canvas.rotate(45, 0, 0);
          canvas.drawRect(Skia.XYWHRect(-size, -size, 2 * size, 2 * size), p);
          canvas.restore();
        }
      }
    }
  }));

  const textX = useDerivedValue(() => (font ? cx - advance(font, text.value) / 2 : 0));

  if (!center) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={bx} y={by} width={bw} height={bh}>
        <Shader source={ORB} uniforms={uniforms} />
      </Rect>
      <Picture picture={overlay} />
      {font && <Text x={textX} y={cy + 6} text={text} font={font} color="#F4F1FF" opacity={textOpacity} />}
    </Canvas>
  );
}
