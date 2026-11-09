import { fromEngine } from "@/analysis/analyze";
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
  const state = { startFrame: 0, loopFrames: 0, playing: false, meter: null as AnalyserNode | null };
  const window = new Float32Array(1024); // ~21 ms: the peak over it stands in for the native 50 ms meter
  const clock: AudioClock = {
    get frame() {
      if (!state.playing) return 0;
      const ts = ctx.getOutputTimestamp();
      const audible = (ts.contextTime ?? ctx.currentTime) + (performance.now() - (ts.performanceTime ?? performance.now())) / 1000;
      return (audible + ctx.baseLatency + (ctx.outputLatency ?? 0)) * ctx.sampleRate - state.startFrame;
    },
    get loopFrames() { return state.loopFrames; },
    get playing() { return state.playing; },
    // the worklet has no shared memory with this thread, so the level comes from an AnalyserNode on the mic
    get inputLevel() {
      if (!state.meter) return 0;
      state.meter.getFloatTimeDomainData(window);
      let peak = 0;
      for (let i = 0; i < window.length; i++) peak = Math.max(peak, Math.abs(window[i]!));
      return peak;
    },
  };
  return { clock, state };
}

interface WasmTools {
  memory: WebAssembly.Memory;
  gf_alloc(floats: number): number;
  gf_free(ptr: number): void;
  gf_loudness(l: number, r: number, frames: number, sampleRate: number, out: number): void;
}

/** The same gf-engine.wasm the worklet runs, instantiated on the main thread for its stateless tools (loudness). */
async function wasmTools(bytes: ArrayBuffer): Promise<WasmTools> {
  // as in the worklet: the few WASI imports are only reached on abort paths
  const imports = new Proxy({}, { get: () => new Proxy({}, { get: () => () => 0 }) }) as WebAssembly.Imports;
  const { instance } = await WebAssembly.instantiate(bytes.slice(0), imports);
  (instance.exports._initialize as (() => void) | undefined)?.();
  return instance.exports as unknown as WasmTools;
}

/** One analysis worker for the page (public/gf-analysis-worker.js), started on first use. */
type Analysed = { rows: Float32Array; f0: Float32Array; beats: number[]; bpm: number };
let worker: { run: (take: Float32Array, reference: Float32Array | undefined, beatCentreBpm: number) => Promise<Analysed> } | null = null;
function analysis() {
  if (worker) return worker;
  const w = new Worker("/gf-analysis-worker.js");
  const pending = new Map<number, { ok: (r: Analysed) => void; fail: (e: Error) => void }>();
  let next = 0;
  w.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) p?.fail(new Error(data.error));
    else p?.ok(data);
  };
  worker = {
    run: (take, reference, beatCentreBpm) => new Promise((ok, fail) => {
      const id = next++;
      pending.set(id, { ok, fail });
      w.postMessage({ id, take, reference, sampleRate: SAMPLE_RATE, beatCentreBpm }, [take.buffer, ...(reference ? [reference.buffer] : [])]);
    }),
  };
  return worker;
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
  let tools: Promise<WasmTools> | null = null; // a main-thread instance of the engine's WASM, for measuring
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
        const source = ctx.createMediaStreamSource(mic);
        source.connect(live.node);
        clockState.meter = Object.assign(ctx.createAnalyser(), { fftSize: 1024 });
        source.connect(clockState.meter);
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
    setSessionMode: () => {}, // browsers expose no session mode
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
    async route() {
      // Chrome lists outputs (labels once the mic is allowed) with "default" = what's playing; Safari lists none
      const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? [];
      const out = devices.filter((d) => d.kind === "audiooutput" && d.deviceId === "default" && d.label).map((d) => d.label.replace(/^Default - /, ""));
      return { inputs: mic ? mic.getAudioTracks().map((t) => t.label) : [], outputs: out };
    },
    onRouteChange(cb) {
      navigator.mediaDevices?.addEventListener("devicechange", cb);
      return () => navigator.mediaDevices?.removeEventListener("devicechange", cb);
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
      const off = new OfflineAudioContext(2, length, SAMPLE_RATE);
      const e = await engineNode(off, wasmBytes.slice(0));
      e.node.connect(off.destination);
      for (const [slot, s] of samples) await e.loadSample(slot, s);
      await e.setProgram(override ?? program);
      await e.setSong(song);
      await e.call({ type: "drive", amount: drive });
      await e.call({ type: "play" }); // replies arrive in order, so the engine is ready before rendering starts
      const out = await off.startRendering();
      return [out.getChannelData(0), out.getChannelData(1)];
    },
    async analyze(take, reference, beatCentreBpm = 0) {
      const ref = reference && reference.length >= take.length ? reference.slice(0, take.length) : undefined;
      const { rows, f0, beats, bpm } = await analysis().run(take.slice(), ref, beatCentreBpm);
      return fromEngine(rows, f0, SAMPLE_RATE, beats, bpm);
    },
    async loudness([l, r = l]) {
      tools ??= wasmTools(wasmBytes);
      const ex = await tools;
      const n = l!.length;
      const pl = ex.gf_alloc(n), pr = ex.gf_alloc(n), po = ex.gf_alloc(2);
      const heap = (p: number, len: number) => new Float32Array(ex.memory.buffer, p, len); // after every alloc: memory may grow
      heap(pl, n).set(l!);
      heap(pr, n).set(r!);
      ex.gf_loudness(pl, pr, n, SAMPLE_RATE, po);
      const [lufs, truePeakDb] = heap(po, 2);
      for (const p of [pl, pr, po]) ex.gf_free(p);
      return { lufs: lufs!, truePeakDb: truePeakDb! };
    },
    async close() {
      mic?.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}
