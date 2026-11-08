import { Link, Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ComponentRef, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  type SharedValue, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { takeFileName } from "@/analysis/audacity";
import { songFromTake } from "@/analysis/forgeTake";
import { useKit } from "@/analysis/kit";
import { useCalibration, useRoute } from "@/audio/calibration";
import type { Mood } from "@/audio/kit";
import { alignTake, outputLatency } from "@/audio/latency";
import { saveWav } from "@/audio/saveWav";
import { type Take, useTake } from "@/audio/take";
import type { AudioEngine } from "@/audio/types";
import { encodeWav } from "@/audio/wav";
import { useEngine } from "@/audio/useEngine";
import { DEMOS, useStudio } from "@/audio/useStudio";
import { barCells } from "@/song/grid";
import { metronome } from "@/song/metronome";
import { useSong } from "@/song/store";
import { defaultInstruments } from "@/song/time";
import { Chip } from "@/ui/controls";
import { B, FLOW, leaves } from "@/ui/forge/flow";
import { type Dot, type ForgeGeom, ForgeOverlay } from "@/ui/forge/ForgeOverlay";
import { prog, spring } from "@/ui/motion";
import { Orb } from "@/ui/Orb";
import { Ribbon } from "@/ui/Ribbon";
import { STUDIO_LANES, StudioView } from "@/ui/studio/StudioView";
import { color, LANES_UI, motion, space, type } from "@/ui/theme";
import { RIBBON_BARS, type RibbonBar, useMicVisuals } from "@/ui/useMicVisuals";
import { usePlayhead } from "@/ui/usePlayhead";

// dev hook: `EXPO_PUBLIC_SPIKE_AUTO=render npx expo start` opens the spike and runs the offline render headlessly
const SPIKE_AUTO = process.env.EXPO_PUBLIC_SPIKE_AUTO;
const TAKE_BARS = 4; // after a one-bar count-in (P2 makes 2/4/8 a choice)
const HOLD = FLOW.flight - 0.05; // the forge waits here for the take's analysis if it isn't done yet
const SPRING = { stiffness: 144, damping: 19.2, mass: 1 }; // the film's ω = 12, ζ = 0.8
type El = ComponentRef<typeof View>;

export default function Index() {
  if (SPIKE_AUTO) return <Redirect href={{ pathname: "/dev/spike", params: { auto: SPIKE_AUTO } }} />;
  return <Session />;
}

/**
 * Record → Forge → Studio as one screen, no cuts (Eyal, 2026-11-08): the take's ribbon and the record button turn into
 * the forge, which lands in the real Studio grid; then the Studio's controls rise in around it.
 * Dev: `/?forge=demo` runs the forge on a made-up take (`&t=3.6` freezes it; `seek(t)` on web drives captures).
 */
function Session() {
  const { audio, error } = useEngine();
  const reduceMotion = useReducedMotion();
  const { forge: demo, t: at } = useLocalSearchParams<{ forge?: string; t?: string }>();
  const frozen = __DEV__ && at !== undefined;
  const song = useSong((s) => s.song);
  const setSong = useSong((s) => s.setSong);
  const setTake = useTake((s) => s.setTake);
  const [phase, setPhase] = useState<"record" | "forge" | "studio">("record");
  const st = useStudio(phase === "record" ? null : audio);
  useRoute(audio);
  const root = useRef<El>(null), ribbonEl = useRef<El>(null), buttonEl = useRef<El>(null), gridEl = useRef<El>(null);
  const [geom, setGeom] = useState<ForgeGeom | null>(null);
  const ribbon = useSharedValue<RibbonBar[]>([]);
  const forgeT = useSharedValue(0), start = useSharedValue(-1), forging = useSharedValue(false);
  const heardAt = useSharedValue(Infinity); // forge time the take's song was ready (its dots exist from then)

  // the forge's clock (seconds since Stop), from the first forge frame; it holds before the first dot flies until the
  // take has been heard (the analysis normally takes well under that ~1 s)
  useFrameCallback((f) => {
    if (!forging.value || frozen) return;
    if (start.value < 0) start.value = f.timestamp;
    const t = (f.timestamp - start.value) / 1000;
    if (heardAt.value === Infinity && t > HOLD) {
      start.value = f.timestamp - HOLD * 1000;
      forgeT.value = HOLD;
      return;
    }
    forgeT.value = t;
  });
  useAnimatedReaction(() => forging.value && !frozen && forgeT.value >= FLOW.end, (done, was) => {
    if (done && !was) scheduleOnRN(setPhase, "studio");
  });
  useEffect(() => {
    if (phase === "studio") forging.set(false);
  }, [phase, forging]);

  // the forge lands the song's first bar: the take's detected hits (none until it has been heard)
  const cells = barCells(song, 0, STUDIO_LANES);
  const dots: Dot[] = cells.flatMap((row, r) => row.flatMap((v, step) => (v > 0 ? [{ row: r, step, color: LANES_UI[STUDIO_LANES[r]!].color, shape: LANES_UI[STUDIO_LANES[r]!].shape }] : [])));
  const land = cells.map((row, r) => row.map((_, step) => leaves(step, r) + FLOW.landAfter));
  const bars = song.bars;
  const pos = useDerivedValue(() => (forgeT.value >= FLOW.beam[0] && forgeT.value < FLOW.beam[1] ? prog(forgeT.value, FLOW.beam[0], FLOW.beam[1]) / bars : -1));

  const rel = (el: El | null) => {
    const a = el!.getBoundingClientRect(), r = root.current!.getBoundingClientRect();
    return { x: a.x - r.x, y: a.y - r.y, w: a.width, h: a.height };
  };
  const startForge = () => {
    if (reduceMotion) { setPhase("studio"); return; }
    const rb = rel(ribbonEl.current), bt = rel(buttonEl.current);
    setGeom({ ribbon: { x: rb.x, y: rb.y, w: rb.w }, button: { x: bt.x + bt.w / 2, y: bt.y + bt.h / 2 }, grid: null });
    start.set(-1);
    forgeT.set(frozen ? Number(at) : 0);
    forging.set(true);
    setPhase("forge");
  };
  const onTake = (take: Take | null, mood: Mood) => {
    setTake(take);
    if (!take) { // dev: a made-up take forges the demo groove
      setSong(DEMOS[mood]());
      heardAt.set(0);
      startForge();
      return;
    }
    heardAt.set(Infinity);
    setSong({ ...DEMOS[mood](), id: "take-pending", tracks: [] }); // nothing lands until the take has been heard
    startForge();
    setTimeout(() => void hear(take), 50); // after the forge's first frames: native analysis keeps the JS thread busy
  };
  const hear = async (take: Take) => {
    try {
      const { song: heard, analysis, analysedMs, rtl } = await songFromTake(audio!, take, useKit.getState().templates, useCalibration.getState().rtlMs);
      const stored = useCalibration.getState().rtlMs;
      if (rtl.from === "count-in") useCalibration.getState().setRtlMs(rtl.ms); // a fresh measurement of this route (drift)
      setSong(heard);
      const notes = Object.fromEntries(heard.tracks.map((t) => [t.kind, t.notes.length]));
      console.log("[take]", JSON.stringify({
        step: "heard", platform: audio!.platform, msSinceStop: Math.round(performance.now() - take.stoppedAt), analysedMs: Math.round(analysedMs),
        seconds: Math.round((take.input.length / take.sampleRate) * 10) / 10, hits: analysis.hits.length, notes, bars: heard.bars, swing: Math.round(heard.swing * 100) / 100,
        rtl: { ms: Math.round(rtl.ms * 10) / 10, from: rtl.from, stored: stored === null ? null : Math.round(stored * 10) / 10, route: useCalibration.getState().route },
      }));
    } catch (e) {
      console.warn("[take]", JSON.stringify({ step: "analysis failed", error: String(e) }));
      setSong(DEMOS[take.mood]()); // the take stays in useTake (dev: save it); the Studio opens on the demo
    } finally {
      heardAt.set(forgeT.get());
    }
  };

  // the grid's place once Studio has laid out; its panel starts 24 px low (the rise), so take that off
  useEffect(() => {
    if (phase !== "forge" || !geom || geom.grid) return;
    const id = setInterval(() => {
      if (!gridEl.current) return;
      const g = rel(gridEl.current);
      if (g.w <= 0) return;
      const u = spring(forgeT.get() - FLOW.gridIn, 12, 0.85);
      setGeom((prev) => prev && { ...prev, grid: { x: g.x, y: g.y - 24 * (1 - u), w: g.w } });
      clearInterval(id);
    }, 30);
    return () => clearInterval(id);
  });

  // dev: forge any audio as a take, no mic (web console / remote checks): __gfForgeTake(samples, bpm, mood), the
  // samples starting with the one-bar count-in, the click already out
  useEffect(() => {
    if (!__DEV__ || !audio) return;
    Object.assign(globalThis, {
      __gfForgeTake: (input: Float32Array, bpm: number, mood: Mood) => onTake({
        input, output: new Float32Array(input.length), stoppedAt: performance.now(), sampleRate: audio.sampleRate, bpm, mood, countInFrames: (240 / bpm) * audio.sampleRate,
      }, mood),
    });
  });

  // dev: a made-up take straight into the forge (no mic), for screenshots and the side-by-side
  const demoStarted = useRef(false);
  useEffect(() => {
    if (!__DEV__ || demo !== "demo" || !audio || demoStarted.current) return;
    demoStarted.current = true;
    ribbon.set(Array.from({ length: RIBBON_BARS }, (_, i) => ({ h: 0.15 + 0.5 * Math.abs(Math.sin(i * 2.3)), lane: i % 4 === 0 ? (i / 4) % 3 : -1 })));
    const id = setTimeout(() => onTake(null, "boomBap"), 400);
    Object.assign(globalThis, { seek: (x: number) => forgeT.set(x), FILM: { w: 390, h: 844, duration: FLOW.end } });
    return () => clearTimeout(id);
  });

  return (
    <View ref={root} style={s.root} collapsable={false}>
      <Stack.Screen options={{ headerShown: false }} />
      {phase !== "record" && (
        <View style={StyleSheet.absoluteFill}>
          <StudioView st={st} forge={phase === "forge" ? { t: forgeT, land, pos } : undefined} gridRef={gridEl}
            footer={__DEV__ && phase === "studio" && audio ? <SaveTake audio={audio} /> : undefined} />
        </View>
      )}
      {phase !== "studio" && (audio
        ? <RecordView audio={audio} ribbon={ribbon} forgeT={phase === "forge" ? forgeT : null} ribbonEl={ribbonEl} buttonEl={buttonEl}
            onTake={onTake} reduceMotion={reduceMotion} geom={geom} />
        : <Shell>{error && <Text style={[type.body, s.error]}>{error}</Text>}</Shell>)}
      {phase === "forge" && geom && <ForgeOverlay t={forgeT} geom={geom} ribbon={ribbon} dots={dots} heardAt={heardAt} />}
      {phase === "forge" && <ForgingLabel t={forgeT} />}
    </View>
  );
}

/**
 * Dev: saves the last take for the golden set (docs: golden/README.md), shifted by the measured round trip. Its name
 * carries mood, tempo and count-in for `npm run golden:import`; "-unaligned" if the route isn't calibrated yet.
 */
function SaveTake({ audio }: { audio: AudioEngine }) {
  const take = useTake((t) => t.take);
  const rtlMs = useCalibration((c) => c.rtlMs);
  const [note, setNote] = useState("");
  if (!take) return null;
  const save = async () => {
    try {
      const route = (await audio.route()).outputs[0] ?? "unknown";
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const name = takeFileName({ mood: take.mood, bpm: take.bpm, countInSec: take.countInFrames / take.sampleRate, route, stamp });
      const aligned = rtlMs !== null && Number.isFinite(rtlMs);
      const samples = aligned ? alignTake(take.input, (rtlMs! / 1000) * take.sampleRate) : take.input;
      await saveWav(encodeWav(samples, take.sampleRate), `${name}${aligned ? "" : "-unaligned"}.wav`);
      setNote(aligned ? "Saved." : "Saved, but not latency-aligned: calibrate sync first for golden takes.");
    } catch (e) {
      setNote(`Save failed: ${e}`);
    }
  };
  return (
    <Pressable accessibilityRole="button" onPress={save} style={s.devSave}>
      <Text style={[type.stat, s.muted]}>dev: save this take for the golden set{note ? ` · ${note}` : ""}</Text>
    </Pressable>
  );
}

/** "FORGING YOUR BEAT" rises in where the Studio title will be, and out as the title rises in. */
function ForgingLabel({ t }: { t: SharedValue<number> }) {
  const insets = useSafeAreaInsets();
  const anim = useAnimatedStyle(() => {
    const i = spring(t.value - 0.6 * B, 14, 0.85), o = spring(t.value - FLOW.chrome[0], 14, 0.85);
    return { opacity: Math.max(0, Math.min(1, i) - o), transform: [{ translateY: 18 * (1 - i) - 18 * o }] };
  });
  return (
    <View style={[s.forgingWrap, { top: insets.top + space.pageTop }]} pointerEvents="none">
      <Animated.Text style={[type.caps, { color: "#7FF3FF" }, anim]} accessibilityLiveRegion="polite">FORGING YOUR BEAT</Animated.Text>
    </View>
  );
}

function Shell({ children, right, leave }: { children?: ReactNode; right?: ReactNode; leave?: object }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top + space.pageTop, paddingBottom: insets.bottom + space.pageBottom }]}>
      <Animated.View style={[s.header, leave]}>
        <Text style={[type.brand, { color: color.text }]} accessibilityRole="header">GROOVE<Text style={{ color: color.magenta }}>FORGE</Text></Text>
        {right}
      </Animated.View>
      {children}
    </View>
  );
}

/** Record (docs/design/1-record.dc.html): count in, beatbox + hum one take over the click. `forgeT` set = leaving. */
function RecordView({ audio, ribbon, forgeT, ribbonEl, buttonEl, onTake, reduceMotion, geom }: {
  audio: AudioEngine; ribbon: SharedValue<RibbonBar[]>; forgeT: SharedValue<number> | null; ribbonEl: RefObject<El | null>;
  buttonEl: RefObject<El | null>; onTake: (take: Take | null, mood: Mood) => void; reduceMotion: boolean;
  geom: ForgeGeom | null;
}) {
  const rtlMs = useCalibration((c) => c.rtlMs);
  const router = useRouter();
  const taught = useKit((k) => k.templates !== null);
  const [mood, setMood] = useState<Mood>("boomBap");
  const [phase, setPhase] = useState<"idle" | "countIn" | "recording" | "saving">("idle");
  const [bar, setBar] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const self = useRef<El>(null), orbEl = useRef<El>(null);
  // the orb is drawn by a full-screen layer (so it can fall into the bar); its place on Record is measured here
  const [orbCenter, setOrbCenter] = useState<{ x: number; y: number } | null>(null);
  const measureOrb = () => {
    if (!orbEl.current || !self.current) return;
    const o = orbEl.current.getBoundingClientRect(), r = self.current.getBoundingClientRect();
    setOrbCenter({ x: o.x - r.x + o.width / 2, y: o.y - r.y + o.height / 2 });
  };

  const sr = audio.sampleRate;
  const bpm = DEMOS[mood]().bpm;
  const beatFrames = (60 / bpm) * sr, barFrames = 4 * beatFrames;
  const { frames } = usePlayhead(audio.clock, outputLatency(audio.reportedLatency(), rtlMs, sr).frames, sr);
  const rec = useSharedValue(false);
  const lastBar = useSharedValue(-1);
  const recording = useDerivedValue(() => rec.value && frames.value >= barFrames);
  const { level, now, sparks } = useMicVisuals(audio.clock, frames, beatFrames / 4, recording, ribbon);

  const stop = async () => {
    if (!rec.get()) return;
    const take = lastBar.get() >= 1; // stopping during the count-in throws the take away
    rec.set(false);
    setPhase(take ? "saving" : "idle");
    const stoppedAt = performance.now();
    const { input, output } = await audio.captureStop();
    await audio.stop();
    if (!take) return;
    onTake({ input, output, stoppedAt, sampleRate: sr, bpm, mood, countInFrames: barFrames }, mood);
  };
  const begin = async () => {
    setError(null);
    try {
      await audio.stop();
      await audio.setProgram({ instruments: defaultInstruments() });
      await audio.setSong(metronome(bpm));
      lastBar.set(-1);
      ribbon.set([]);
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
    const on = rec.value || forgeT !== null; // stays the stop square into the forge
    return { width: withSpring(on ? 30 : 44, SPRING), height: withSpring(on ? 30 : 44, SPRING), borderRadius: withSpring(on ? 8 : 22, SPRING) };
  });
  // leaving into the forge: chrome rises out, the orb sinks into the record button, ribbon + button hand over to the overlay
  const leave = useAnimatedStyle(() => {
    if (!forgeT) return { opacity: 1, transform: [{ translateY: 0 }] };
    const u = spring(forgeT.value - FLOW.collapse, 14, 0.85);
    return { opacity: Math.max(0, 1 - u), transform: [{ translateY: -24 * u }] };
  });
  const timerFade = useDerivedValue(() => (forgeT ? 1 - prog(forgeT.value, FLOW.collapse, FLOW.collapse + 0.15) : 1));
  const handedOver = forgeT ? { opacity: 0 } : null;

  const label = phase === "countIn" ? "COUNT-IN" : phase === "recording" ? `RECORDING · BAR ${bar} OF ${TAKE_BARS}` : phase === "saving" ? `RECORDING · BAR ${TAKE_BARS} OF ${TAKE_BARS}` : "TAP TO RECORD";
  const busy = phase !== "idle";
  return (
    <View ref={self} style={StyleSheet.absoluteFill} pointerEvents={forgeT ? "none" : "auto"} collapsable={false}>
      <Orb center={orbCenter} level={level} now={now} sparks={sparks} beat={beat} text={timer} textOpacity={timerFade}
        breath={breath} reduceMotion={reduceMotion} forge={forgeT && geom ? { t: forgeT, button: geom.button, barW: geom.ribbon.w } : null} />
      <Shell leave={leave} right={<Link href="/studio" style={[type.button, s.link]} accessibilityRole="button">Studio</Link>}>
        <Animated.View style={[s.chips, leave]}>
          <Chip label="Boom Bap" selected={mood === "boomBap"} onPress={() => setMood("boomBap")} disabled={busy} />
          <Chip label="Trap" selected={mood === "trap"} onPress={() => setMood("trap")} disabled={busy} />
          <Text style={[type.stat, s.muted]}>Click {bpm} BPM</Text>
          <View style={{ flex: 1 }} />
          <Chip label={taught ? "Kit taught ✓" : "Teach me your kit"} selected={false} onPress={() => router.push("/teach")}
            disabled={busy} accent={color.lime} />
        </Animated.View>
        <View style={s.center}>
          <View ref={orbEl} style={s.orbSlot} onLayout={measureOrb} collapsable={false} />
          <Animated.Text style={[type.caps, s.label, leave]} accessibilityLiveRegion="polite">{label}</Animated.Text>
        </View>
        <View ref={ribbonEl} style={handedOver} collapsable={false}>
          <Ribbon bars={ribbon} />
        </View>
        <View style={s.recRow}>
          <View ref={buttonEl} style={handedOver} collapsable={false}>
            <Animated.View style={[s.pulse, pulse]} pointerEvents="none" />
            <Pressable accessibilityRole="button" accessibilityLabel={busy ? "Stop recording" : "Start recording"}
              onPress={busy ? stop : begin} disabled={phase === "saving"} style={s.rec}>
              <Animated.View style={[s.dot, dot]} />
            </Pressable>
          </View>
        </View>
        <Animated.Text style={[type.body, s.hint, leave]}>
          {error ?? (busy ? "Listening… every hit sparks." : "Beatbox the drums, then hum a bassline, in one take.")}
        </Animated.Text>
        {__DEV__ && ( // stays mounted while leaving: removing it shifted the layout under the forge's measurements
          <Animated.View style={leave}>
            <Link href="/dev/spike" style={[type.stat, s.muted, s.devLink]}>dev: audio spike</Link>
          </Animated.View>
        )}
      </Shell>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ground },
  screen: { flex: 1, paddingHorizontal: space.page, width: "100%", maxWidth: 520, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  link: { color: color.soft, padding: 12, minHeight: 44 },
  chips: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  orbSlot: { height: 380, alignSelf: "stretch" },
  label: { color: "#E9E3FF", position: "absolute", top: "50%", marginTop: 26, textAlign: "center" },
  muted: { color: color.muted, marginLeft: 4 },
  recRow: { alignItems: "center", marginTop: 12 },
  rec: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: color.magenta, backgroundColor: "rgba(255,43,214,.16)", justifyContent: "center", alignItems: "center" },
  dot: { backgroundColor: color.magenta },
  pulse: { position: "absolute", width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: color.magenta },
  hint: { color: color.muted, textAlign: "center", marginTop: 12, fontSize: 13 },
  error: { color: color.magenta, marginTop: 24 },
  devLink: { textAlign: "center", padding: 12 },
  devSave: { minHeight: 44, justifyContent: "center" },
  forgingWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: space.page },
});
