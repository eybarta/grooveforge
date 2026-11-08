import { Canvas, Picture, Skia, createPicture } from "@shopify/react-native-skia";
import { useState } from "react";
import { View } from "react-native";
import { type SharedValue, useDerivedValue } from "react-native-reanimated";
import { LANES_UI } from "./theme";
import { RIBBON_BARS, type RibbonBar } from "./useMicVisuals";

const H = 72, GAP = 3;
const COLORS = [LANES_UI.kick.color, LANES_UI.snare.color, LANES_UI.hatClosed.color];
// the mockup's resting ribbon: quiet grey bars of uneven height
const REST = Array.from({ length: RIBBON_BARS }, (_, i) => 10 + Math.round(Math.abs(Math.sin(i * 1.7)) * 14));

/** The take as it's recorded: one bar per 16th, newest on the right; a bar with a hit in it lights in a lane colour. */
export function Ribbon({ bars }: { bars: SharedValue<RibbonBar[]> }) {
  const [w, setW] = useState(0);
  const picture = useDerivedValue(() => createPicture((canvas) => {
    const bw = (w - (RIBBON_BARS - 1) * GAP) / RIBBON_BARS;
    const list = bars.value;
    const paint = Skia.Paint();
    for (let i = 0; i < RIBBON_BARS; i++) {
      const b = list[i - (RIBBON_BARS - list.length)];
      const h = b ? 10 + 62 * Math.sqrt(Math.min(1, b.h)) : REST[i]!;
      paint.setColor(Skia.Color(b && b.lane >= 0 ? COLORS[b.lane]! : "#FFFFFF"));
      paint.setAlphaf(b && b.lane >= 0 ? 1 : 0.16);
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(i * (bw + GAP), (H - h) / 2, bw, h), 3, 3), paint);
    }
  }));
  return (
    <View style={{ height: H, alignSelf: "stretch" }} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {w > 0 && (
        <Canvas style={{ width: w, height: H }}>
          <Picture picture={picture} />
        </Canvas>
      )}
    </View>
  );
}
