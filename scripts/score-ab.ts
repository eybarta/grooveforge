/// <reference types="node" />
// Scores the blind A/B: paste the listeners' messages into .ab/codes.txt (git-ignored), then `npm run ab:score`.
// The answer key (.ab/key.json) comes from the /ab page's build and stays out of git: the repo is public.
import { readFileSync } from "node:fs";
import { DEVICES, GATE, score } from "../src/ab/score.ts";

const key = JSON.parse(readFileSync(".ab/key.json", "utf8")) as { pairs: Record<string, { label: string; v2: "x" | "y" }> };
const ids = Object.keys(key.pairs).sort();
const s = score(readFileSync(".ab/codes.txt", "utf8"), ids, Object.fromEntries(ids.map((id) => [id, key.pairs[id]!.v2])));
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "–");

console.log(`Listeners: ${s.listeners} (gate needs ${GATE.listeners})`);
console.log(`Prefer v2 (≥ ${GATE.perListener} of ${ids.length} pairs): ${s.preferV2} = ${pct(s.preferV2, s.listeners)} (gate: ≥ ${GATE.share * 100} %)`);
console.log(`All votes for v2: ${Math.round(100 * s.voteShare)} %`);
console.log(`Gate: ${s.pass ? "PASS" : "not passed"}`);
for (const id of ids) console.log(`  ${key.pairs[id]!.label}: v2 ${s.perPair[id]} of ${s.listeners}`);
for (const [d, n] of Object.entries(s.perDevice)) if (n.listeners) console.log(`  on ${DEVICES[d as keyof typeof DEVICES]}: ${n.preferV2} of ${n.listeners} prefer v2`);
