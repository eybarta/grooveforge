import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { takeFileName } from "@/analysis/audacity";
import { TEACH_CLASSES, TEACH_EACH, templatesFromTeach, useKit } from "@/analysis/kit";
import { useCalibration } from "@/audio/calibration";
import { alignTake, outputLatency } from "@/audio/latency";
import { saveWav } from "@/audio/saveWav";
import type { AudioEngine } from "@/audio/types";
import { useEngine } from "@/audio/useEngine";
import { encodeWav } from "@/audio/wav";
import { metronome } from "@/song/metronome";
import { defaultInstruments } from "@/song/time";
import { Button } from "@/ui/controls";
import { color, LANES_UI, space, type } from "@/ui/theme";
import { usePlayhead } from "@/ui/usePlayhead";

const BPM = 100;
const COUNT_IN = 4;
const BEATS = TEACH_CLASSES.length * TEACH_EACH;

/** "Teach me your kit" (BUILD_PLAN step 2): five of each sound on the clicks, ~20 s; the kit classifies every take. */
export default function Teach() {
  const { audio, error } = useEngine();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top + space.pageTop, paddingBottom: insets.bottom + space.pageBottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={[type.title, { color: color.text }]} accessibilityRole="header">Teach me your kit</Text>
      <Text style={[type.body, s.muted]}>
        Make each sound on the clicks, five times each: kick, snare, closed hat, open hat, then a rim or tongue click.
        About 20 seconds. Then every take knows your sounds.
      </Text>
      {audio ? <Teacher audio={audio} /> : <Text style={[type.body, s.muted]}>{error ?? "Starting…"}</Text>}
    </View>
  );
}

function Teacher({ audio }: { audio: AudioEngine }) {
  const router = useRouter();
  const rtlMs = useCalibration((c) => c.rtlMs);
  const setTemplates = useKit((k) => k.setTemplates);
  const [phase, setPhase] = useState<"ready" | "listening" | "analysing" | "done">("ready");
  const [beat, setBeat] = useState(-1); // heard beat since the first click (count-in = 0…3)
  const [note, setNote] = useState("");
  const [take, setTake] = useState<Float32Array | null>(null);
  const sr = audio.sampleRate, beatFrames = (60 / BPM) * sr;
  const { frames } = usePlayhead(audio.clock, outputLatency(audio.reportedLatency(), rtlMs, sr).frames, sr);
  const on = useSharedValue(false);
  const last = useSharedValue(-1);

  const finish = async () => {
    if (!on.get()) return;
    on.set(false);
    setPhase("analysing");
    const { input, output } = await audio.captureStop();
    await audio.stop();
    // the take as heard: shifted by the round trip (measured if calibrated, else what the OS says)
    const r = audio.reportedLatency();
    const rtl = rtlMs !== null && Number.isFinite(rtlMs) ? rtlMs / 1000 : (r.outputLatency || 0) + (r.inputLatency || 0);
    const aligned = alignTake(input, rtl * sr);
    const { hits } = await audio.analyze(aligned, output.subarray(0, aligned.length));
    const { templates, missing } = templatesFromTeach(hits, (COUNT_IN * beatFrames) / sr, beatFrames / sr);
    setTake(aligned);
    if (missing.length) {
      setPhase("ready");
      setNote(`I couldn't hear enough ${missing.map((c) => LANES_UI[c as keyof typeof LANES_UI].name.toLowerCase()).join(", ")}. Once more, a bit louder or closer?`);
      return;
    }
    setTemplates(templates);
    setPhase("done");
    setNote(`Kit taught: ${templates.length} sounds learned.`);
  };
  const onBeat = (b: number) => {
    setBeat(b);
    if (b >= COUNT_IN + BEATS) void finish();
  };
  useAnimatedReaction(() => (on.value && frames.value >= 0 ? Math.floor(frames.value / beatFrames) : -1), (b) => {
    if (b < 0 || b === last.value) return;
    last.value = b;
    scheduleOnRN(onBeat, b);
  });

  const begin = async () => {
    setNote("");
    try {
      await audio.stop();
      await audio.setProgram({ instruments: defaultInstruments() });
      await audio.setSong(metronome(BPM));
      last.set(-1);
      on.set(true);
      setBeat(-1);
      setPhase("listening");
      audio.captureStart(); // capture frame 0 = the first click
      await audio.start();
    } catch (e) {
      on.set(false);
      setPhase("ready");
      setNote(`The mic didn't start: ${e}`);
    }
  };
  const saveForGolden = async () => {
    if (!take) return;
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const route = (await audio.route()).outputs[0] ?? "unknown";
    await saveWav(encodeWav(take, sr), `${takeFileName({ mood: "teach", bpm: BPM, countInSec: (COUNT_IN * beatFrames) / sr, route, stamp })}.wav`);
  };

  const k = beat - COUNT_IN;
  const cls = k >= 0 && k < BEATS ? TEACH_CLASSES[Math.floor(k / TEACH_EACH)]! : null;
  const lane = cls ? LANES_UI[cls as keyof typeof LANES_UI] : null;
  const prompt = phase !== "listening" ? null : beat < COUNT_IN ? `${COUNT_IN - Math.max(0, beat)}` : lane ? lane.glyph : "";
  return (
    <View style={s.body}>
      <View style={s.card}>
        <Text style={[s.prompt, { color: lane?.color ?? color.text }]} accessibilityLiveRegion="polite">
          {phase === "listening" ? prompt : phase === "analysing" ? "…" : phase === "done" ? "✓" : "●"}
        </Text>
        <Text style={[type.caps, { color: lane?.color ?? color.soft }]}>
          {phase === "listening" ? (lane ? `${lane.name.toUpperCase()} · ${(k % TEACH_EACH) + 1} OF ${TEACH_EACH}` : "GET READY") : phase === "analysing" ? "LEARNING YOUR SOUNDS" : phase === "done" ? "KIT TAUGHT" : "READY"}
        </Text>
      </View>
      <View style={s.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: BEATS }, (_, i) => {
          const c = LANES_UI[TEACH_CLASSES[Math.floor(i / TEACH_EACH)]! as keyof typeof LANES_UI].color;
          return <View key={i} style={[s.dot, { backgroundColor: c, opacity: i < k ? 1 : i === k ? 0.8 : 0.18 }]} />;
        })}
      </View>
      {note ? <Text style={[type.body, s.muted, { textAlign: "center" }]}>{note}</Text> : null}
      <View style={{ gap: 10 }}>
        {phase === "done"
          ? <Button label="Done" variant="primary" onPress={() => router.back()} />
          : <Button label={phase === "ready" ? (note ? "Try again" : "Start") : "Listening…"} variant="primary" onPress={begin} disabled={phase !== "ready"} />}
        {__DEV__ && take && <Button label="dev: save this teach take for the golden set" onPress={saveForGolden} />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground, paddingHorizontal: space.page, gap: space.gap, width: "100%", maxWidth: 520, alignSelf: "center" },
  body: { flex: 1, justifyContent: "center", gap: 24 },
  muted: { color: color.muted },
  card: { alignItems: "center", gap: 10, paddingVertical: 32, borderRadius: 18, backgroundColor: color.glass, borderWidth: 1, borderColor: color.glassLine },
  prompt: { fontFamily: "Unbounded_800ExtraBold", fontSize: 72, lineHeight: 84 },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
