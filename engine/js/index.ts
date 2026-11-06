import { AudioNode, type BaseAudioContext } from "react-native-audio-api";
import NativeGfEngineModule from "./specs/NativeGfEngineModule";

/** Lock-free engine clock (C++ host object). Safe to capture in a UI-thread worklet: reads are atomic loads. */
export interface GfClock {
  /** Frames processed since play(); ahead of what's audible by the output latency. */
  readonly frame: number;
  readonly loopFrames: number;
  readonly playing: boolean;
}

/** JSI surface of the C++ GfEngineNodeHostObject (engine/rn/GfEngineNode.h). */
export interface GfEngine {
  /** Flat [frame, hz, velocity, durationFrames] rows; refused (false) while playing. */
  setEvents(events: ArrayBuffer, loopFrames: number): boolean;
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
