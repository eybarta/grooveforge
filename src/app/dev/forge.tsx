import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { ForgeCanvas } from "@/ui/forge/ForgeCanvas";
import { filmScene, FRAME } from "@/ui/forge/scene";
import { color } from "@/ui/theme";

/**
 * The forge transition on the film's own take, for the side-by-side check against docs/motion. `?t=3.6` freezes a
 * frame and `&capture` draws the bare 390 × 844 frame at the top-left; on web, `seek(t)` and `FILM` follow
 * film.html's contract (scripts/capture-forge.sh drives them).
 */
export default function DevForge() {
  const { t: at, capture } = useLocalSearchParams<{ t?: string; capture?: string }>();
  const scene = useMemo(() => filmScene(), []);
  const frozen = at !== undefined;
  const t = useSharedValue(frozen ? Number(at) : 0);
  useFrameCallback((f) => {
    t.value = ((f.timeSinceFirstFrame ?? 0) / 1000) % scene.duration;
  }, !frozen);
  useEffect(() => {
    Object.assign(globalThis, { seek: (x: number) => t.set(x), FILM: { ...FRAME, duration: scene.duration } });
  }, [t, scene]);
  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ForgeCanvas scene={scene} t={t} fixed={capture !== undefined} />
    </View>
  );
}
