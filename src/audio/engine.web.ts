import { Asset } from "expo-asset";
import { defaultInstruments, songToEngineEvents } from "@/song/time";
import type { Song } from "@/song/types";
import { CAPTURE_SECONDS, SAMPLE_RATE, type AudioClock, type AudioEngine, type DecodedSample, type EngineProgram } from "./types";

type Msg = { type: string; [k: string]: unknown };

/** One gf-engine AudioWorkletNode with a request/reply wrapper around its port. */
async function engineNode(ctx: BaseAudioContext, wasmBytes: ArrayBuffer, onStart?: (startFrame: number) => void) {
  await ctx.audioWorklet.addModule("/gf-engine-worklet.js");
  const node = new AudioWorkletNode(ctx, "gf-engine", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { wasmBytes, captureSeconds: CAPTURE_SECONDS },
  });
  let nextId = 0;
  const pending = new Map<number, (data: any) => void>();
  node.port.onmessage = (m) => {
    if (m.data.type === "clock") return onStart?.(m.data.startFrame);
    pending.get(m.data.id)?.(m.data);
    pending.delete(m.data.id);
  };
  const call = (msg: Msg) =>
    new Promise<any>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      node.port.postMessage({ ...msg, id });
    });
  const setProgram = async (p: EngineProgram) => {
    await call({ type: "instruments", instruments: p.instruments });
    if (p.zones) await call({ type: "zones", zones: p.zones });
    await call({ type: "mix", mix: p.mix ?? new Float32Array(0) });
  };
  const loadSample = async (slot: number, s: DecodedSample) =>
    (await call({ type: "sample", slot, l: s.l, r: s.r, sampleRate: s.sampleRate })).ok as boolean;
  const setSong = async (song: Song) => {
    const { events, loopFrames } = songToEngineEvents(song, ctx.sampleRate);
    await call({ type: "events", events, loopFrames });
    return loopFrames;
  };
  return { node, call, setProgram, loadSample, setSong };
}

/**
 * Web clock in the same units as the native one (engine frames since play). The worklet reports the context frame
 * where play began; the audible context time comes from getOutputTimestamp(), interpolated with performance.now()
 * between audio callbacks, plus the browser's reported latency to get back to "processed" frames.
 */
function webClock(ctx: AudioContext) {
  const state = { startFrame: 0, loopFrames: 0, playing: false };
  const clock: AudioClock = {
    get frame() {
      if (!state.playing) return 0;
      const ts = ctx.getOutputTimestamp();
      const audible = (ts.contextTime ?? ctx.currentTime) + (performance.now() - (ts.performanceTime ?? performance.now())) / 1000;
      return (audible + ctx.baseLatency + (ctx.outputLatency ?? 0)) * ctx.sampleRate - state.startFrame;
    },
    get loopFrames() { return state.loopFrames; },
    get playing() { return state.playing; },
  };
  return { clock, state };
}

export async function createAudioEngine(): Promise<AudioEngine> {
  const wasmBytes = await (await fetch("/gf-engine.wasm")).arrayBuffer();
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  const { clock, state: clockState } = webClock(ctx);
  const live = await engineNode(ctx, wasmBytes.slice(0), (startFrame) => {
    clockState.startFrame = startFrame;
    clockState.playing = true;
  });
  live.node.connect(ctx.destination);
  // remembered so offline renders get exactly the same kit and program
  let program: EngineProgram = { instruments: defaultInstruments() };
  const samples = new Map<number, DecodedSample>();
  await live.setProgram(program);
  let mic: MediaStream | null = null;
  let playback: ReturnType<typeof ctx.createBufferSource> | null = null; // Stop also cuts take playback

  return {
    platform: `web (${navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? "browser"})`,
    sampleRate: ctx.sampleRate,
    clock,
    setSong: async (song) => void (clockState.loopFrames = await live.setSong(song)),
    async setProgram(p) {
      program = p;
      await live.setProgram(p);
    },
    async decode(file) {
      const asset = Asset.fromModule(file);
      const buffer = await ctx.decodeAudioData(await (await fetch(asset.uri)).arrayBuffer());
      const l = buffer.getChannelData(0);
      return { l, r: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l, sampleRate: buffer.sampleRate };
    },
    async loadSample(slot, s) {
      samples.set(slot, s);
      return live.loadSample(slot, s);
    },
    async start() {
      if (!mic) {
        // CLAUDE.md: mic capture with echo cancellation, noise suppression and auto gain OFF
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        });
        ctx.createMediaStreamSource(mic).connect(live.node);
      }
      await ctx.resume();
      await live.call({ type: "play" });
    },
    async stop() {
      playback?.stop();
      playback = null;
      clockState.playing = false;
      await live.call({ type: "stop" });
    },
    setDrive: (amount) => void live.call({ type: "drive", amount }),
    captureStart: () => void live.call({ type: "captureStart" }),
    captureStop: async () => {
      const r = await live.call({ type: "captureStop" });
      return { input: r.input as Float32Array, output: r.output as Float32Array };
    },
    reportedLatency() {
      const track = mic?.getAudioTracks()[0];
      const inputLatency = (track?.getSettings() as { latency?: number } | undefined)?.latency;
      return {
        outputLatency: ctx.outputLatency ?? NaN,
        baseLatency: ctx.baseLatency,
        inputLatency: inputLatency ?? NaN,
      };
    },
    route: async () => ({ inputs: mic ? mic.getAudioTracks().map((t) => t.label) : [], outputs: [] }),
    playBuffer(channels) {
      const b = ctx.createBuffer(channels.length, channels[0]!.length, ctx.sampleRate);
      channels.forEach((c, i) => b.getChannelData(i).set(c));
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start();
      playback = src;
    },
    async renderOffline(song, drive, frames) {
      const length = frames ?? songToEngineEvents(song, SAMPLE_RATE).loopFrames;
      const off = new OfflineAudioContext(2, length, SAMPLE_RATE);
      const e = await engineNode(off, wasmBytes.slice(0));
      e.node.connect(off.destination);
      for (const [slot, s] of samples) await e.loadSample(slot, s);
      await e.setProgram(program);
      await e.setSong(song);
      await e.call({ type: "drive", amount: drive });
      await e.call({ type: "play" }); // replies arrive in order, so the engine is ready before rendering starts
      const out = await off.startRendering();
      return [out.getChannelData(0), out.getChannelData(1)];
    },
    async close() {
      mic?.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}
