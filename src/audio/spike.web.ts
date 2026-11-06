import { songToEngineEvents } from "@/song/time";
import type { Song } from "@/song/types";
import { CAPTURE_SECONDS, SAMPLE_RATE, type SpikeAudio } from "./types";

type Msg = { type: string; [k: string]: unknown };

/** One gf-engine AudioWorkletNode with a request/reply wrapper around its port. */
async function engineNode(ctx: BaseAudioContext, wasmBytes: ArrayBuffer) {
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

export async function createSpikeAudio(): Promise<SpikeAudio> {
  const wasmBytes = await (await fetch("/gf-engine.wasm")).arrayBuffer();
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  const engine = await engineNode(ctx, wasmBytes.slice(0));
  engine.node.connect(ctx.destination);
  let mic: MediaStream | null = null;

  return {
    platform: `web (${navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? "browser"})`,
    sampleRate: ctx.sampleRate,
    setSong: async (song) => void (await engine.load(song)),
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
    stop: async () => void (await engine.call({ type: "stop" })),
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
    playBuffer(samples) {
      const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start();
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
