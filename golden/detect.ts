/// <reference types="node" />
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { analyzeTake, type DetectedHit } from "../src/analysis/analyze.ts";
import { classify, makeKit, type Kit, type Template } from "../src/analysis/classify.ts";
import type { LabelledHit, TakeLabels } from "../src/analysis/golden.ts";
import { instantiateEngine, type GfWasm } from "../src/audio/wasmEngine.ts";
import { decodeWav } from "../src/audio/wav.ts";

/**
 * The detector the golden takes score, and the one golden:prelabel guesses with: the engine's analysis (HPSS +
 * SuperFlux onsets + hit features, through its WASM build) and k-NN against the performer's "teach me" kit.
 */
export const DETECTOR = "engine-superflux-knn";
const WASM = new URL("../public/gf-engine.wasm", import.meta.url);
const TAKES = new URL("./takes/", import.meta.url);

let engine: GfWasm | null = null;
const wasm = () => (engine ??= instantiateEngine(new WebAssembly.Module(readFileSync(WASM))));

export const analyze = (samples: Float32Array, sampleRate: number) => analyzeTake(wasm(), samples, sampleRate);
export const findHits = (samples: Float32Array, sampleRate: number): DetectedHit[] => analyze(samples, sampleRate).hits;

const CACHE = process.env.GF_CACHE ?? join(homedir(), ".cache", "grooveforge", "hits");
let build: string | null = null;

/**
 * findHits, cached on disk per engine build (the WASM's hash) and `key` (what the audio is, e.g. its path): analysis
 * here costs ~80 ms per second of audio, and the AVP dataset is 33 minutes of it.
 */
export function hitsCached(key: string, load: () => { samples: Float32Array; sampleRate: number }): DetectedHit[] {
  build ??= createHash("sha1").update(readFileSync(WASM)).digest("hex").slice(0, 16);
  const file = join(CACHE, build, `${createHash("sha1").update(key).digest("hex")}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as DetectedHit[];
  const { samples, sampleRate } = load();
  const hits = findHits(samples, sampleRate);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(hits));
  return hits;
}

/** Templates from labelled hits: each one with the features of the detected hit at it (±30 ms). */
export function templatesFrom(hits: DetectedHit[], labels: Pick<TakeLabels, "hits">): Template[] {
  const templates: Template[] = [];
  for (const l of labels.hits) {
    const h = hits.find((x) => Math.abs(x.t - l.t) <= 0.03);
    if (h) templates.push({ cls: l.class, f: h.features });
  }
  return templates;
}

/** A teach session's kit. */
export const kitFrom = (samples: Float32Array, sampleRate: number, labels: TakeLabels): Kit => makeKit(templatesFrom(findHits(samples, sampleRate), labels));

/** Every performer's kit from their teach take in golden/takes (name → kit). */
export function goldenKits(): Map<string, Kit> {
  const kits = new Map<string, Kit>();
  for (const name of readdirSync(TAKES).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))) {
    const labels = JSON.parse(readFileSync(new URL(`${name}.json`, TAKES), "utf8")) as TakeLabels;
    if (labels.kind !== "teach") continue;
    const { samples, sampleRate } = decodeWav(readFileSync(new URL(`${name}.wav`, TAKES)));
    kits.set(labels.performer, kitFrom(samples, sampleRate, labels));
  }
  return kits;
}

export const classifyHits = (hits: DetectedHit[], kit: Kit): LabelledHit[] => hits.map((h) => ({ t: h.t, class: classify(h.features, kit).cls }));

export const detect = (samples: Float32Array, sampleRate: number, kit: Kit) => classifyHits(findHits(samples, sampleRate), kit);
