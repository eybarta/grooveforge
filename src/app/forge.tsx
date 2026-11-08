import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable } from "react-native";
import { useAnimatedReaction, useFrameCallback, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTake } from "@/audio/take";
import { DEMOS } from "@/audio/useStudio";
import { useSong } from "@/song/store";
import { ForgeCanvas } from "@/ui/forge/ForgeCanvas";
import { forgeScene, patternFromSong } from "@/ui/forge/scene";
import { color } from "@/ui/theme";

/**
 * Forge (docs/motion): the take's bars collapse into lane-shaped dots that fly into the grid in play order, then the
 * beam runs one bar. It picks up at the Stop press (beat 2 of the film). Until P2 the hits come from the song in the
 * store (the mood's demo). Reduced motion: straight to the finished frame.
 */
export default function Forge() {
  const router = useRouter();
  const stored = useSong((s) => s.song);
  const song = useMemo(() => (stored.tracks.length ? stored : DEMOS.boomBap()), [stored]); // opened directly: the demo
  const take = useTake((s) => s.take);
  const reduceMotion = useReducedMotion();
  const scene = useMemo(() => {
    const hits = song.tracks.filter((tr) => tr.kind === "drums").reduce((n, tr) => n + tr.notes.length, 0);
    const secs = take ? Math.round((take.input.length - take.countInFrames) / take.sampleRate) : 0;
    return forgeScene(patternFromSong(song), song.bpm, [
      ["Tempo locked", `${song.bpm} BPM`, color.lime],
      ["Your swing", `${Math.round(song.swing * 100)}%`, color.lime],
      ["Hits matched to your kit", `${hits} · ${song.bars} bars`, color.cyan],
    ], `00:${String(secs).padStart(2, "0")}`);
  }, [song, take]);
  const t = useSharedValue(reduceMotion ? scene.duration : 2 * scene.B);
  const start = useSharedValue(-1); // the first frame's timestamp: survives the callback being re-registered
  useFrameCallback((f) => {
    if (start.value < 0) start.value = f.timestamp;
    t.value = Math.min(scene.duration, 2 * scene.B + (f.timestamp - start.value) / 1000);
  }, !reduceMotion);
  const [ready, setReady] = useState(reduceMotion);
  useAnimatedReaction(() => t.value >= 12 * scene.B, (now, before) => {
    if (now && !before) scheduleOnRN(setReady, true);
  });

  return (
    <Pressable style={{ flex: 1, backgroundColor: color.ground }} disabled={!ready} onPress={() => router.replace("/studio")}
      accessibilityRole="button" accessibilityLabel={ready ? "Ready. Open the Studio" : "Forging your beat"}>
      <Stack.Screen options={{ headerShown: false, animation: "none" }} />
      <ForgeCanvas scene={scene} t={t} />
    </Pressable>
  );
}
