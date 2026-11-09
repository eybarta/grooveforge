import { GfEngineNode } from "gf-engine";
import { fromEngine } from "@/analysis/analyze";
import { Platform } from "react-native";
import { AudioContext, AudioManager, AudioRecorder, decodeAudioData, OfflineAudioContext } from "react-native-audio-api";
import { defaultInstruments, songToEngineEvents } from "@/song/time";
import type { Song } from "@/song/types";
import { CAPTURE_SECONDS, SAMPLE_RATE, type AudioEngine, type DecodedSample, type EngineProgram, type SessionMode } from "./types";

const ab = (x: Float32Array) => x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer;

function setProgram(node: GfEngineNode, p: EngineProgram) {
  node.engine.setInstruments(ab(p.instruments));
  if (p.zones) node.engine.setZones(ab(p.zones));
  node.engine.setMix(ab(p.mix ?? new Float32Array(0)));
}

function setSong(node: GfEngineNode, song: Song, sampleRate: number) {
  const { events, loopFrames } = songToEngineEvents(song, sampleRate);
  node.engine.setEvents(ab(events), loopFrames);
}

const loadSample = (node: GfEngineNode, slot: number, s: DecodedSample) =>
  node.engine.loadSample(slot, ab(s.l), s.r === s.l ? null : ab(s.r), s.sampleRate);

/** A2DP keeps Bluetooth output on the built-in mic; audio-api applies a change at once if the session is active. */
function setSessionMode(mode: SessionMode) {
  AudioManager.setSystemOptions({ ios: { category: "playAndRecord", mode, options: ["allowBluetoothA2DP", "defaultToSpeaker"] } });
}

export async function createAudioEngine(): Promise<AudioEngine> {
  // measurement mode = no iOS processing on the mic (CLAUDE.md); the Studio may switch to default while only playing
  setSessionMode("measurement");
  if ((await AudioManager.requestRecordingPermissions()) !== "Granted") throw new Error("microphone permission denied");
  await AudioManager.setAudioSessionActivity(true);

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const node = new GfEngineNode(ctx, CAPTURE_SECONDS);
  node.connect(ctx.destination);
  // CLAUDE.md: mic processing off (no AEC / NS / AGC)
  const recorder = new AudioRecorder({ androidInputPreset: "unprocessed", iosVoiceProcessing: false });
  recorder.connect(ctx, node);
  // remembered so offline renders get exactly the same kit and program
  let program: EngineProgram = { instruments: defaultInstruments() };
  const samples = new Map<number, DecodedSample>();
  setProgram(node, program);
  let playback: ReturnType<typeof ctx.createBufferSource> | null = null; // Stop also cuts take playback

  return {
    platform: `${Platform.OS} ${Platform.Version} (react-native-audio-api 1.0.0)`,
    sampleRate: ctx.sampleRate,
    clock: node.engine.clock(),
    setSong: async (song) => setSong(node, song, ctx.sampleRate),
    async setProgram(p) {
      program = p;
      setProgram(node, p);
    },
    async decode(file) {
      // a bundled asset module id is resolved by audio-api itself (Metro URL in dev, the app bundle in release)
      const buffer = await decodeAudioData(file as number, SAMPLE_RATE);
      const l = buffer.getChannelData(0).slice();
      return { l, r: buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : l, sampleRate: buffer.sampleRate };
    },
    async loadSample(slot, s) {
      samples.set(slot, s);
      return loadSample(node, slot, s);
    },
    async start() {
      if (!recorder.isRecording()) {
        const r = await recorder.start();
        if (r.status === "error") throw new Error(`recorder: ${r.message}`);
      }
      if (ctx.state === "suspended") await ctx.resume();
      node.engine.play();
    },
    async stop() {
      playback?.stop();
      playback = null;
      node.engine.stop();
    },
    setDrive: (amount) => node.engine.setDrive(amount),
    setSessionMode,
    captureStart: () => node.engine.captureStart(),
    captureStop: async () => {
      const { input, output } = node.engine.captureStop();
      return { input: new Float32Array(input), output: new Float32Array(output) };
    },
    reportedLatency: () => ({
      outputLatency: ctx.outputLatency,
      baseLatency: ctx.baseLatency,
      inputLatency: recorder.inputLatency,
    }),
    onRouteChange(cb) {
      const sub = AudioManager.addSystemEventListener("routeChange", () => cb());
      return () => sub?.remove();
    },
    async route() {
      const d = await AudioManager.getDevicesInfo();
      const names = (list: { name: string; category: string }[]) => list.map((x) => `${x.name} (${x.category})`);
      return { inputs: names(d.currentInputs), outputs: names(d.currentOutputs) };
    },
    playBuffer(channels, loop = false) {
      const b = ctx.createBuffer(channels.length, channels[0]!.length, ctx.sampleRate);
      channels.forEach((c, i) => b.getChannelData(i).set(c));
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = loop;
      src.connect(ctx.destination);
      src.start();
      playback = src;
    },
    async renderOffline(song, drive, frames, override) {
      const length = frames ?? songToEngineEvents(song, SAMPLE_RATE).loopFrames;
      const off = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: SAMPLE_RATE });
      const n = new GfEngineNode(off, 1);
      n.connect(off.destination);
      for (const [slot, s] of samples) loadSample(n, slot, s);
      setProgram(n, override ?? program);
      setSong(n, song, SAMPLE_RATE);
      n.engine.setDrive(drive);
      n.engine.play();
      const out = await off.startRendering();
      return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
    },
    loudness: async ([l, r = l]) => node.engine.loudness(ab(l!), ab(r!)),
    analyze: async (take, reference, beatCentreBpm) => {
      const { onsets, f0, beats, bpm } = node.engine.analyze(ab(take), reference ? ab(reference) : null, beatCentreBpm ?? 0);
      return fromEngine(onsets, new Float32Array(f0), ctx.sampleRate, beats, bpm);
    },
    async close() {
      await recorder.stop();
      await ctx.close();
      await AudioManager.setAudioSessionActivity(false);
    },
  };
}
