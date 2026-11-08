import { AudioNode, type BaseAudioContext } from "react-native-audio-api";
import NativeGfEngineModule from "./specs/NativeGfEngineModule";

/** Lock-free engine clock (C++ host object). Safe to capture in a UI-thread worklet: reads are atomic loads. */
export interface GfClock {
  /** Frames processed since play(); ahead of what's audible by the output latency. */
  readonly frame: number;
  readonly loopFrames: number;
  readonly playing: boolean;
  /** Mic peak meter 0–1 (instant attack, 50 ms release). */
  readonly inputLevel: number;
}

/** JSI surface of the C++ GfEngineNodeHostObject (engine/rn/GfEngineNode.h). */
export interface GfEngine {
  /** Flat [frame, instrument, velocity, note, durationFrames, glideNote] rows. Safe while playing (lock-free swap). */
  setEvents(events: ArrayBuffer, loopFrames: number): void;
  /** Flat [kind, chokeGroup, gain, pan, p1..p4] rows, indexed by the events' instrument field. */
  setInstruments(instruments: ArrayBuffer): void;
  /** Flat [instrument, maxVelocity, sampleSlot] rows: velocity layers + round-robins of sampled instruments. */
  setZones(zones: ArrayBuffer): void;
  /** Bus values, then one channel-strip row per instrument (src/audio/mix.ts). Empty = transparent. */
  setMix(mix: ArrayBuffer): void;
  /** EBU R128 integrated loudness + true peak of a stereo render at the engine's rate. */
  loudness(left: ArrayBuffer, right: ArrayBuffer): { lufs: number; truePeakDb: number };
  /** Take analysis (engine/src/Analysis.cpp): onset rows [time s, strength, 18 features], flattened; f0 = Float32 Hz per 512 samples. */
  analyze(take: ArrayBuffer, reference: ArrayBuffer | null): { onsets: number[]; f0: ArrayBuffer };
  /** Copies decoded audio into a write-once slot. Returns false if the slot is taken or invalid. */
  loadSample(slot: number, left: ArrayBuffer, right: ArrayBuffer | null, sampleRate: number): boolean;
  play(): void;
  stop(): void;
  setDrive(amount: number): void;
  clock(): GfClock;
  captureStart(): void;
  captureStop(): { input: ArrayBuffer; output: ArrayBuffer };
}

declare global {
  var __gfCreateEngineNode: ((context: unknown, captureSeconds: number) => GfEngine) | undefined;
}

type NativeNode = ConstructorParameters<typeof AudioNode>[1];

/** The C++ engine as a react-native-audio-api node: connect mic → node → destination, like any other node. */
export class GfEngineNode extends AudioNode {
  readonly engine: GfEngine;

  constructor(context: BaseAudioContext, captureSeconds: number) {
    if (!globalThis.__gfCreateEngineNode) NativeGfEngineModule.install();
    const native = globalThis.__gfCreateEngineNode!(context.context, captureSeconds);
    super(context, native as unknown as NativeNode);
    this.engine = native;
  }
}
