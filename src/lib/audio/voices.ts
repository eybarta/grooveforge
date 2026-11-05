import { midiToFreq, type Flavor, type Lane } from "./music.ts";

export interface TriggerOpts {
  ctx: BaseAudioContext;
  dest: AudioNode;
  lane: Lane;
  flavor: Flavor;
  time: number;
  velocity: number;
  midi: number;
  noise: AudioBuffer;
  pan: number;
}

interface Fired {
  stop: (when?: number) => void;
}

function curve(amount: number): Float32Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(256 * 4);
  const data = new Float32Array(buffer);
  const norm = Math.tanh(amount) || 1;
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * 2 - 1;
    data[i] = Math.tanh(x * amount) / norm;
  }
  return data;
}

function route(ctx: BaseAudioContext, dest: AudioNode, pan: number): AudioNode {
  if (Math.abs(pan) < 0.04) return dest;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(dest);
  return panner;
}

class Voice {
  private nodes: Array<OscillatorNode | AudioBufferSourceNode> = [];
  private trash: AudioNode[] = [];

  constructor(
    private ctx: BaseAudioContext,
    private out: AudioNode,
  ) {}

  gain(when: number, peak: number, attack: number, dur: number): GainNode {
    const node = this.ctx.createGain();
    node.connect(this.out);
    this.trash.push(node);
    const a = Math.max(0.0015, attack);
    const d = Math.max(a + 0.02, dur);
    const top = Math.max(0.0002, peak);
    node.gain.setValueAtTime(0.0001, when);
    node.gain.exponentialRampToValueAtTime(top, when + a);
    node.gain.exponentialRampToValueAtTime(0.0001, when + d);
    return node;
  }

  osc(
    when: number,
    type: OscillatorType,
    freq: number,
    dur: number,
    glide?: { to: number; seconds: number },
  ): OscillatorNode {
    const node = this.ctx.createOscillator();
    node.type = type;
    const start = Math.max(24, freq);
    node.frequency.setValueAtTime(start, when);
    if (glide) node.frequency.exponentialRampToValueAtTime(Math.max(24, glide.to), when + glide.seconds);
    this.arm(node, when, dur);
    return node;
  }

  noise(when: number, buffer: AudioBuffer, dur: number): AudioBufferSourceNode {
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    this.arm(node, when, dur);
    return node;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const node = this.ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = freq;
    node.Q.value = q;
    this.trash.push(node);
    return node;
  }

  drive(amount: number): WaveShaperNode {
    const node = this.ctx.createWaveShaper();
    node.curve = curve(amount);
    node.oversample = "2x";
    this.trash.push(node);
    return node;
  }

  hold(node: AudioNode) {
    this.trash.push(node);
    return node;
  }

  private arm(node: OscillatorNode | AudioBufferSourceNode, when: number, dur: number) {
    const end = when + Math.max(0.03, dur) + 0.04;
    node.start(when);
    node.stop(end);
    this.nodes.push(node);
    node.onended = () => {
      try {
        node.disconnect();
      } catch {
        /* already torn down */
      }
    };
  }

  done(): Fired {
    const nodes = this.nodes;
    const trash = this.trash;
    return {
      stop(when?: number) {
        for (const node of nodes) {
          try {
            node.stop(when);
          } catch {
            /* already scheduled or ended */
          }
        }
        if (when == null) {
          for (const node of trash) {
            try {
              node.disconnect();
            } catch {
              /* already disconnected */
            }
          }
        }
      },
    };
  }
}

function kick(opts: TriggerOpts, out: AudioNode): Fired {
  const { ctx, flavor, time, velocity, midi, noise } = opts;
  const voice = new Voice(ctx, out);
  const tuned = flavor === "trap";
  const endF = tuned ? Math.max(36, midiToFreq(midi)) : flavor === "house" ? 58 : flavor === "afro" ? 64 : flavor === "bap" ? 52 : 54;
  const startF = tuned ? endF * 3.6 : flavor === "bap" ? 130 : flavor === "afro" ? 150 : 190;
  const dur = tuned ? 0.62 + velocity * 0.4 : flavor === "house" ? 0.24 : flavor === "afro" ? 0.28 : flavor === "bap" ? 0.16 : 0.15;
  const body = voice.osc(time, "sine", startF, dur, { to: endF, seconds: tuned ? 0.085 : 0.04 });
  const amp = voice.gain(time, (tuned ? 0.72 : 0.86) * velocity, 0.003, dur);
  if (tuned || flavor === "bap") {
    const shaper = voice.drive(tuned ? 3.4 : 1.8);
    body.connect(shaper);
    shaper.connect(amp);
  } else {
    body.connect(amp);
  }
  const click = voice.noise(time, noise, 0.03);
  const hp = voice.filter("highpass", flavor === "bap" ? 900 : 1600, 0.6);
  const clickAmp = voice.gain(time, (flavor === "afro" ? 0.08 : 0.2) * velocity, 0.001, flavor === "trap" ? 0.02 : 0.012);
  click.connect(hp);
  hp.connect(clickAmp);
  return voice.done();
}

function snare(opts: TriggerOpts, out: AudioNode): Fired {
  const { ctx, flavor, time, velocity, noise } = opts;
  const voice = new Voice(ctx, out);
  const dur = flavor === "house" ? 0.24 : flavor === "bap" ? 0.22 : flavor === "funk" ? 0.16 : 0.15;
  const toneF = flavor === "afro" ? 246 : flavor === "bap" ? 174 : flavor === "house" ? 210 : 196;
  const tone = voice.osc(time, "triangle", toneF, dur * 0.7, { to: toneF * 0.72, seconds: 0.08 });
  const toneAmp = voice.gain(time, 0.28 * velocity, 0.002, dur * 0.55);
  tone.connect(toneAmp);

  const bursts = flavor === "house" ? [0, 0.011, 0.023] : [0];
  const band = flavor === "bap" ? 1200 : flavor === "afro" ? 2400 : flavor === "funk" ? 2100 : 1800;
  for (const offset of bursts) {
    const src = voice.noise(time + offset, noise, dur);
    const bp = voice.filter("bandpass", band, flavor === "house" ? 0.7 : 0.85);
    const amp = voice.gain(time + offset, (flavor === "house" ? 0.32 : 0.46) * velocity, 0.002, dur);
    src.connect(bp);
    bp.connect(amp);
  }
  return voice.done();
}

function hat(opts: TriggerOpts, out: AudioNode): Fired {
  const { ctx, flavor, time, velocity, noise } = opts;
  const open = velocity > 0.82;
  const dur = open ? 0.16 : flavor === "afro" ? 0.07 : flavor === "bap" ? 0.05 : 0.038;
  const voice = new Voice(ctx, out);
  const metallic = flavor === "trap" || flavor === "house";
  if (metallic) {
    const mix = voice.hold(ctx.createGain());
    if (mix instanceof GainNode) mix.gain.value = 1;
    const partials = [1, 1.47, 1.83, 2.24, 2.71, 3.18];
    const base = flavor === "house" ? 1640 : 1880;
    for (const partial of partials) {
      const osc = voice.osc(time, "square", base * partial, dur);
      const trim = voice.hold(ctx.createGain());
      if (trim instanceof GainNode) trim.gain.value = 0.16;
      osc.connect(trim);
      trim.connect(mix);
    }
    const bp = voice.filter("bandpass", 8200, 0.65);
    const amp = voice.gain(time, 0.22 * velocity, 0.0015, dur);
    mix.connect(bp);
    bp.connect(amp);
  } else {
    const src = voice.noise(time, noise, dur + 0.02);
    const hp = voice.filter("highpass", flavor === "afro" ? 4200 : flavor === "bap" ? 5000 : 6500, 0.7);
    const amp = voice.gain(time, (flavor === "afro" ? 0.28 : 0.2) * velocity, 0.0015, dur);
    src.connect(hp);
    hp.connect(amp);
  }
  return voice.done();
}

function perc(opts: TriggerOpts, out: AudioNode): Fired {
  const { ctx, flavor, time, velocity, noise } = opts;
  const voice = new Voice(ctx, out);
  if (flavor === "afro") {
    const osc = voice.osc(time, "sine", 240, 0.28, { to: 118, seconds: 0.12 });
    const amp = voice.gain(time, 0.46 * velocity, 0.003, 0.26);
    osc.connect(amp);
    return voice.done();
  }
  if (flavor === "house" || flavor === "funk" || flavor === "trap") {
    const osc = voice.osc(time, "square", flavor === "house" ? 1480 : 980, 0.045);
    const bp = voice.filter("bandpass", flavor === "house" ? 1800 : 1200, 2.5);
    const amp = voice.gain(time, 0.16 * velocity, 0.001, 0.04);
    osc.connect(bp);
    bp.connect(amp);
    const tick = voice.noise(time, noise, 0.03);
    const hp = voice.filter("highpass", 2500, 0.5);
    const tickAmp = voice.gain(time, 0.1 * velocity, 0.001, 0.02);
    tick.connect(hp);
    hp.connect(tickAmp);
    return voice.done();
  }
  const osc = voice.osc(time, "triangle", 210, 0.12, { to: 140, seconds: 0.08 });
  const amp = voice.gain(time, 0.36 * velocity, 0.003, 0.11);
  osc.connect(amp);
  return voice.done();
}

function bass(opts: TriggerOpts, out: AudioNode): Fired {
  const { ctx, flavor, time, velocity, midi, noise } = opts;
  const freq = Math.max(28, midiToFreq(midi));
  const voice = new Voice(ctx, out);
  if (flavor === "trap") {
    const osc = voice.osc(time, "sine", freq * 1.8, 0.7, { to: freq, seconds: 0.07 });
    const shaper = voice.drive(2.6);
    const amp = voice.gain(time, 0.62 * velocity, 0.004, 0.62);
    osc.connect(shaper);
    shaper.connect(amp);
    return voice.done();
  }
  if (flavor === "house") {
    const sub = voice.osc(time, "sine", freq, 0.22);
    const amp = voice.gain(time, 0.5 * velocity, 0.004, 0.2);
    sub.connect(amp);
    const grit = voice.osc(time, "triangle", freq * 2, 0.12);
    const gritAmp = voice.gain(time, 0.08 * velocity, 0.002, 0.08);
    grit.connect(gritAmp);
    return voice.done();
  }
  if (flavor === "funk") {
    const saw = voice.osc(time, "sawtooth", freq, 0.2);
    const filter = voice.filter("lowpass", Math.min(1600, freq * 7), 7);
    filter.frequency.setValueAtTime(Math.min(1800, freq * 9), time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(160, freq * 1.8), time + 0.13);
    const amp = voice.gain(time, 0.2 * velocity, 0.004, 0.18);
    saw.connect(filter);
    filter.connect(amp);
    const sub = voice.osc(time, "sine", freq / 2, 0.2);
    const subAmp = voice.gain(time, 0.36 * velocity, 0.005, 0.18);
    sub.connect(subAmp);
    const pick = voice.noise(time, noise, 0.03);
    const hp = voice.filter("highpass", 1200, 0.5);
    const pickAmp = voice.gain(time, 0.08 * velocity, 0.001, 0.018);
    pick.connect(hp);
    hp.connect(pickAmp);
    return voice.done();
  }
  if (flavor === "afro") {
    const osc = voice.osc(time, "triangle", freq, 0.28);
    const filter = voice.filter("lowpass", 480, 0.8);
    const amp = voice.gain(time, 0.42 * velocity, 0.006, 0.26);
    osc.connect(filter);
    filter.connect(amp);
    return voice.done();
  }
  const osc = voice.osc(time, "sine", freq, 0.2, { to: freq * 0.96, seconds: 0.12 });
  const amp = voice.gain(time, 0.48 * velocity, 0.004, 0.16);
  osc.connect(amp);
  const click = voice.noise(time, noise, 0.02);
  const hp = voice.filter("bandpass", 900, 1.2);
  const clickAmp = voice.gain(time, 0.07 * velocity, 0.001, 0.016);
  click.connect(hp);
  hp.connect(clickAmp);
  return voice.done();
}

export function triggerHit(opts: TriggerOpts): Fired {
  const out = route(opts.ctx, opts.dest, opts.pan);
  if (opts.lane === "kick") return kick(opts, out);
  if (opts.lane === "snare") return snare(opts, out);
  if (opts.lane === "hat") return hat(opts, out);
  if (opts.lane === "perc") return perc(opts, out);
  return bass(opts, out);
}
