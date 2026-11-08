import { BlurStyle, Canvas, Fill, Picture, Shader, Skia, Text, createPicture, useFont } from "@shopify/react-native-skia";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { useState } from "react";
import { View } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";
import { LANES_UI } from "./theme";
import type { Spark } from "./useMicVisuals";

const R = 105; // the mockup's 210 px orb
const RING = 115;
const SPARK_S = 1.6;
const SPARK_COLORS = [LANES_UI.kick.color, LANES_UI.snare.color, LANES_UI.hatClosed.color];

// docs/design/1-record: a blurred conic rim (magenta → violet → cyan → lime) spinning behind a dark glass disc with a
// highlight, and a magenta + cyan halo. Here the halo follows the mic: glow means sound is happening.
const ORB = Skia.RuntimeEffect.Make(`
uniform float2 center;
uniform float radius;
uniform float spin;
uniform float glow;

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

half4 main(float2 p) {
  float2 q = p - center;
  float r = length(q) / radius;
  half3 rim = conic(atan(q.y, q.x) / 6.2831853 + spin);
  half inside = half(1.0 - smoothstep(0.985, 1.0, r));
  half disc = half(1.0 - smoothstep(0.80, 0.90, r));
  float u = clamp(length(p - (center + radius * float2(-0.17, -0.25))) / (radius * 1.25), 0.0, 1.0);
  half3 overlay = mix(half3(1.0), half3(0.027, 0.024, 0.043), half(u));
  half3 body = mix(rim, overlay, mix(half(0.35), half(0.85), half(u)) * disc);
  float outside = max(r - 1.0, 0.0) * radius;
  half gm = half(glow * 0.45 * exp(-outside / 30.0));
  half gc = half(glow * 0.25 * exp(-outside / 60.0));
  half3 halo = half3(1.0, 0.169, 0.839) * gm + half3(0.0, 0.898, 1.0) * gc;
  return half4(body * inside + halo * (1.0 - inside), inside + (1.0 - inside) * min(half(1.0), gm + gc));
}`)!;

/**
 * The Record orb, all on the UI thread: shader + count-in rings + sparks + timer in one canvas. `beat` is the
 * count-in position in beats (0–4, else −1); `text` the timer; `breath` 0–1 scales the orb a few percent.
 */
export function Orb({ level, now, sparks, beat, text, breath, reduceMotion, height = 380 }: {
  level: SharedValue<number>; now: SharedValue<number>; sparks: SharedValue<Spark[]>; beat: SharedValue<number>;
  text: SharedValue<string>; breath: SharedValue<number>; reduceMotion: boolean; height?: number;
}) {
  const [w, setW] = useState(0);
  const font = useFont(JetBrainsMono_500Medium, 34);
  const cx = w / 2, cy = height / 2;

  const uniforms = useDerivedValue(() => ({
    center: [cx, cy],
    radius: R * (1 + 0.05 * breath.value),
    spin: reduceMotion ? 0 : now.value / 9, // one turn per 9 s, like the mockup
    glow: 0.25 + 0.75 * Math.min(1, level.value * 2.5),
  }));

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

  // centred by advance widths (measureText gives ink bounds)
  const textX = useDerivedValue(() => (font ? cx - font.getGlyphWidths(font.getGlyphIDs(text.value)).reduce((a, b) => a + b, 0) / 2 : 0));

  return (
    <View style={{ height, alignSelf: "stretch" }} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {w > 0 && (
        <Canvas style={{ width: w, height }}>
          <Fill>
            <Shader source={ORB} uniforms={uniforms} />
          </Fill>
          <Picture picture={overlay} />
          {font && <Text x={textX} y={cy + 6} text={text} font={font} color="#F4F1FF" />}
        </Canvas>
      )}
    </View>
  );
}
