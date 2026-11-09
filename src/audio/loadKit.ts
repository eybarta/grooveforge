import { files } from "../../assets/kits/hiphop";
import { KIT_FILES } from "./kit";
import type { AudioEngine } from "./types";

const loading = new WeakMap<AudioEngine, Promise<{ files: number; ms: number }>>();

/**
 * loadKit, once per engine: the app starts it as soon as the engine exists, so a take's song is playable as soon as it's
 * heard (loading it after Stop made record → ready 4.7 s on the iPhone); the Studio waits for the same load.
 */
export function loadKitOnce(engine: AudioEngine) {
  let p = loading.get(engine);
  if (!p) {
    p = loadKit(engine);
    loading.set(engine, p);
    p.catch(() => loading.delete(engine)); // a failed load is tried again next time
  }
  return p;
}

/** Decodes every kit sample once and loads it into its engine slot (both moods, so mood switches are instant). */
export async function loadKit(engine: AudioEngine): Promise<{ files: number; ms: number }> {
  const t0 = Date.now();
  const decoded = await Promise.all(KIT_FILES.map((name) => engine.decode(files[name]!)));
  for (const [slot, sample] of decoded.entries()) await engine.loadSample(slot, sample);
  return { files: decoded.length, ms: Date.now() - t0 };
}
