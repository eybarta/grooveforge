import { WaveFile } from "wavefile";

/** Mono float samples → WAV bytes (24-bit PCM by default). */
export function encodeWav(samples: Float32Array, sampleRate: number, bitDepth: "16" | "24" = "24"): Uint8Array {
  // Quantise here, not with wavefile's toBitDepth(): wavefile 11.0.0 does parseInt(x * max), which turns tiny
  // values like 9e-9 ("9e-9") into 9 LSB of noise in every fade-out.
  const max = bitDepth === "24" ? 0x7fffff : 0x7fff;
  const ints = Int32Array.from(samples, (x) => Math.round(Math.max(-1, Math.min(1, x)) * max));
  const wav = new WaveFile();
  wav.fromScratch(1, sampleRate, bitDepth, ints);
  return wav.toBuffer();
}

/** WAV bytes → first channel as floats in [-1, 1]. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const wav = new WaveFile(bytes);
  wav.toBitDepth("32f");
  const raw = wav.getSamples(false, Float32Array) as unknown as Float32Array | Float32Array[];
  const fmt = wav.fmt as { sampleRate: number; numChannels: number };
  return { samples: Array.isArray(raw) ? raw[0]! : raw, sampleRate: fmt.sampleRate };
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
