import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { AudioClock } from "@/audio/types";
import { type ClockStats, usePlayhead } from "@/ui/usePlayhead";

export type { ClockStats };

/** A plain beam sweeping the loop (the dev benches); the Studio grid draws its own from the same `usePlayhead`. */
export function LoopBeam({ clock, latencyFrames, sampleRate, onStats }: {
  clock: AudioClock;
  latencyFrames: number;
  sampleRate: number;
  onStats: (s: ClockStats) => void;
}) {
  const width = useSharedValue(0);
  const { pos } = usePlayhead(clock, latencyFrames, sampleRate, onStats);
  const beamStyle = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(0, pos.value) * width.value }] }));

  return (
    <View
      style={styles.track}
      onLayout={(e) => (width.value = e.nativeEvent.layout.width)}
      accessibilityLabel="Loop position"
    >
      <Animated.View style={[styles.beam, beamStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 28, borderRadius: 8, backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)", overflow: "hidden" },
  beam: { position: "absolute", top: 0, bottom: 0, width: 3, backgroundColor: "#00E5FF" },
});
