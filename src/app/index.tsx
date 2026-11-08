import { Link, Redirect, Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedReaction, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useCalibration } from "@/audio/calibration";
import { createAudioEngine } from "@/audio/engine";
import type { Mood } from "@/audio/kit";
import { outputLatency } from "@/audio/latency";
import { useTake } from "@/audio/take";
import type { AudioEngine } from "@/audio/types";
import { DEMOS } from "@/audio/useStudio";
import { metronome } from "@/song/metronome";
import { useSong } from "@/song/store";
import { defaultInstruments } from "@/song/time";
import { Chip } from "@/ui/controls";
import { Orb } from "@/ui/Orb";
import { Ribbon } from "@/ui/Ribbon";
import { color, motion, space, type } from "@/ui/theme";
import { useMicVisuals } from "@/ui/useMicVisuals";
import { usePlayhead } from "@/ui/usePlayhead";

// dev hook: `EXPO_PUBLIC_SPIKE_AUTO=render npx expo start` opens the spike and runs the offline render headlessly
const SPIKE_AUTO = process.env.EXPO_PUBLIC_SPIKE_AUTO;
const TAKE_BARS = 4; // after a one-bar count-in (P2 makes 2/4/8 a choice)
const SPRING = { stiffness: 144, damping: 19.2, mass: 1 }; // the film's ω = 12, ζ = 0.8

export default function Index() {
  if (SPIKE_AUTO) return <Redirect href={{ pathname: "/dev/spike", params: { auto: SPIKE_AUTO } }} />;
  return <RecordScreen />;
}

/** Record (docs/design/1-record.dc.html): count in, beatbox + hum one take over the click, then forge it. */
function RecordScreen() {
  const [audio, setAudio] = useState<AudioEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  // only while this screen shows: Studio (pushed on top) runs its own engine, and the mic must not stay open here
  useFocusEffect(useCallback(() => {
    let created: AudioEngine | null = null;
    let gone = false;
    createAudioEngine().then((a) => { created = a; if (gone) void a.close(); else setAudio(a); })
      .catch((e) => setError(`The audio engine didn't start: ${e}`));
    return () => {
      gone = true;
      setAudio(null);
      void created?.close();
    };
  }, []));
  return audio ? <Recorder audio={audio} /> : <Shell>{error && <Text style={[type.body, s.error]}>{error}</Text>}</Shell>;
}

function Shell({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top + space.pageTop, paddingBottom: insets.bottom + space.pageBottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <Text style={[type.brand, { color: color.text }]} accessibilityRole="header">GROOVE<Text style={{ color: color.magenta }}>FORGE</Text></Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Recorder({ audio }: { audio: AudioEngine }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const rtlMs = useCalibration((c) => c.rtlMs);
  const setTake = useTake((t) => t.setTake);
  const setSong = useSong((t) => t.setSong);
  const [mood, setMood] = useState<Mood>("boomBap");
  const [phase, setPhase] = useState<"idle" | "countIn" | "recording" | "saving">("idle");
  const [bar, setBar] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const sr = audio.sampleRate;
  const bpm = DEMOS[mood]().bpm;
  const beatFrames = (60 / bpm) * sr, barFrames = 4 * beatFrames;
  const { frames } = usePlayhead(audio.clock, outputLatency(audio.reportedLatency(), rtlMs, sr).frames, sr);
  const rec = useSharedValue(false);
  const lastBar = useSharedValue(-1);
  const recording = useDerivedValue(() => rec.value && frames.value >= barFrames);
  const { level, now, sparks, ribbon } = useMicVisuals(audio.clock, frames, beatFrames / 4, recording);

  const stop = async () => {
    if (!rec.get()) return;
    const take = lastBar.get() >= 1; // stopping during the count-in throws the take away
    rec.set(false);
    setPhase(take ? "saving" : "idle");
    const { input } = await audio.captureStop();
    await audio.stop();
    if (!take) return;
    setTake({ input, sampleRate: sr, bpm, mood, countInFrames: barFrames });
    setSong(DEMOS[mood]()); // P2 forges the take into the song; until then the mood's demo groove
    setPhase("idle");
    router.push("/forge");
  };
  const start = async () => {
    setError(null);
    try {
      await audio.stop();
      await audio.setProgram({ instruments: defaultInstruments() });
      await audio.setSong(metronome(bpm));
      lastBar.set(-1);
      rec.set(true);
      setBar(0);
      setPhase("countIn");
      audio.captureStart(); // before play: capture frame 0 is the first count-in click
      await audio.start(); // opens the mic (asks for permission the first time)
    } catch (e) {
      rec.set(false);
      setPhase("idle");
      setError(`Recording didn't start: ${e}. Check the microphone permission.`);
    }
  };
  const onBar = (b: number) => {
    if (b >= TAKE_BARS + 1) void stop();
    else if (b >= 1) { setPhase("recording"); setBar(b); }
  };
  // bar changes, read on the UI thread from the heard clock
  useAnimatedReaction(() => (rec.value && frames.value >= 0 ? Math.floor(frames.value / barFrames) : -1), (b) => {
    if (b < 0 || b === lastBar.value) return;
    lastBar.value = b;
    scheduleOnRN(onBar, b);
  });

  const beat = useDerivedValue(() => (rec.value && frames.value >= 0 && frames.value < barFrames ? frames.value / beatFrames : -1));
  const timer = useDerivedValue(() => {
    if (rec.value && frames.value >= 0 && frames.value < barFrames) return `${4 - Math.floor(frames.value / beatFrames)}`;
    const secs = rec.value && frames.value >= barFrames ? (frames.value - barFrames) / sr : 0;
    return `${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, "0")}`;
  });
  const breath = useDerivedValue(() => {
    if (reduceMotion) return 0;
    if (rec.value && frames.value >= 0) return 0.6 * Math.exp((-motion.flashDecay * (frames.value % beatFrames)) / sr) + level.value;
    return 0.3 + 0.3 * Math.sin((2 * Math.PI * now.value) / 2.4);
  });
  const pulse = useAnimatedStyle(() => {
    const on = !reduceMotion && recording.value;
    const p = on ? (frames.value % beatFrames) / beatFrames : 1;
    return { opacity: on ? 0.55 * (1 - p) : 0, transform: [{ scale: 1 + 0.3 * p }] };
  });
  const dot = useAnimatedStyle(() => {
    const on = rec.value;
    return { width: withSpring(on ? 30 : 44, SPRING), height: withSpring(on ? 30 : 44, SPRING), borderRadius: withSpring(on ? 8 : 22, SPRING) };
  });

  const label = phase === "countIn" ? "COUNT-IN" : phase === "recording" ? `RECORDING · BAR ${bar} OF ${TAKE_BARS}` : phase === "saving" ? "FORGING…" : "TAP TO RECORD";
  const busy = phase !== "idle";
  return (
    <Shell right={<Link href="/studio" style={[type.button, s.link]} accessibilityRole="button">Studio</Link>}>
      <View style={s.chips}>
        <Chip label="Boom Bap" selected={mood === "boomBap"} onPress={() => setMood("boomBap")} disabled={busy} />
        <Chip label="Trap" selected={mood === "trap"} onPress={() => setMood("trap")} disabled={busy} />
        <Text style={[type.stat, s.muted]}>Click {bpm} BPM</Text>
      </View>
      <View style={s.center}>
        <Orb level={level} now={now} sparks={sparks} beat={beat} text={timer} breath={breath} reduceMotion={reduceMotion} />
        <Text style={[type.caps, s.label]} accessibilityLiveRegion="polite">{label}</Text>
      </View>
      <Ribbon bars={ribbon} />
      <View style={s.recRow}>
        <View>
          <Animated.View style={[s.pulse, pulse]} pointerEvents="none" />
          <Pressable accessibilityRole="button" accessibilityLabel={busy ? "Stop recording" : "Start recording"}
            onPress={busy ? stop : start} disabled={phase === "saving"} style={s.rec}>
            <Animated.View style={[s.dot, dot]} />
          </Pressable>
        </View>
      </View>
      <Text style={[type.body, s.hint]}>
        {error ?? (busy ? "Listening… every hit sparks." : "Beatbox the drums, then hum a bassline, in one take.")}
      </Text>
      {__DEV__ && <Link href="/dev/spike" style={[type.stat, s.muted, s.devLink]}>dev: audio spike</Link>}
    </Shell>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground, paddingHorizontal: space.page, width: "100%", maxWidth: 520, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  link: { color: color.soft, padding: 12, minHeight: 44 },
  chips: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  label: { color: "#E9E3FF", position: "absolute", top: "50%", marginTop: 26, textAlign: "center" },
  muted: { color: color.muted, marginLeft: 4 },
  recRow: { alignItems: "center", marginTop: 12 },
  rec: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: color.magenta, backgroundColor: "rgba(255,43,214,.16)", justifyContent: "center", alignItems: "center" },
  dot: { backgroundColor: color.magenta },
  pulse: { position: "absolute", width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: color.magenta },
  hint: { color: color.muted, textAlign: "center", marginTop: 12, fontSize: 13 },
  error: { color: color.magenta, marginTop: 24 },
  devLink: { textAlign: "center", padding: 12 },
});
