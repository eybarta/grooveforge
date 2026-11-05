import { degreeToMidi, sliderToGain, type Flavor, type HitEvent, type Lane, type Mix } from "./music.ts";
import { triggerHit } from "./voices.ts";
import { audioBufferToWav, normalizePeak } from "./wav.ts";

const HEADS: Record<Lane | "room", number> = {
  kick: 0.95,
  snare: 0.82,
  hat: 0.4,
  perc: 0.52,
  bass: 0.78,
  room: 0.38,
};

interface Rack {
  ctx: BaseAudioContext;
  buses: Record<Lane, GainNode>;
  room: GainNode;
  pump: GainNode;
  noiseBed: GainNode;
  bedInput: GainNode;
  bed: AudioBufferSourceNode | null;
  shaper: WaveShaperNode;
  makeup: GainNode;
  output: GainNode;
  analyser: AnalyserNode | null;
  noise: AudioBuffer;
  stops: Array<(when?: number) => void>;
}

function tanhCurve(amount: number): Float32Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(512 * 4);
  const data = new Float32Array(buffer);
  const norm = Math.tanh(amount) || 1;
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * 2 - 1;
    data[i] = Math.tanh(x * amount) / norm;
  }
  return data;
}

function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x1234567;
  for (let i = 0; i < len; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  return buffer;
}

function makeRoom(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * 0.4));
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let seed = 0xabcdef + c * 97;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = ((seed / 4294967296) * 2 - 1) * (1 - i / len) ** 3.2;
    }
  }
  return buffer;
}

function buildRack(ctx: BaseAudioContext, analyse: boolean): Rack {
  const sum = ctx.createGain();
  const buses: Record<Lane, GainNode> = {
    kick: ctx.createGain(),
    snare: ctx.createGain(),
    hat: ctx.createGain(),
    perc: ctx.createGain(),
    bass: ctx.createGain(),
  };
  const pump = ctx.createGain();
  pump.gain.value = 1;
  buses.kick.connect(sum);
  buses.snare.connect(sum);
  buses.perc.connect(sum);
  buses.hat.connect(pump);
  buses.bass.connect(pump);
  pump.connect(sum);

  const room = ctx.createGain();
  room.gain.value = 0;
  const convolver = ctx.createConvolver();
  convolver.buffer = makeRoom(ctx);
  buses.snare.connect(room);
  buses.hat.connect(room);
  buses.perc.connect(room);
  room.connect(convolver);
  convolver.connect(sum);

  const noise = makeNoise(ctx, 2);
  const bedInput = ctx.createGain();
  const bedHp = ctx.createBiquadFilter();
  bedHp.type = "highpass";
  bedHp.frequency.value = 1600;
  const bedLp = ctx.createBiquadFilter();
  bedLp.type = "lowpass";
  bedLp.frequency.value = 6800;
  const noiseBed = ctx.createGain();
  noiseBed.gain.value = 0;
  bedInput.connect(bedHp);
  bedHp.connect(bedLp);
  bedLp.connect(noiseBed);
  noiseBed.connect(sum);

  let bed: AudioBufferSourceNode | null = null;
  if (!analyse) bed = spawnBed(ctx, noise, bedInput);

  const shaper = ctx.createWaveShaper();
  shaper.curve = tanhCurve(1.4);
  shaper.oversample = "none";
  const shelf = ctx.createBiquadFilter();
  shelf.type = "lowshelf";
  shelf.frequency.value = 88;
  shelf.gain.value = 2;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 8;
  glue.ratio.value = 3;
  glue.attack.value = 0.01;
  glue.release.value = 0.16;
  const hip = ctx.createBiquadFilter();
  hip.type = "highpass";
  hip.frequency.value = 30;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 1;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.09;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.7;
  const output = ctx.createGain();
  output.gain.value = analyse ? 0 : 1;

  sum.connect(shaper);
  shaper.connect(shelf);
  shelf.connect(glue);
  glue.connect(hip);
  hip.connect(limiter);
  limiter.connect(makeup);
  makeup.connect(output);

  let analyser: AnalyserNode | null = null;
  if (analyse) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    output.connect(analyser);
    analyser.connect(ctx.destination);
  } else {
    output.connect(ctx.destination);
  }

  return {
    ctx,
    buses,
    room,
    pump,
    noiseBed,
    bedInput,
    bed,
    shaper,
    makeup,
    output,
    analyser,
    noise,
    stops: [],
  };
}

function spawnBed(ctx: BaseAudioContext, noise: AudioBuffer, dest: AudioNode): AudioBufferSourceNode {
  const bed = ctx.createBufferSource();
  bed.buffer = noise;
  bed.loop = true;
  bed.connect(dest);
  bed.start(ctx.currentTime);
  return bed;
}

function startBed(rack: Rack) {
  if (rack.bed) return;
  rack.bed = spawnBed(rack.ctx, rack.noise, rack.bedInput);
}

function stopBed(rack: Rack) {
  if (!rack.bed) return;
  try {
    rack.bed.stop();
  } catch {
    /* already stopped */
  }
  try {
    rack.bed.disconnect();
  } catch {
    /* already disconnected */
  }
  rack.bed = null;
}

function driveFor(flavor: Flavor): number {
  if (flavor === "trap") return 2.35;
  if (flavor === "bap") return 1.7;
  return 1.35;
}

export function applyMix(rack: Rack, mix: Mix) {
  const time = rack.ctx.currentTime;
  const set = (node: GainNode, value: number) => {
    node.gain.setTargetAtTime(Math.max(0, value), time, 0.02);
  };
  set(rack.buses.kick, sliderToGain(mix.kick) * HEADS.kick);
  set(rack.buses.snare, sliderToGain(mix.snare) * HEADS.snare);
  set(rack.buses.hat, sliderToGain(mix.hat) * HEADS.hat);
  set(rack.buses.perc, sliderToGain(mix.perc) * HEADS.perc);
  set(rack.buses.bass, sliderToGain(mix.bass) * HEADS.bass);
  set(rack.room, sliderToGain(mix.room) * HEADS.room);
  set(rack.noiseBed, mix.flavor === "bap" ? 0.016 : 0);
  rack.shaper.curve = tanhCurve(driveFor(mix.flavor));
}

function duck(rack: Rack, time: number, depth: number, release: number) {
  const gain = rack.pump.gain;
  const t = Math.max(time, rack.ctx.currentTime);
  gain.cancelScheduledValues(t);
  const current = Math.max(0.2, Math.min(1, gain.value || 1));
  gain.setValueAtTime(current, t);
  gain.linearRampToValueAtTime(Math.max(0.16, 1 - depth), t + 0.016);
  gain.exponentialRampToValueAtTime(1, t + Math.max(0.08, release));
}

export function fireStep(rack: Rack, events: HitEvent[], mix: Mix, time: number, step: number) {
  const when = Math.max(time, rack.ctx.currentTime + 0.001);
  const kick = events.find((event) => event.lane === "kick");
  const bassEvent = events.find((event) => event.lane === "bass");
  let ducked = false;
  for (const event of events) {
    if (mix.flavor === "trap" && event.lane === "bass" && kick) continue;
    const tuned = event.lane === "bass" || (event.lane === "kick" && mix.flavor === "trap");
    const degree = event.lane === "kick" && mix.flavor === "trap" ? (bassEvent?.degree ?? 0) : event.degree;
    const octave = mix.flavor === "trap" || mix.flavor === "house" ? -12 : 0;
    const midi = tuned ? degreeToMidi(mix.root, mix.flavor, degree, octave) : mix.root;
    const pan = event.lane === "hat" ? (step % 2 === 0 ? -0.32 : 0.4) : event.lane === "perc" ? 0.28 : 0;
    const fired = triggerHit({
      ctx: rack.ctx,
      dest: rack.buses[event.lane],
      lane: event.lane,
      flavor: mix.flavor,
      time: when,
      velocity: event.velocity,
      midi,
      noise: rack.noise,
      pan,
    });
    rack.stops.push(fired.stop);
    if (event.lane === "kick" && !ducked) {
      ducked = true;
      const depth = mix.flavor === "house" ? 0.6 : mix.flavor === "trap" ? 0.32 : 0;
      if (depth > 0) duck(rack, when, depth, mix.flavor === "house" ? 0.24 : 0.12);
    }
  }
  if (rack.stops.length > 500) rack.stops.splice(0, 250);
}

export async function renderStudioWav(steps: HitEvent[][], bpm: number, mix: Mix): Promise<Blob> {
  const safeBpm = Math.min(180, Math.max(60, bpm));
  const stepDur = 60 / safeBpm / 4;
  const loopDur = Math.max(stepDur, steps.length * stepDur);
  const loops = Math.max(1, Math.min(4, Math.ceil(8 / loopDur)));
  const total = Math.min(18, loopDur * loops + 0.75);
  const ctx = new OfflineAudioContext(2, Math.ceil(total * 44100), 44100);
  const rack = buildRack(ctx, false);
  applyMix(rack, mix);
  const swingDepth = Math.min(1, Math.max(0, (mix.swing - 0.5) / 0.16));
  for (let loop = 0; loop < loops; loop++) {
    for (let step = 0; step < steps.length; step++) {
      const delay = step % 2 === 1 ? stepDur * 0.33 * swingDepth : 0;
      const when = loop * loopDur + step * stepDur + delay;
      const events = (steps[step] ?? []).map((event) =>
        mix.humanize && step % 16 !== 0
          ? { ...event, velocity: Math.min(1, event.velocity * (0.94 + ((step * 17 + loop * 3) % 7) * 0.01)) }
          : event,
      );
      fireStep(rack, events, mix, when, step);
    }
  }
  const audio = await ctx.startRendering();
  normalizePeak(audio, 0.9);
  return audioBufferToWav(audio);
}

export class StudioEngine {
  private ctx: AudioContext | null = null;
  private rack: Rack | null = null;
  private timer = 0;
  private mode: "idle" | "studio" | "mouth" = "idle";
  private step = 0;
  private next = 0;
  private upcoming: { step: number; time: number }[] = [];
  private mouth: AudioBufferSourceNode | null = null;
  private mouthGain: GainNode | null = null;
  private life = 0;
  private hooked = false;
  private boundVisibility = () => {
    if (document.visibilityState !== "visible") return;
    if (this.mode === "idle" || !this.ctx || this.ctx.state !== "suspended") return;
    void this.ctx.resume();
  };

  unlock(): AudioContext {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("This browser has no audio engine.");
    this.life += 1;
    if (!this.ctx) {
      this.ctx = new Ctx({ latencyHint: "interactive" });
      this.rack = buildRack(this.ctx, true);
      if (!this.hooked) {
        document.addEventListener("visibilitychange", this.boundVisibility);
        this.hooked = true;
      }
    }
    return this.ctx;
  }

  get analyser(): AnalyserNode | null {
    return this.rack?.analyser ?? null;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setMix(mix: Mix) {
    if (!this.rack) return;
    applyMix(this.rack, mix);
  }

  playStudio(getPattern: () => { steps: HitEvent[][]; bpm: number }, getMix: () => Mix) {
    this.stop();
    const ctx = this.engage();
    if (!this.rack) return;
    const mix = getMix();
    applyMix(this.rack, mix);
    this.openOutput(1);
    startBed(this.rack);
    this.mode = "studio";
    this.step = 0;
    this.next = ctx.currentTime + 0.06;
    this.upcoming = [];
    const tick = () => {
      if (this.mode !== "studio" || !this.ctx || !this.rack) return;
      const liveMix = getMix();
      const { steps, bpm } = getPattern();
      const stepDur = 60 / Math.min(180, Math.max(60, bpm)) / 4;
      const swingDepth = Math.min(1, Math.max(0, (liveMix.swing - 0.5) / 0.16));
      const length = Math.max(1, steps.length);
      while (this.next < this.ctx.currentTime + 0.18) {
        const step = this.step % length;
        const delay = step % 2 === 1 ? stepDur * 0.33 * swingDepth : 0;
        const when = this.next + delay;
        const events = steps[step] ?? [];
        const played =
          liveMix.humanize && step % 16 !== 0
            ? events.map((event) => ({
                ...event,
                velocity: Math.min(1, event.velocity * (0.93 + Math.random() * 0.09)),
              }))
            : events;
        const jitter = liveMix.humanize && step % 16 !== 0 ? (Math.random() - 0.5) * 0.006 : 0;
        fireStep(this.rack, played, liveMix, when + jitter, step);
        this.upcoming.push({ step, time: when });
        if (this.upcoming.length > 48) this.upcoming.shift();
        this.step += 1;
        this.next += stepDur;
      }
      this.timer = window.setTimeout(tick, 25);
    };
    tick();
  }

  playMouth(samples: Float32Array, sampleRate: number) {
    this.stop();
    const ctx = this.engage();
    if (!this.rack) return;
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.85;
    src.connect(gain);
    gain.connect(this.rack.analyser ?? this.rack.output);
    src.start();
    this.mouth = src;
    this.mouthGain = gain;
    this.mode = "mouth";
  }

  private engage(): AudioContext {
    this.life += 1;
    const ctx = this.unlock();
    if (ctx.state !== "running") void ctx.resume();
    return ctx;
  }

  private openOutput(value: number) {
    const rack = this.rack;
    const ctx = this.ctx;
    if (!rack || !ctx) return;
    const now = ctx.currentTime;
    rack.output.gain.cancelScheduledValues(now);
    if (value <= 0) {
      rack.output.gain.setValueAtTime(0, now);
      return;
    }
    rack.output.gain.setValueAtTime(rack.output.gain.value, now);
    rack.output.gain.linearRampToValueAtTime(value, now + 0.03);
  }

  stop() {
    const life = ++this.life;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
    const ctx = this.ctx;
    const when = ctx ? ctx.currentTime + 0.02 : undefined;
    if (this.rack) {
      for (const stop of this.rack.stops) stop(when);
      this.rack.stops = [];
      if (ctx) {
        this.rack.pump.gain.cancelScheduledValues(ctx.currentTime);
        this.rack.pump.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
      }
      this.openOutput(0);
      stopBed(this.rack);
    }
    if (this.mouth) {
      try {
        this.mouth.stop(when);
      } catch {
        /* already stopped */
      }
      this.mouth = null;
    }
    if (this.mouthGain) {
      try {
        this.mouthGain.disconnect();
      } catch {
        /* already disconnected */
      }
      this.mouthGain = null;
    }
    this.mode = "idle";
    this.upcoming = [];
    if (ctx) {
      window.setTimeout(() => {
        if (this.life !== life || !this.ctx || this.ctx !== ctx) return;
        this.ctx = null;
        this.rack = null;
        void ctx.close();
      }, 80);
    }
  }

  getAudibleStep(): number | null {
    if (!this.ctx || this.mode !== "studio") return null;
    const time = this.ctx.currentTime + 0.015;
    let step: number | null = null;
    for (const item of this.upcoming) if (item.time <= time) step = item.step;
    return step;
  }
}
