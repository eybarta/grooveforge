import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useCalibration } from "@/audio/calibration";
import { createAudioEngine } from "@/audio/engine";
import type { Mood } from "@/audio/kit";
import { outputLatency } from "@/audio/latency";
import { loadKit } from "@/audio/loadKit";
import { LOUDNESS_TARGETS, type LoudnessTarget } from "@/audio/master";
import { DEFAULT_KNOBS, type Knobs } from "@/audio/mix";
import { saveWav } from "@/audio/saveWav";
import { masterSong, studioProgram } from "@/audio/studioRender";
import type { AudioEngine, EngineProgram, SessionMode } from "@/audio/types";
import { encodeWav } from "@/audio/wav";
import { LoopBeam } from "@/components/LoopBeam";
import { boomBapDemo, trapDemo } from "@/song/demoGrooves";

const DEMOS: Record<Mood, () => ReturnType<typeof boomBapDemo>> = { boomBap: boomBapDemo, trap: trapDemo };
const KNOB_STEPS = [0, 0.25, 0.5, 0.75, 1];

const EXPORT_LOOPS = 4; // the 2-bar demos → 8 bars
const LIVE_LOOPS = 2; // enough to find the live gain quickly
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Kit + mix for a mood's demo, at the knob settings and master gain. */
const program = (m: Mood, knobs: Knobs, gainDb = 0): EngineProgram => studioProgram(DEMOS[m](), knobs, gainDb);

/** Renders `loops` passes of a mood's demo, mastered to a loudness target. */
const masterDemo = (a: AudioEngine, m: Mood, knobs: Knobs, target: LoudnessTarget, loops: number) =>
  masterSong(a, DEMOS[m](), knobs, target, loops);

/** Phase 1 test bench for the studio sound (the real Studio UI is P3). Logs "[studio]" JSON like the spike. */
export default function Studio() {
  const [audio, setAudio] = useState<AudioEngine | null>(null);
  const [status, setStatus] = useState("starting engine…");
  const [mood, setMood] = useState<Mood>("boomBap");
  const [playing, setPlaying] = useState(false);
  const [knobs, setKnobs] = useState<Knobs>(DEFAULT_KNOBS);
  const [target, setTarget] = useState<LoudnessTarget>("loud");
  const [exporting, setExporting] = useState(false);
  const [sessionMode, setSessionModeState] = useState<SessionMode>("measurement");
  const rtlMs = useCalibration((c) => c.rtlMs);
  const gainDb = useRef(0); // live master gain: the one the export would use, so live sounds like the export
  const tuning = useRef(0);

  const report = (step: string, data: object) => {
    console.log("[studio]", JSON.stringify({ step, platform: audio?.platform, ...data }));
    setStatus(`${step}: ${JSON.stringify(data)}`);
  };

  useEffect(() => {
    let created: AudioEngine | null = null;
    (async () => {
      const a = await createAudioEngine();
      created = a;
      const kit = await loadKit(a);
      await a.setProgram(program("boomBap", DEFAULT_KNOBS));
      await a.setSong(boomBapDemo());
      console.log("[studio]", JSON.stringify({ step: "kit loaded", platform: a.platform, ...kit }));
      const live = await masterDemo(a, "boomBap", DEFAULT_KNOBS, "loud", LIVE_LOOPS);
      gainDb.current = live.gainDb;
      await a.setProgram(program("boomBap", DEFAULT_KNOBS, live.gainDb));
      setStatus(`kit loaded: ${kit.files} samples in ${kit.ms} ms`);
      setAudio(a);
      // dev hook: lets a debugger (or the browser console) render and measure mixes on the real engine
      if (__DEV__) Object.assign(globalThis, { __gfStudio: { a, program, masterDemo, DEMOS } });
      // the P1 export bar, measured on this platform in the background (logs only; playing works meanwhile):
      // each mood × target, 8 bars, within ± 0.5 LU and ≤ −1 dBTP
      for (const m of ["boomBap", "trap"] as const)
        for (const t of ["loud", "streaming"] as const) {
          const t0 = performance.now();
          const r = await masterDemo(a, m, DEFAULT_KNOBS, t, EXPORT_LOOPS);
          const ms = Math.round(performance.now() - t0);
          // realtime = seconds of audio rendered per second of rendering (CPU headroom of the whole chain)
          const realtime = Math.round(((r.renders * r.channels[0]!.length) / a.sampleRate / (ms / 1000)) * 10) / 10;
          console.log("[studio]", JSON.stringify({ step: "master check", platform: a.platform, mood: m, target: t, lufs: r2(r.lufs), truePeakDb: r2(r.truePeakDb), gainDb: r2(r.gainDb), renders: r.renders, ok: r.ok, ms, realtime }));
        }
    })().catch((e) => setStatus(`init failed: ${e}`));
    return () => void created?.close();
  }, []);

  /** Applies a setting now (at the last gain), then finds the gain that hits the target and applies that too. */
  async function tune(a: AudioEngine, m: Mood, k: Knobs, t: LoudnessTarget) {
    await a.setProgram(program(m, k, gainDb.current));
    const id = ++tuning.current;
    const r = await masterDemo(a, m, k, t, LIVE_LOOPS);
    if (id !== tuning.current) return; // a newer setting won
    gainDb.current = r.gainDb;
    await a.setProgram(program(m, k, r.gainDb));
    report("loudness", { mood: m, target: t, lufs: r2(r.lufs), gainDb: r2(r.gainDb) });
  }

  // switching mood swaps program + song while playing (lock-free in the engine)
  const pickMood = async (m: Mood) => {
    if (!audio) return;
    setMood(m);
    await audio.setSong(DEMOS[m]());
    await tune(audio, m, knobs, target);
  };

  const setKnob = async (k: keyof Knobs, v: number) => {
    if (!audio) return;
    const next = { ...knobs, [k]: v };
    setKnobs(next);
    await tune(audio, mood, next, target);
  };

  const pickTarget = async (t: LoudnessTarget) => {
    if (!audio) return;
    setTarget(t);
    await tune(audio, mood, knobs, t);
  };

  // temporary A/B (P1 review): is iOS's default session mode louder on the speaker than measurement mode?
  const pickSessionMode = (m: SessionMode) => {
    if (!audio) return;
    setSessionModeState(m);
    audio.setSessionMode(m);
    report("session mode", { mode: m });
  };

  const exportWav = async () => {
    if (!audio || exporting) return;
    setExporting(true);
    setStatus("mastering…");
    try {
      const r = await masterDemo(audio, mood, knobs, target, EXPORT_LOOPS);
      const name = `gf-${mood}-${target}.wav`;
      await saveWav(encodeWav(r.channels, audio.sampleRate, "24"), name);
      report("export", { name, lufs: r2(r.lufs), truePeakDb: r2(r.truePeakDb), gainDb: r2(r.gainDb), renders: r.renders, ok: r.ok });
    } catch (e) {
      setStatus(`export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  const toggle = async () => {
    if (!audio) return;
    if (playing) await audio.stop();
    else await audio.start();
    setPlaying(!playing);
  };

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.h1}>Studio sound</Text>
      <Text style={s.meta}>{audio ? `${audio.platform} · ${audio.sampleRate} Hz` : ""}</Text>

      <Text style={s.label}>Mood</Text>
      <View style={s.row}>
        {(["boomBap", "trap"] as const).map((m) => (
          <Pressable key={m} accessibilityRole="button" accessibilityLabel={m} accessibilityState={{ selected: mood === m }}
            onPress={() => pickMood(m)} style={[s.chip, mood === m && s.chipOn]} disabled={!audio}>
            <Text style={s.text}>{m === "boomBap" ? "Boom Bap" : "Trap"}</Text>
          </Pressable>
        ))}
      </View>

      {(["punch", "space"] as const).map((k) => (
        <View key={k}>
          <Text style={s.label}>{k === "punch" ? "Punch" : "Space"}</Text>
          <View style={s.row}>
            {KNOB_STEPS.map((v) => (
              <Pressable key={v} accessibilityRole="button" accessibilityLabel={`${k} ${v * 100}%`}
                accessibilityState={{ selected: knobs[k] === v }} onPress={() => setKnob(k, v)}
                style={[s.step, knobs[k] === v && s.chipOn]} disabled={!audio}>
                <Text style={s.text}>{v * 100}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <Text style={s.label}>Loudness</Text>
      <View style={s.row}>
        {(["loud", "streaming"] as const).map((t) => (
          <Pressable key={t} accessibilityRole="button" accessibilityLabel={`${t} ${LOUDNESS_TARGETS[t]} LUFS`}
            accessibilityState={{ selected: target === t }} onPress={() => pickTarget(t)}
            style={[s.chip, target === t && s.chipOn]} disabled={!audio}>
            <Text style={s.text}>{t === "loud" ? "Loud" : "Streaming"} {LOUDNESS_TARGETS[t]}</Text>
          </Pressable>
        ))}
      </View>

      {Platform.OS === "ios" && (
        <>
          <Text style={s.label}>iOS audio mode (test)</Text>
          <View style={s.row}>
            {(["measurement", "default"] as const).map((m) => (
              <Pressable key={m} accessibilityRole="button" accessibilityLabel={`${m} mode`}
                accessibilityState={{ selected: sessionMode === m }} onPress={() => pickSessionMode(m)}
                style={[s.chip, sessionMode === m && s.chipOn]} disabled={!audio}>
                <Text style={s.text}>{m === "measurement" ? "Measurement" : "Default"}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Stop" : "Play"} onPress={toggle}
        disabled={!audio} style={[s.btn, !audio && s.off]}>
        <Text style={s.text}>{playing ? "Stop" : "Play"}</Text>
      </Pressable>

      <Pressable accessibilityRole="button" accessibilityLabel="Export WAV" onPress={exportWav}
        disabled={!audio || exporting} style={[s.btn, (!audio || exporting) && s.off]}>
        <Text style={s.text}>{exporting ? "Mastering…" : "Export WAV (24-bit, 8 bars)"}</Text>
      </Pressable>

      {audio && (
        <LoopBeam clock={audio.clock} latencyFrames={outputLatency(audio.reportedLatency(), rtlMs, audio.sampleRate).frames}
          sampleRate={audio.sampleRate} onStats={(st) => console.log("[studio]", JSON.stringify({ step: "clock", ...st }))} />
      )}
      <Text style={s.log}>{status}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  h1: { color: "#fff", fontSize: 22, fontWeight: "700" },
  meta: { color: "rgba(255,255,255,.6)", fontFamily: "monospace" },
  label: { color: "rgba(255,255,255,.6)", marginTop: 4 },
  row: { flexDirection: "row", gap: 8 },
  chip: { minHeight: 44, minWidth: 96, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  chipOn: { borderColor: "#00E5FF" },
  step: { minHeight: 44, minWidth: 52, justifyContent: "center", alignItems: "center", borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  btn: { minHeight: 56, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  off: { opacity: 0.4 },
  text: { color: "#fff", fontSize: 16 },
  log: { color: "rgba(255,255,255,.85)", fontFamily: "monospace", fontSize: 12 },
});
