import { songToEngineEvents } from "@/song/time";
import type { Song } from "@/song/types";
import { CAPTURE_SECONDS, SAMPLE_RATE, type AudioClock, type SpikeAudio } from "./types";

type Msg = { type: string; [k: string]: unknown };

/** One gf-engine AudioWorkletNode with a request/reply wrapper around its port. */
async function engineNode(ctx: BaseAudioContext, wasmBytes: ArrayBuffer, onStart?: (startFrame: number) => void) {
  await ctx.audioWorklet.addModule("/gf-engine-worklet.js");
  const node = new AudioWorkletNode(ctx, "gf-engine", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
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
  const load = async (song: Song) => {
    const { events, loopFrames } = songToEngineEvents(song, ctx.sampleRate);
    const r = await call({ type: "events", events, loopFrames });
    if (!r.ok) throw new Error("engine refused events (still playing?)");
    return loopFrames;
  };
  return { node, call, load };
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

export async function createSpikeAudio(): Promise<SpikeAudio> {
  const wasmBytes = await (await fetch("/gf-engine.wasm")).arrayBuffer();
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  const { clock, state: clockState } = webClock(ctx);
  const engine = await engineNode(ctx, wasmBytes.slice(0), (startFrame) => {
    clockState.startFrame = startFrame;
    clockState.playing = true;
  });
  engine.node.connect(ctx.destination);
  let mic: MediaStream | null = null;
  let playback: ReturnType<typeof ctx.createBufferSource> | null = null; // Stop also cuts take playback

  return {
    platform: `web (${navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? "browser"})`,
    sampleRate: ctx.sampleRate,
    clock,
    setSong: async (song) => void (clockState.loopFrames = await engine.load(song)),
    async start() {
      if (!mic) {
        // CLAUDE.md: mic capture with echo cancellation, noise suppression and auto gain OFF
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        });
        ctx.createMediaStreamSource(mic).connect(engine.node);
      }
      await ctx.resume();
      await engine.call({ type: "play" });
    },
    async stop() {
      playback?.stop();
      playback = null;
      clockState.playing = false;
      await engine.call({ type: "stop" });
    },
    setDrive: (amount) => void engine.call({ type: "drive", amount }),
    captureStart: () => void engine.call({ type: "captureStart" }),
    captureStop: async () => {
      const r = await engine.call({ type: "captureStop" });
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
      const probe = songToEngineEvents(song, SAMPLE_RATE);
      const off = new OfflineAudioContext(1, probe.loopFrames, SAMPLE_RATE);
      const e = await engineNode(off, wasmBytes.slice(0));
      e.node.connect(off.destination);
      await e.load(song);
      await e.call({ type: "drive", amount: drive });
      await e.call({ type: "play" }); // replies arrive in order, so the engine is ready before rendering starts
      return (await off.startRendering()).getChannelData(0);
    },
    async close() {
      mic?.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}
