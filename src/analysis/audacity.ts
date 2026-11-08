/**
 * Golden-take labelling through Audacity: pre-labels out (the detector's guesses, to correct) and labels back in
 * (File → Export → Export Labels: one `start<TAB>end<TAB>text` line per label).
 */
import type { DrumLane } from "@/song/types";
import type { LabelledHit, TakeLabels } from "./golden";

/** Label text → hit class. Short forms so labelling is quick; anything else is rejected. */
const ALIASES: Record<string, DrumLane> = {
  k: "kick", kick: "kick", b: "kick",
  s: "snare", snare: "snare", sn: "snare",
  h: "hatClosed", hh: "hatClosed", hat: "hatClosed", hatclosed: "hatClosed", ch: "hatClosed",
  oh: "hatOpen", hatopen: "hatOpen", o: "hatOpen",
  p: "perc", perc: "perc", rim: "perc", click: "perc", clap: "perc",
};

export function toAudacityLabels(hits: LabelledHit[]): string {
  return hits.map((h) => `${h.t.toFixed(6)}\t${h.t.toFixed(6)}\t${h.class}`).join("\n") + "\n";
}

/** Point labels → hits (by their start); region labels "hum" / "hum 36" / "hum:36" → hum segments (midi optional). */
export function fromAudacityLabels(text: string, source = "labels"): Pick<TakeLabels, "hits" | "hum"> {
  const hits: LabelledHit[] = [];
  const hum: TakeLabels["hum"] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith("\\")) return; // blank, or a spectral-selection line
    const [a, b, label = ""] = line.split("\t");
    const start = Number(a), end = Number(b);
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error(`${source}:${i + 1}: not a "start<TAB>end<TAB>label" line`);
    const text = label.trim().toLowerCase();
    const humMatch = /^hum(?:[\s:]+(\d+))?$/.exec(text);
    if (humMatch) {
      if (!(end > start)) throw new Error(`${source}:${i + 1}: a hum label needs a region (end > start)`);
      hum.push({ start, end, ...(humMatch[1] ? { midi: Number(humMatch[1]) } : {}) });
      return;
    }
    const cls = ALIASES[text];
    if (!cls) throw new Error(`${source}:${i + 1}: "${label}" is not a hit class (kick, snare, hh, oh, perc or hum)`);
    hits.push({ t: start, class: cls });
  });
  hits.sort((x, y) => x.t - y.t);
  hum.sort((x, y) => x.start - y.start);
  return { hits, hum };
}

export interface TakeMeta { mood: string; bpm: number; countInSec: number; route: string; stamp: string }

/** The saved take's name carries what the labels need, so one file is enough to AirDrop. */
export function takeFileName(m: TakeMeta) {
  const route = m.route.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown";
  return `take-${m.mood}-${m.bpm}bpm-ci${m.countInSec.toFixed(3)}s-${route}-${m.stamp}`;
}

export function takeMetaFromName(name: string): TakeMeta | null {
  const m = /^take-([a-zA-Z]+)-(\d+(?:\.\d+)?)bpm-ci(\d+(?:\.\d+)?)s-([a-z0-9_]+)-([0-9a-zA-Z_-]+?)(?:-unaligned)?$/.exec(name);
  return m ? { mood: m[1]!, bpm: Number(m[2]), countInSec: Number(m[3]), route: m[4]!, stamp: m[5]! } : null;
}
