/** Neon Forge primitives: quiet glass by default; glow only while sound is happening (CLAUDE.md). */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { color, LANES_UI, radius, TOUCH, type } from "./theme";

export function Glass({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.glass, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress, disabled, accent = color.magenta }: {
  label: string; selected: boolean; onPress: () => void; disabled?: boolean; accent?: string;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }}
      onPress={onPress} disabled={disabled}
      style={[s.chip, selected && { borderColor: accent, backgroundColor: `${accent}29` }, disabled && s.off]}>
      <Text style={[type.button, { color: selected ? color.text : color.soft }]}>{label}</Text>
    </Pressable>
  );
}

export function Button({ label, onPress, variant = "glass", disabled, accessibilityLabel, children }: {
  label?: string; onPress: () => void; variant?: "glass" | "primary"; disabled?: boolean; accessibilityLabel?: string;
  children?: ReactNode;
}) {
  const primary = variant === "primary";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }}
      onPress={onPress} disabled={disabled} style={[s.button, primary ? s.primary : s.glass, disabled && s.off]}>
      {children ?? <Text style={primary ? s.primaryText : [type.button, { color: color.text }]}>{label}</Text>}
    </Pressable>
  );
}

/** The round transport button. It glows while the loop plays: that's sound happening. */
export function PlayButton({ playing, onPress, disabled }: { playing: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Stop" : "Play"} accessibilityState={{ disabled }}
      onPress={onPress} disabled={disabled} style={[s.play, playing && s.playing, disabled && s.off]}>
      {playing ? <View style={s.stopIcon} /> : <View style={s.playIcon} />}
    </Pressable>
  );
}

/** A lane's colour plus its shape, so colour is never the only cue. */
export function LaneMark({ lane }: { lane: keyof typeof LANES_UI }) {
  const l = LANES_UI[lane];
  return <Text style={[type.stat, { color: l.color }]} accessibilityLabel={l.name}>{l.glyph}</Text>;
}

const s = StyleSheet.create({
  glass: { backgroundColor: color.glass, borderWidth: 1, borderColor: color.glassLine, borderRadius: radius.panel },
  chip: {
    minHeight: TOUCH, paddingHorizontal: 16, borderRadius: radius.chip, borderWidth: 1, borderColor: "rgba(255,255,255,.1)",
    backgroundColor: color.glass, justifyContent: "center", alignItems: "center",
  },
  button: { minHeight: 52, paddingHorizontal: 22, borderRadius: radius.button, justifyContent: "center", alignItems: "center" },
  primary: { backgroundColor: color.lime },
  primaryText: { fontFamily: "Unbounded_700Bold", fontSize: 13, color: color.ground },
  off: { opacity: 0.4 },
  play: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: color.cyan, backgroundColor: "rgba(0,229,255,.14)",
    justifyContent: "center", alignItems: "center",
  },
  playing: { boxShadow: "0 0 22px rgba(0,229,255,.45)" },
  // drawn with borders so no icon font is needed: a right-pointing triangle and a square
  playIcon: {
    marginLeft: 4, width: 0, height: 0, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 15,
    borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: color.cyan,
  },
  stopIcon: { width: 16, height: 16, borderRadius: 2, backgroundColor: color.cyan },
});
