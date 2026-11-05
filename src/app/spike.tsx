import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { alignTake } from "@/audio/latency";
import { saveWav } from "@/audio/saveWav";
import { createSpikeAudio } from "@/audio/spike";
import { calibrate, verifyAlignment } from "@/audio/spikeRuns";
import { HOST_REFERENCE, loopSong } from "@/audio/spikeSongs";
import type { SpikeAudio } from "@/audio/types";
import { encodeWav, fingerprint } from "@/audio/wav";

type Route = "wired" | "bluetooth" | "speaker";
const SOAK_SEC = 60;
const SOAK_CAPTURE_SEC = 25;

/** Phase 0 audio spike: every result is shown here and logged as JSON ("[spike]") for Metro / the console. */
export default function Spike() {
  const [audio, setAudio] = useState<SpikeAudio | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>("wired");
  const [drive, setDrive] = useState(0);
  const [rtlMs, setRtlMs] = useState<number | null>(null);
  const [take, setTake] = useState<Float32Array | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const report = (step: string, data: object) => {
    const line = { step, route, platform: audio?.platform, ...data };
    console.log("[spike]", JSON.stringify(line));
    setLog((l) => [`${step}: ${JSON.stringify(data, (_, v) => (typeof v === "number" ? +v.toFixed(3) : v))}`, ...l]);
  };

  useEffect(() => {
    let created: SpikeAudio | null = null;
    createSpikeAudio()
      .then((a) => { created = a; setAudio(a); })
      .catch((e) => setLog([`init failed: ${e}`]));
    return () => void created?.close();
  }, []);

  const run = async (label: string, f: (a: SpikeAudio) => Promise<void>) => {
    if (!audio || busy) return;
    setBusy(label);
    try { await f(audio); } catch (e) { report(`${label} FAILED`, { error: String(e) }); } finally { setBusy(null); }
  };

  const soak = () => run("Loop + record", async (a) => {
    await a.stop();
    await a.setSong(loopSong());
    a.captureStart();
    const t0 = Date.now();
    await a.start();
    await new Promise((r) => setTimeout(r, SOAK_CAPTURE_SEC * 1000));
    const { input } = await a.captureStop();
    const elapsed = (Date.now() - t0) / 1000;
    // the audio callback should process frames at the sample rate; a stalled callback shows up as a ratio < 1
    report("soak capture", { capturedSec: input.length / a.sampleRate, wallSec: elapsed, ratio: input.length / a.sampleRate / elapsed });
    setTake(rtlMs === null ? input : alignTake(input, (rtlMs / 1000) * a.sampleRate));
    await new Promise((r) => setTimeout(r, (SOAK_SEC - SOAK_CAPTURE_SEC) * 1000));
    await a.stop();
    report("soak done", { seconds: SOAK_SEC, listenFor: "clicks/dropouts in the loop", reported: a.reportedLatency() });
  });

  const cal = () => run("Calibrate", async (a) => {
    const c = await calibrate(a);
    setRtlMs(c.rtlMs);
    report("latency", { rtlMs: c.rtlMs, repeatabilityMs: c.repeatabilityMs, runs: c.runs, reportedSec: a.reportedLatency() });
  });

  const verify = () => run("Verify shift", async (a) => {
    if (rtlMs === null) throw new Error("calibrate first");
    const r = await verifyAlignment(a, rtlMs);
    report("residual after shift", { residualMs: r.rtlMs, clicks: r.clicks, pass: Math.abs(r.rtlMs) <= 1 });
  });

  const render = () => run("Render WAV", async (a) => {
    const t0 = Date.now();
    const x = await a.renderOffline(loopSong(), drive);
    const f = fingerprint(x);
    const matchesHost = drive === 0
      && f.frames === HOST_REFERENCE.frames
      && Math.abs(f.meanAbs - HOST_REFERENCE.meanAbs) < 1e-4
      && Math.abs(f.peak - HOST_REFERENCE.peak) < 1e-4;
    report("offline render", { ...f, ms: Date.now() - t0, drive, matchesHost: drive === 0 ? matchesHost : "n/a (drive on)" });
    await saveWav(encodeWav(x, a.sampleRate), `gf-loop-drive${drive}.wav`);
  });

  const saveTake = () => run("Save take", async (a) => {
    if (!take) throw new Error("record a loop first");
    await saveWav(encodeWav(take, a.sampleRate), `gf-take-${route}${rtlMs === null ? "-unaligned" : ""}.wav`);
  });

  const stop = () => run("Stop", async (a) => a.stop());

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.h1}>Audio spike</Text>
      <Text style={s.meta}>
        {audio ? `${audio.platform} · ${audio.sampleRate} Hz` : "starting engine…"}
        {rtlMs !== null ? ` · RTL ${rtlMs.toFixed(2)} ms` : ""}
      </Text>

      <Text style={s.label}>Route (tags the results)</Text>
      <View style={s.row}>
        {(["wired", "bluetooth", "speaker"] as const).map((r) => (
          <Chip key={r} label={r} on={route === r} onPress={() => setRoute(r)} />
        ))}
      </View>

      <Text style={s.label}>Drive (C++ effect, live)</Text>
      <View style={s.row}>
        {[0, 0.5, 1].map((d) => (
          <Chip key={d} label={String(d)} on={drive === d} onPress={() => { setDrive(d); audio?.setDrive(d); }} />
        ))}
      </View>

      <Btn label={`1 · Loop + record (${SOAK_SEC} s)`} onPress={soak} busy={busy} disabled={!audio} />
      <Btn label="2 · Calibrate latency (hold earbud to mic)" onPress={cal} busy={busy} disabled={!audio} />
      <Btn label="3 · Verify shift" onPress={verify} busy={busy} disabled={!audio || rtlMs === null} />
      <Btn label="4 · Render WAV offline" onPress={render} busy={busy} disabled={!audio} />
      <Btn label="Save last take" onPress={saveTake} busy={busy} disabled={!take} />
      <Btn label="Stop" onPress={stop} busy={null} disabled={!audio} />

      {busy && <Text style={s.busy}>{busy}…</Text>}
      {log.map((l, i) => <Text key={i} style={s.log}>{l}</Text>)}
    </ScrollView>
  );
}

function Btn({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy: string | null; disabled: boolean }) {
  const off = disabled || busy !== null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off }}
      onPress={onPress} disabled={off} style={[s.btn, off && s.off]}>
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
      onPress={onPress} style={[s.chip, on && s.chipOn]}>
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  h1: { color: "#fff", fontSize: 22, fontWeight: "700" },
  meta: { color: "rgba(255,255,255,.6)", fontFamily: "monospace" },
  label: { color: "rgba(255,255,255,.6)", marginTop: 4 },
  row: { flexDirection: "row", gap: 8 },
  btn: {
    minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)",
  },
  off: { opacity: 0.4 },
  chip: { minHeight: 44, minWidth: 64, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  chipOn: { borderColor: "#00E5FF" },
  btnText: { color: "#fff", fontSize: 16 },
  busy: { color: "#C6FF3D" },
  log: { color: "rgba(255,255,255,.85)", fontFamily: "monospace", fontSize: 12 },
});
