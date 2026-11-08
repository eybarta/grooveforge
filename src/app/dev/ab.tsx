import { strToU8, zipSync } from "fflate";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { renderStudioWav } from "../../../reference/poc-audio/engine.ts";
import { onGrid, toPoc } from "@/ab/pocPattern";
import { createAudioEngine } from "@/audio/engine";
import { loadKit } from "@/audio/loadKit";
import { DEFAULT_KNOBS } from "@/audio/mix";
import { masterSong } from "@/audio/studioRender";
import type { AudioEngine } from "@/audio/types";
import { encodeWav } from "@/audio/wav";
import { boomBapDemo, trapDemo } from "@/song/demoGrooves";
import { loopSeconds } from "@/song/time";
import type { Lane } from "@/song/types";

/** Every clip is matched to this loudness (or lower, if a clip's true peak would pass −1 dBTP), so louder can't win. */
const MATCH_LUFS = -16;
const MAX_TRUE_PEAK_DB = -1;
const FADE_SEC = 0.02;
const MOODS = [["Boom Bap", boomBapDemo], ["Trap", trapDemo]] as const;
const PARTS: { label: string; lanes?: Lane[] }[] = [
  { label: "full beat" },
  { label: "drums only", lanes: ["kick", "snare", "hatClosed", "hatOpen", "perc"] },
  { label: "kick + 808", lanes: ["kick", "bass"] },
];

interface Clip { pair: string; label: string; engine: "v2" | "poc"; ch: Float32Array[] }
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The same pattern through the POC (its own default mix) and v2 (default knobs, Loud master), equal length. */
async function renderPairs(a: AudioEngine, log: (s: string) => void): Promise<Clip[]> {
  const resampler = new OfflineAudioContext(2, 1, a.sampleRate); // decodeAudioData resamples the POC's 44.1 kHz
  const clips: Clip[] = [];
  for (const [mood, make] of MOODS)
    for (const part of PARTS) {
      const pair = `p${clips.length / 2 + 1}`, label = `${mood} · ${part.label}`;
      log(`rendering ${label}…`);
      const song = onGrid(make(), part.lanes);
      const loops = Math.min(4, Math.ceil(8 / loopSeconds(song))); // the POC export's own length rule
      const v2 = (await masterSong(a, song, DEFAULT_KNOBS, "loud", loops)).channels;
      const { steps, mix } = toPoc(song);
      const poc = await resampler.decodeAudioData(await (await renderStudioWav(steps, song.bpm, mix)).arrayBuffer());
      const frames = v2[0]!.length; // the POC adds a 0.75 s tail; cut both at the same bar line
      clips.push({ pair, label, engine: "v2", ch: v2 }, { pair, label, engine: "poc", ch: [0, 1].map((c) => poc.getChannelData(c).slice(0, frames)) });
    }
  for (const c of clips)
    for (const x of c.ch) for (let i = Math.round(FADE_SEC * a.sampleRate), n = x.length; i > 0; i--) x[n - i]! *= (i - 1) / (FADE_SEC * a.sampleRate);
  return clips;
}

/** Gains every clip to one common loudness, keeping every true peak ≤ −1 dBTP. */
async function matchLoudness(a: AudioEngine, clips: Clip[]) {
  const before = [];
  for (const c of clips) before.push(await a.loudness(c.ch));
  const lufs = Math.min(MATCH_LUFS, ...before.map((m) => m.lufs + MAX_TRUE_PEAK_DB - m.truePeakDb));
  const after = [];
  for (const [i, c] of clips.entries()) {
    const g = 10 ** ((lufs - before[i]!.lufs) / 20);
    for (const x of c.ch) for (let k = 0; k < x.length; k++) x[k]! *= g;
    after.push({ ...(await a.loudness(c.ch)), gainDb: r2(20 * Math.log10(g)), sourceLufs: r2(before[i]!.lufs), sourceTruePeakDb: r2(before[i]!.truePeakDb) });
  }
  return { lufs: r2(lufs), after };
}

/**
 * Dev page (web): builds the P1 blind A/B set and downloads it as one zip. Files are named p1-x / p1-y …;
 * which of x / y is v2 is random and only in key.json (keep it out of the public repo until the test is over).
 */
export default function AB() {
  const [audio, setAudio] = useState<AudioEngine | null>(null);
  const [status, setStatus] = useState("starting engine…");
  const [zip, setZip] = useState<Uint8Array | null>(null);
  const log = (s: string) => (console.log("[ab]", s), setStatus(s));

  useEffect(() => {
    let created: AudioEngine | null = null;
    (async () => {
      created = await createAudioEngine();
      await loadKit(created);
      setAudio(created);
      setStatus("ready");
    })().catch((e) => setStatus(`init failed: ${e}`));
    return () => void created?.close();
  }, []);

  const build = async () => {
    if (!audio) return;
    setZip(null);
    try {
      const clips = await renderPairs(audio, log);
      const { lufs, after } = await matchLoudness(audio, clips);
      const files: Record<string, Uint8Array> = {};
      const key: Record<string, object> = {};
      const pairs: { id: string; label: string }[] = [];
      for (let i = 0; i < clips.length; i += 2) {
        const [v2, poc] = [clips[i]!, clips[i + 1]!];
        const v2IsX = Math.random() < 0.5;
        const name = (c: Clip) => `${c.pair}-${(c === v2) === v2IsX ? "x" : "y"}.wav`;
        for (const c of [v2, poc]) files[`audio/${name(c)}`] = encodeWav(c.ch, audio.sampleRate, "24");
        pairs.push({ id: v2.pair, label: v2.label });
        key[v2.pair] = { label: v2.label, x: v2IsX ? "v2" : "poc", y: v2IsX ? "poc" : "v2", v2: after[i], poc: after[i + 1] };
      }
      files["pairs.json"] = strToU8(JSON.stringify(pairs, null, 1));
      files["key.json"] = strToU8(JSON.stringify({ matchLufs: lufs, sampleRate: audio.sampleRate, pairs: key }, null, 1));
      console.log("[ab]", JSON.stringify({ step: "set", matchLufs: lufs, key }));
      setZip(zipSync(files, { level: 0 })); // WAV barely compresses
      setStatus(`ready: ${pairs.length} pairs at ${lufs} LUFS`);
    } catch (e) {
      log(`failed: ${e}`);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
    Object.assign(document.createElement("a"), { href: url, download: "gf-ab-set.zip" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  if (Platform.OS !== "web") return <Text style={s.text}>The A/B set builds on web only (the POC is Web Audio).</Text>;
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.h1}>Blind A/B set</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Build A/B set" onPress={build} disabled={!audio} style={[s.btn, !audio && s.off]}>
        <Text style={s.text}>Build A/B set</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Download A/B set" onPress={download} disabled={!zip} style={[s.btn, !zip && s.off]}>
        <Text style={s.text}>Download A/B set (zip)</Text>
      </Pressable>
      <Text style={s.log}>{status}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  h1: { color: "#fff", fontSize: 22, fontWeight: "700" },
  btn: { minHeight: 56, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  off: { opacity: 0.4 },
  text: { color: "#fff", fontSize: 16 },
  log: { color: "rgba(255,255,255,.85)", fontFamily: "monospace", fontSize: 12 },
});
