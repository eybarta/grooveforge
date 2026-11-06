import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { createAudioEngine } from "@/audio/engine";
import { kitProgram, type Mood } from "@/audio/kit";
import { loadKit } from "@/audio/loadKit";
import type { AudioEngine } from "@/audio/types";
import { LoopBeam } from "@/components/LoopBeam";
import { boomBapDemo, trapDemo } from "@/song/demoGrooves";

const DEMOS: Record<Mood, () => ReturnType<typeof boomBapDemo>> = { boomBap: boomBapDemo, trap: trapDemo };

/** Phase 1 test bench for the studio sound (the real Studio UI is P3). Logs "[studio]" JSON like the spike. */
export default function Studio() {
  const [audio, setAudio] = useState<AudioEngine | null>(null);
  const [status, setStatus] = useState("starting engine…");
  const [mood, setMood] = useState<Mood>("boomBap");
  const [playing, setPlaying] = useState(false);

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
      await a.setProgram(kitProgram("boomBap"));
      await a.setSong(boomBapDemo());
      console.log("[studio]", JSON.stringify({ step: "kit loaded", platform: a.platform, ...kit }));
      // objective check that the sampler path sounds on this platform: one offline loop per mood
      for (const m of ["boomBap", "trap"] as const) {
        await a.setProgram(kitProgram(m));
        const [l] = await a.renderOffline(DEMOS[m](), 0);
        const peak = l!.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
        console.log("[studio]", JSON.stringify({ step: "render check", platform: a.platform, mood: m, frames: l!.length, peak }));
      }
      await a.setProgram(kitProgram("boomBap"));
      setStatus(`kit loaded: ${kit.files} samples in ${kit.ms} ms`);
      setAudio(a);
    })().catch((e) => setStatus(`init failed: ${e}`));
    return () => void created?.close();
  }, []);

  // switching mood swaps program + song while playing (lock-free in the engine)
  const pickMood = async (m: Mood) => {
    if (!audio) return;
    setMood(m);
    await audio.setProgram(kitProgram(m));
    await audio.setSong(DEMOS[m]());
    report("mood", { mood: m });
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

      <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Stop" : "Play"} onPress={toggle}
        disabled={!audio} style={[s.btn, !audio && s.off]}>
        <Text style={s.text}>{playing ? "Stop" : "Play"}</Text>
      </Pressable>

      {audio && (
        <LoopBeam clock={audio.clock} latencyFrames={((audio.reportedLatency().outputLatency || 0) + (audio.reportedLatency().baseLatency || 0)) * audio.sampleRate}
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
  btn: { minHeight: 56, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  off: { opacity: 0.4 },
  text: { color: "#fff", fontSize: 16 },
  log: { color: "rgba(255,255,255,.85)", fontFamily: "monospace", fontSize: 12 },
});
