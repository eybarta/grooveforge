import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { color, radius, type } from "./theme";

const SIZE = 56, R = 22, STROKE = 5;
/** Drag this far (px) to go from 0 to 100. */
const TRAVEL = 160;
// the 270° arc of the mockup's knob, opening at the bottom
const ARC = Skia.PathBuilder.Make().addArc(Skia.XYWHRect(SIZE / 2 - R, SIZE / 2 - R, 2 * R, 2 * R), 135, 270).detach();

/**
 * A macro knob: drag up/down (the arc follows every frame on the UI thread), released value goes to `onChange`.
 * `steps` snaps to that many positions (2 = a switch, e.g. Loudness). Screen readers adjust it with swipe up/down.
 */
export function Knob({ label, value, onChange, accent, format, steps, disabled }: {
  label: string; value: number; onChange: (v: number) => void; accent: string; format: (v: number) => string;
  steps?: number; disabled?: boolean;
}) {
  const v = useSharedValue(value);
  const start = useSharedValue(value);
  const [drag, setDrag] = useState<number | null>(null); // the value under the finger, until released
  useEffect(() => v.set(value), [v, value]);

  const snap = (x: number) => {
    "worklet";
    const c = Math.min(1, Math.max(0, x));
    return steps ? Math.round(c * (steps - 1)) / (steps - 1) : c;
  };
  const pan = usePanGesture({
    enabled: !disabled,
    activeOffsetY: [-4, 4],
    onBegin: () => {
      "worklet";
      start.set(v.get());
    },
    onUpdate: (e) => {
      "worklet";
      const next = snap(start.get() - e.translationY / TRAVEL);
      if (next !== v.get()) {
        v.set(next);
        scheduleOnRN(setDrag, next);
      }
    },
    onDeactivate: () => {
      "worklet";
      scheduleOnRN(onChange, v.get()); // before clearing the drag value, so the label doesn't flick back
      scheduleOnRN(setDrag, null);
    },
  });
  const step = steps ? 1 / (steps - 1) : 0.1;
  const nudge = (d: number) => {
    const next = Math.min(1, Math.max(0, Math.round((value + d) / step) * step));
    if (next !== value) onChange(next);
  };

  return (
    <View style={[s.box, disabled && s.off]}
      accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityState={{ disabled }}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => !disabled && nudge(e.nativeEvent.actionName === "increment" ? step : -step)}>
      <GestureDetector gesture={pan}>
        <View style={s.dial}>
          <Canvas style={s.canvas}>
            <Path path={ARC} style="stroke" strokeWidth={STROKE} strokeCap="round" color="rgba(255,255,255,.1)" />
            <Path path={ARC} style="stroke" strokeWidth={STROKE} strokeCap="round" color={accent} start={0} end={v} />
          </Canvas>
          <Text style={[type.stat, s.value]}>{format(drag ?? value)}</Text>
        </View>
      </GestureDetector>
      <Text style={[type.label, { color: color.soft }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flex: 1, alignItems: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.chip,
    backgroundColor: "rgba(255,255,255,.035)", borderWidth: 1, borderColor: color.glassLine,
  },
  dial: { width: SIZE, height: SIZE, justifyContent: "center", alignItems: "center" },
  canvas: { position: "absolute", width: SIZE, height: SIZE },
  value: { color: color.text },
  off: { opacity: 0.4 },
});
