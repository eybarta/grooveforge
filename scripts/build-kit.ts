// Builds the placeholder hip-hop kit (CC0 only, see CLAUDE.md) into assets/kits/hiphop/.
// Downloads sources into .cache/kit-src (git-ignored), mixes/converts with sox, writes manifest.json,
// index.ts (asset requires) and assets/kits/LICENSES.md. Run: npm run kit:build   (needs `brew install sox`)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CACHE = join(ROOT, ".cache/kit-src");
const OUT = join(ROOT, "assets/kits/hiphop");
const MAX_SEC = 3; // nothing in a drum kit needs more; open hats get a fade

const GOGODZE = "https://raw.githubusercontent.com/sfzinstruments/karoryfer.gogodze-phu-vol-ii/master";
const VCSL = "https://raw.githubusercontent.com/sgossner/VCSL/master";
const SONICPI = "https://raw.githubusercontent.com/sonic-pi-net/sonic-pi/dev/etc/samples";

type Source = { name: string; licence: string; url: string; note: string };
const SOURCES: Record<string, Source> = {
  gogodze: {
    name: "Gogodze Phu Vol II (Karoryfer Lecolds)", licence: "CC0 1.0",
    url: "https://github.com/sfzinstruments/karoryfer.gogodze-phu-vol-ii (LICENSE = CC0 1.0 Universal)",
    note: "Mixed from the kit's stock mic blend (kick, snare, overhead R, side L, front) per its Programs/Kit.sfz.",
  },
  vcsl: {
    name: "Versilian Community Sample Library (VCSL)", licence: "CC0 1.0",
    url: "https://github.com/sgossner/VCSL (README: \"under a Creative Commons 0 license\")", note: "",
  },
  sonicpi: {
    name: "Sonic Pi built-in samples", licence: "CC0 1.0",
    url: "https://github.com/sonic-pi-net/sonic-pi/blob/dev/etc/samples/README.md (samples \"placed in the public domain via the Creative Commons 0 License\"; per-file Freesound source listed there)",
    note: "",
  },
};

/** One output sample: either a mic blend (several mono files → stereo) or a single file. */
type Mic = { url: string; gain: number; pan: "C" | "L" | "R" };
type Hit = { source: keyof typeof SOURCES; mics: Mic[]; origin: string };
type Piece = { layers: Hit[][]; chokeGroup: number; trimSec?: number };

// Summing five mics would clip a 24-bit file; this headroom is undone by the piece's manifest gain.
const BLEND_HEADROOM = 0.3;
const MIC_BLEND = (close: "kick" | "snare" | null): ((file: string) => Mic[]) => (file) => {
  const other = close === "kick" ? 0.47 : 1; // Kit.sfz: non-close mics at 60 % on the kick
  return ([
    { url: `${GOGODZE}/Samples/kick_mic/${file}`, gain: close === "kick" ? 1 : other, pan: "C" },
    { url: `${GOGODZE}/Samples/snare_mic/${file}`, gain: close === "snare" ? 1 : other, pan: "C" },
    { url: `${GOGODZE}/Samples/oh_mic/${file}`, gain: other, pan: "R" },
    { url: `${GOGODZE}/Samples/side_mic/${file}`, gain: other, pan: "L" },
    { url: `${GOGODZE}/Samples/front_mic/${file}`, gain: other, pan: "C" },
  ] as Mic[]).map((m) => ({ ...m, gain: m.gain * BLEND_HEADROOM }));
};

/** Reads a Gogodze SFZ mapping and returns {velocityLayer → [roundRobin files]} for one articulation prefix. */
async function gogodzeLayers(mapping: string, prefix: string): Promise<Map<number, string[]>> {
  const sfz = await text(`${GOGODZE}/Programs/mappings/${mapping}`);
  const layers = new Map<number, string[]>();
  for (const m of sfz.matchAll(new RegExp(`sample=\\.\\./Samples/\\w+/(${prefix}_vl(\\d+)_rr\\d+\\.wav)`, "g"))) {
    const vl = Number(m[2]);
    layers.set(vl, [...(layers.get(vl) ?? []), m[1]!]);
  }
  return layers;
}

/** Evenly spaced velocity layers (soft → hard), first `rr` round-robins of each. */
function pick(layers: Map<number, string[]>, count: number, rr: number): string[][] {
  const keys = [...layers.keys()].sort((a, b) => a - b);
  const chosen = count >= keys.length ? keys : Array.from({ length: count }, (_, i) => keys[Math.round(((i + 1) * keys.length) / count) - 1]!);
  return chosen.map((k) => layers.get(k)!.slice(0, rr));
}

async function gogodze(mapping: string, prefix: string, close: "kick" | "snare" | null, layers: number, rr: number): Promise<Hit[][]> {
  const blend = MIC_BLEND(close);
  return pick(await gogodzeLayers(mapping, prefix), layers, rr).map((files) =>
    files.map((f) => ({ source: "gogodze", mics: blend(f), origin: `Samples/{kick,snare,oh,side,front}_mic/${f}` })),
  );
}

const single = (source: keyof typeof SOURCES, url: string, origin: string): Hit => ({ source, mics: [{ url, gain: 1, pan: "C" }], origin });
const vcsl = (path: string) => single("vcsl", `${VCSL}/${path.split("/").map(encodeURIComponent).join("/")}`, path);
const sonic = (file: string) => single("sonicpi", `${SONICPI}/${file}`, `etc/samples/${file}`);

async function pieces(): Promise<Record<string, Piece>> {
  const claps = "Idiophones/Struck Idiophones/Claps";
  const shaker = "Idiophones/Struck Idiophones/Shaker, Small";
  return {
    kick_dusty: { layers: await gogodze("kick_kick_mic.sfz", "ks", "kick", 3, 2), chokeGroup: -1 },
    snare_dusty: { layers: await gogodze("snare_snare_mic.sfz", "sc", "snare", 3, 2), chokeGroup: -1 },
    hat_closed_dusty: { layers: await gogodze("hc_oh_mic.sfz", "hc", null, 3, 2), chokeGroup: 1 },
    hat_open_dusty: { layers: await gogodze("ho_oh_mic.sfz", "ho", null, 2, 1), chokeGroup: 1, trimSec: 2 },
    clap: { layers: [[1, 2, 3, 4, 5, 6].map((i) => vcsl(`${claps}/Clap_rr${i}.wav`))], chokeGroup: -1 },
    shaker: {
      layers: [["Down_rr1", "Up_rr1", "Down_rr2", "Up_rr2"].map((v) => vcsl(`${shaker}/Mid_ShakerDouble_${v}.wav`))],
      chokeGroup: -1,
    },
    kick_trap: { layers: [[sonic("bd_tek.flac")]], chokeGroup: -1 },
    hat_trap: { layers: [[sonic("hat_tap.flac"), sonic("hat_snap.flac")]], chokeGroup: 1 },
    snap: { layers: [[sonic("perc_snap.flac"), sonic("perc_snap2.flac")]], chokeGroup: -1 },
  };
}

/** Lane → piece per mood. Lanes are the Song model's drum lanes (src/song/types.ts). */
const MOODS = {
  boomBap: { kick: "kick_dusty", snare: "snare_dusty", hatClosed: "hat_closed_dusty", hatOpen: "hat_open_dusty", perc: "shaker" },
  trap: { kick: "kick_trap", snare: "clap", hatClosed: "hat_trap", hatOpen: "hat_open_dusty", perc: "snap" },
};

// ---------------------------------------------------------------------------------------------

async function text(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

/** Downloads once into the cache; refuses anything that isn't really WAV/FLAC (e.g. a Git LFS pointer). */
async function cached(url: string): Promise<string> {
  const file = join(CACHE, decodeURIComponent(new URL(url).pathname).replace(/[^\w.-]+/g, "_"));
  if (!existsSync(file)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const magic = bytes.subarray(0, 4).toString("latin1");
    if (magic !== "RIFF" && magic !== "fLaC") throw new Error(`not audio (${JSON.stringify(magic)}): ${url}`);
    writeFileSync(file, bytes);
  }
  return file;
}

const sox = (...args: string[]) => execFileSync("sox", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();

/** Mixes the hit's mics to stereo, converts to 48 kHz / 24-bit FLAC, trims the silent tail and caps the length. */
async function render(hit: Hit, out: string, trimSec: number) {
  const files = await Promise.all(hit.mics.map((m) => cached(m.url)));
  const n = files.length;
  // remix: left gets centre + left mics, right gets centre + right mics (each input downmixed to mono first)
  const chan = (side: "L" | "R") =>
    hit.mics.map((m, i) => (m.pan === "C" || m.pan === side ? `${i + 1}v${m.gain.toFixed(3)}` : "")).filter(Boolean).join(",");
  const mono = files.map((f, i) => {
    const t = join(CACHE, `tmp_${i}.wav`);
    sox(f, "-c", "1", t);
    return t;
  });
  const merged = n > 1 ? ["-M", ...mono] : mono;
  const mixed = join(CACHE, "tmp_mix.wav");
  sox(...merged, "-b", "24", mixed, "remix", chan("L"), chan("R"), "rate", "-v", "48k", "trim", "0", String(trimSec),
    "reverse", "silence", "1", "0.005", "-70d", "reverse");
  sox(mixed, "-b", "24", out, "fade", "0", "-0", "0.01"); // separate pass: fade needs a known length
  [...mono, mixed].forEach((t) => rmSync(t));
}

// sox prints `stat` on stderr
const peak = (file: string) =>
  Number(/Maximum amplitude:\s+([\d.]+)/.exec(spawnSync("sox", [file, "-n", "stat"]).stderr.toString())?.[1] ?? "0");

async function main() {
  mkdirSync(CACHE, { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const kit = await pieces();
  const manifest: Record<string, unknown> = { version: 1, sampleRate: 48000, moods: MOODS, pieces: {} };
  const requires: string[] = [];
  const licenceRows: string[] = [];

  for (const [id, piece] of Object.entries(kit)) {
    const layers: { maxVelocity: number; files: string[] }[] = [];
    let loudest = 0;
    for (const [li, hits] of piece.layers.entries()) {
      const files: string[] = [];
      for (const [ri, hit] of hits.entries()) {
        const name = `${id}_v${li + 1}_rr${ri + 1}.flac`;
        await render(hit, join(OUT, name), piece.trimSec ?? MAX_SEC);
        loudest = Math.max(loudest, peak(join(OUT, name)));
        files.push(name);
        requires.push(`  "${name}": require("./${name}"),`);
        licenceRows.push(`| ${name} | ${SOURCES[hit.source]!.name} | ${hit.origin} | ${SOURCES[hit.source]!.licence} |`);
      }
      layers.push({ maxVelocity: +((li + 1) / piece.layers.length).toFixed(3), files });
    }
    // one gain per piece (not per file) so velocity layers keep their natural loudness steps
    (manifest.pieces as Record<string, unknown>)[id] = { gain: +(0.89 / loudest).toFixed(4), chokeGroup: piece.chokeGroup, layers };
    console.log(`${id}: ${layers.length} layer(s) × ${layers[0]!.files.length} rr, peak ${loudest.toFixed(3)}`);
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(OUT, "index.ts"), `// Generated by scripts/build-kit.ts — do not edit.\n/* eslint-disable */\nimport manifest from "./manifest.json";\n\nexport const files: Record<string, number | string> = {\n${requires.join("\n")}\n};\nexport { manifest };\n`);
  writeFileSync(join(ROOT, "assets/kits/LICENSES.md"), [
    "# Kit sample licences", "", "Every bundled sample, its source and licence (CLAUDE.md: CC0 only). Generated by `scripts/build-kit.ts`.", "",
    ...Object.values(SOURCES).map((s) => `- **${s.name}**: ${s.licence}: ${s.url}${s.note ? ` ${s.note}` : ""}`),
    "", "| File | Source | Origin | Licence |", "| --- | --- | --- | --- |", ...licenceRows, "",
    "The 808 is synthesised by the engine (no sample).", "",
  ].join("\n"));
  const bytes = requires.reduce((sum, r) => sum + statSync(join(OUT, /"(.+?)"/.exec(r)![1]!)).size, 0);
  console.log(`kit: ${requires.length} files, ${(bytes / 1e6).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
