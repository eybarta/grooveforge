import * as wavefileNs from "wavefile";

// wavefile ships UMD flagged __esModule: Node ESM only sees `default`, Babel/Metro only the named export.
const { WaveFile } = ((wavefileNs as { default?: typeof wavefileNs }).default ?? wavefileNs) as typeof wavefileNs;

/** Float samples (mono, or one array per channel) → WAV bytes (24-bit PCM by default). */
export function encodeWav(samples: Float32Array | Float32Array[], sampleRate: number, bitDepth: "16" | "24" = "24"): Uint8Array {
  // Quantise here, not with wavefile's toBitDepth(): wavefile 11.0.0 does parseInt(x * max), which turns tiny
  // values like 9e-9 ("9e-9") into 9 LSB of noise in every fade-out.
  const max = bitDepth === "24" ? 0x7fffff : 0x7fff;
  const channels = Array.isArray(samples) ? samples : [samples];
  const ints = channels.map((c) => Int32Array.from(c, (x) => Math.round(Math.max(-1, Math.min(1, x)) * max)));
  const wav = new WaveFile();
  wav.fromScratch(channels.length, sampleRate, bitDepth, ints.length === 1 ? ints[0]! : ints);
  return wav.toBuffer();
}

/** WAV bytes → floats in [-1, 1]: every channel, and the first one as `samples`. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; channels: Float32Array[]; sampleRate: number } {
  const wav = new WaveFile(bytes);
  wav.toBitDepth("32f");
  const raw = wav.getSamples(false, Float32Array) as unknown as Float32Array | Float32Array[];
  const fmt = wav.fmt as { sampleRate: number; numChannels: number };
  const channels = Array.isArray(raw) ? raw : [raw];
  return { samples: channels[0]!, channels, sampleRate: fmt.sampleRate };
}

/** Cheap fingerprint to compare a render against the C++ host render (engine_test prints the same figures). */
export function fingerprint(x: Float32Array) {
  let sumAbs = 0, peak = 0;
  for (const v of x) {
    const a = Math.abs(v);
    sumAbs += a;
    if (a > peak) peak = a;
  }
  return { frames: x.length, meanAbs: x.length ? sumAbs / x.length : 0, peak };
}
