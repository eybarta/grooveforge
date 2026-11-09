import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { persistStorage } from "@/audio/persist";
import type { DrumLane } from "@/song/types";
import type { DetectedHit } from "./analyze";
import type { Template } from "./classify";

/** The "teach me your kit" order: five of each, one per beat (src/app/teach.tsx; the synthetic teach take matches). */
export const TEACH_CLASSES: readonly DrumLane[] = ["kick", "snare", "hatClosed", "hatOpen", "perc"];
export const TEACH_EACH = 5;
/** At least this many clear examples of a sound to use the kit. */
export const TEACH_MIN = 3;

/** Examples kept per sound from fixes (the newest win): enough for k-NN, small enough to stay quick. */
export const LEARN_MAX = 24;

/**
 * The user's own kit (templates for src/analysis/classify.ts), kept across launches: taught ("teach me your kit"),
 * and learned from every fix in the Studio (one tap relabels a sound: its hits become examples of that lane).
 */
export const useKit = create<{
  templates: Template[] | null; taughtAt: string | null;
  setTemplates: (t: Template[]) => void;
  learn: (cls: DrumLane, features: number[][]) => void;
}>()(
  persist(
    (set) => ({
      templates: null, taughtAt: null,
      setTemplates: (templates) => set({ templates, taughtAt: new Date().toISOString() }),
      learn: (cls, features) => set((s) => {
        const mine = [...(s.templates ?? []).filter((t) => t.cls === cls), ...features.map((f) => ({ cls, f }))].slice(-LEARN_MAX);
        return { templates: [...(s.templates ?? []).filter((t) => t.cls !== cls), ...mine] };
      }),
    }),
    { name: "gf-kit", storage: createJSONStorage(() => persistStorage) },
  ),
);

/**
 * The teach take's hits → templates: beat k (after the count-in) is TEACH_CLASSES[⌊k / TEACH_EACH⌋]; its example is
 * the strongest hit within ±40 % of a beat around it. `firstBeatSec` = where beat 0 is in the take. Returns the
 * templates and, per class, how many examples were heard.
 */
export function templatesFromTeach(hits: DetectedHit[], firstBeatSec: number, beatSec: number) {
  const templates: Template[] = [];
  const heard = Object.fromEntries(TEACH_CLASSES.map((c) => [c, 0])) as Record<DrumLane, number>;
  for (let k = 0; k < TEACH_CLASSES.length * TEACH_EACH; k++) {
    const at = firstBeatSec + k * beatSec;
    const near = hits.filter((h) => Math.abs(h.t - at) <= 0.4 * beatSec);
    if (!near.length) continue;
    const best = near.reduce((a, b) => (b.strength > a.strength ? b : a));
    const cls = TEACH_CLASSES[Math.floor(k / TEACH_EACH)]!;
    templates.push({ cls, f: best.features });
    heard[cls]++;
  }
  const missing = TEACH_CLASSES.filter((c) => heard[c] < TEACH_MIN);
  return { templates, heard, missing };
}
