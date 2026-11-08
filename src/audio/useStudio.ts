import { useEffect, useRef, useState } from "react";
import { boomBapDemo, trapDemo } from "@/song/demoGrooves";
import { useSong } from "@/song/store";
import { defaultInstruments } from "@/song/time";
import type { Song } from "@/song/types";
import { useCalibration } from "./calibration";
import { createAudioEngine } from "./engine";
import type { Mood } from "./kit";
import { loadKit } from "./loadKit";
import type { LoudnessTarget } from "./master";
import { DEFAULT_KNOBS, type Knobs } from "./mix";
import { saveWav } from "./saveWav";
import { calibrate } from "./spikeRuns";
import { masterSong, studioProgram } from "./studioRender";
import type { AudioEngine } from "./types";
import { encodeWav } from "./wav";

export const DEMOS: Record<Mood, () => Song> = { boomBap: boomBapDemo, trap: trapDemo };
/** Export = 8 bars; the live gain is found on 4 (enough, and quick). */
const exportLoops = (s: Song) => 8 / s.bars;
const liveLoops = (s: Song) => Math.max(1, 4 / s.bars);
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The Studio's engine: the song in the store plays live, through the mood's kit, mix and master, at the gain that
 * hits the loudness target (so live sounds like the export). Every change applies at once at the last gain, then
 * the gain is re-found in the background. Logs "[studio]" JSON for remote checks.
 */
export function useStudio() {
  const song = useSong((s) => s.song);
  const setSong = useSong((s) => s.setSong);
  const setRtlMs = useCalibration((c) => c.setRtlMs);
  const [audio, setAudio] = useState<AudioEngine | null>(null);
  const [status, setStatus] = useState("Starting the engine…");
  const [knobs, setKnobs] = useState<Knobs>(DEFAULT_KNOBS);
  const [target, setTarget] = useState<LoudnessTarget>("loud");
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<"export" | "calibrate" | null>(null);
  const gainDb = useRef(0);
  const tuning = useRef(0);

  const log = (step: string, data: object) => console.log("[studio]", JSON.stringify({ step, platform: audio?.platform, ...data }));

  // a song arriving from elsewhere (P2: the forged take) wins; until then the Boom Bap demo
  useEffect(() => {
    if (!useSong.getState().song.tracks.length) setSong(boomBapDemo());
  }, [setSong]);

  useEffect(() => {
    let created: AudioEngine | null = null;
    (async () => {
      const a = await createAudioEngine();
      created = a;
      const kit = await loadKit(a);
      console.log("[studio]", JSON.stringify({ step: "kit loaded", platform: a.platform, ...kit }));
      setAudio(a);
      setStatus("");
      if (__DEV__) Object.assign(globalThis, { __gfStudio: { a, masterSong, studioProgram, DEMOS } });
    })().catch((e) => setStatus(`The engine didn't start: ${e}`));
    return () => void created?.close();
  }, []);

  // every song / knob / target change: apply now at the last gain, then re-find the gain (newest change wins)
  useEffect(() => {
    if (!audio || !song.tracks.length) return;
    const id = ++tuning.current;
    (async () => {
      await audio.setSong(song);
      await audio.setProgram(studioProgram(song, knobs, gainDb.current));
      const r = await masterSong(audio, song, knobs, target, liveLoops(song));
      if (id !== tuning.current) return;
      gainDb.current = r.gainDb;
      await audio.setProgram(studioProgram(song, knobs, r.gainDb));
      console.log("[studio]", JSON.stringify({ step: "loudness", mood: song.mood, target, lufs: r2(r.lufs), gainDb: r2(r.gainDb) }));
    })().catch((e) => setStatus(`Mix update failed: ${e}`));
  }, [audio, song, knobs, target]);

  const toggle = async () => {
    if (!audio) return;
    if (playing) await audio.stop();
    else await audio.start();
    setPlaying(!playing);
  };

  const exportWav = async () => {
    if (!audio || busy) return;
    setBusy("export");
    try {
      const r = await masterSong(audio, song, knobs, target, exportLoops(song));
      const name = `grooveforge-${song.mood}-${target}.wav`;
      await saveWav(encodeWav(r.channels, audio.sampleRate, "24"), name);
      log("export", { name, lufs: r2(r.lufs), truePeakDb: r2(r.truePeakDb), ok: r.ok });
    } catch (e) {
      setStatus(`Export failed: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  /** Measures the round trip with clicks (plain sine program, no mix), then puts the song and mix back. */
  const runCalibration = async () => {
    if (!audio || busy) return;
    setBusy("calibrate");
    setPlaying(false);
    try {
      await audio.setProgram({ instruments: defaultInstruments() });
      const c = await calibrate(audio);
      if (Number.isFinite(c.rtlMs) && c.reliable) setRtlMs(c.rtlMs);
      else setStatus("Couldn't hear the clicks clearly. Turn the volume up and try again.");
      log("calibrate", { rtlMs: r2(c.rtlMs), repeatabilityMs: r2(c.repeatabilityMs), reliable: c.reliable });
    } catch (e) {
      setStatus(`Calibration failed: ${e}`);
    } finally {
      await audio.setSong(song);
      await audio.setProgram(studioProgram(song, knobs, gainDb.current));
      setBusy(null);
    }
  };

  return {
    audio, status, song, knobs, target, playing, busy,
    setMood: (m: Mood) => setSong(DEMOS[m]()),
    editSong: setSong,
    setKnob: (k: keyof Knobs, v: number) => setKnobs((prev) => ({ ...prev, [k]: v })),
    setTarget, toggle, exportWav, runCalibration,
  };
}
