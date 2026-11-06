import { files } from "../../assets/kits/hiphop";
import { KIT_FILES } from "./kit";
import type { AudioEngine } from "./types";

/** Decodes every kit sample once and loads it into its engine slot (both moods, so mood switches are instant). */
export async function loadKit(engine: AudioEngine): Promise<{ files: number; ms: number }> {
  const t0 = Date.now();
  const decoded = await Promise.all(KIT_FILES.map((name) => engine.decode(files[name]!)));
  for (const [slot, sample] of decoded.entries()) await engine.loadSample(slot, sample);
  return { files: decoded.length, ms: Date.now() - t0 };
}
