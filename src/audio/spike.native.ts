import { GfEngineNode } from "gf-engine";
import { Platform } from "react-native";
import { AudioContext, AudioManager, AudioRecorder, OfflineAudioContext } from "react-native-audio-api";
import { defaultInstruments, songToEngineEvents } from "@/song/time";
import type { Song } from "@/song/types";
import { CAPTURE_SECONDS, SAMPLE_RATE, type SpikeAudio } from "./types";

function load(node: GfEngineNode, song: Song, sampleRate: number) {
  const { events, loopFrames } = songToEngineEvents(song, sampleRate);
  node.engine.setInstruments(defaultInstruments().buffer as ArrayBuffer);
  node.engine.setEvents(events.buffer as ArrayBuffer, loopFrames);
  return loopFrames;
}

export async function createSpikeAudio(): Promise<SpikeAudio> {
  // measurement mode = no iOS voice processing on the route; A2DP keeps Bluetooth output on the built-in mic
  AudioManager.setSystemOptions({
    ios: { category: "playAndRecord", mode: "measurement", options: ["allowBluetoothA2DP", "defaultToSpeaker"] },
  });
  if ((await AudioManager.requestRecordingPermissions()) !== "Granted") throw new Error("microphone permission denied");
  await AudioManager.setAudioSessionActivity(true);

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const node = new GfEngineNode(ctx, CAPTURE_SECONDS);
  node.connect(ctx.destination);
  // CLAUDE.md: mic processing off (no AEC / NS / AGC)
  const recorder = new AudioRecorder({ androidInputPreset: "unprocessed", iosVoiceProcessing: false });
  recorder.connect(ctx, node);
  let playback: ReturnType<typeof ctx.createBufferSource> | null = null; // Stop also cuts take playback

  return {
    platform: `${Platform.OS} ${Platform.Version} (react-native-audio-api 1.0.0)`,
    sampleRate: ctx.sampleRate,
    clock: node.engine.clock(),
    setSong: async (song) => void load(node, song, ctx.sampleRate),
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
    async route() {
      const d = await AudioManager.getDevicesInfo();
      const names = (list: { name: string; category: string }[]) => list.map((x) => `${x.name} (${x.category})`);
      return { inputs: names(d.currentInputs), outputs: names(d.currentOutputs) };
    },
    playBuffer(samples) {
      const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start();
      playback = src;
    },
    async renderOffline(song, drive) {
      const { loopFrames } = songToEngineEvents(song, SAMPLE_RATE);
      const off = new OfflineAudioContext({ numberOfChannels: 2, length: loopFrames, sampleRate: SAMPLE_RATE });
      const n = new GfEngineNode(off, 1);
      n.connect(off.destination);
      load(n, song, SAMPLE_RATE);
      n.engine.setDrive(drive);
      n.engine.play();
      return (await off.startRendering()).getChannelData(0);
    },
    async close() {
      await recorder.stop();
      await ctx.close();
      await AudioManager.setAudioSessionActivity(false);
    },
  };
}
