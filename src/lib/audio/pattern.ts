import type { Analysis, Flavor, HitEvent, Lane } from "./music.ts";
import { STEPS_PER_BAR } from "./music.ts";

export interface Edit {
  on: boolean;
  velocity: number;
  degree: number;
}

export type EditMap = Record<string, Edit>;

export function editKey(step: number, lane: Lane): string {
  return `${step}:${lane}`;
}

export function stepsFromAnalysis(analysis: Analysis): HitEvent[][] {
  const total = analysis.bars * STEPS_PER_BAR;
  const steps: HitEvent[][] = Array.from({ length: total }, () => []);
  const stepDur = 60 / analysis.bpm / 4;
  for (const hit of analysis.hits) {
    const idx = Math.round((hit.time - analysis.origin) / stepDur);
    if (idx < 0 || idx >= total) continue;
    const lane = hit.lane;
    const existing = steps[idx]?.find((event) => event.lane === lane);
    if (!existing) {
      steps[idx]?.push({ lane, velocity: hit.velocity, source: "mic", degree: 0 });
    } else if (hit.velocity > existing.velocity) {
      existing.velocity = hit.velocity;
    }
  }
  return steps;
}

function countLane(steps: HitEvent[][], lane: Lane): number {
  let n = 0;
  for (const step of steps) if (step.some((event) => event.lane === lane)) n++;
  return n;
}

function push(steps: HitEvent[][], index: number, event: HitEvent) {
  const slot = steps[index];
  if (!slot) return;
  if (slot.some((item) => item.lane === event.lane)) return;
  slot.push(event);
}

export function dressSteps(micSteps: HitEvent[][], flavor: Flavor): HitEvent[][] {
  const steps = micSteps.map((step) => step.map((event) => ({ ...event })));
  const n = steps.length;
  if (!n) return steps;

  if (countLane(steps, "kick") === 0) {
    for (let i = 0; i < n; i += 4) {
      push(steps, i, { lane: "kick", velocity: 0.92, source: "dress", degree: 0 });
    }
  }
  if (countLane(steps, "snare") === 0) {
    for (let i = 4; i < n; i += 8) {
      push(steps, i, { lane: "snare", velocity: 0.88, source: "dress", degree: 0 });
    }
  }
  if (countLane(steps, "hat") / n < 0.28) {
    for (let i = 0; i < n; i += 2) {
      push(steps, i, {
        lane: "hat",
        velocity: i % 4 === 0 ? 0.52 : 0.3,
        source: "dress",
        degree: 0,
      });
    }
  }

  for (const step of steps) {
    for (let i = step.length - 1; i >= 0; i--) {
      if (step[i]?.lane === "bass") step.splice(i, 1);
    }
  }

  if (flavor === "house") {
    for (let bar = 0; bar < n / STEPS_PER_BAR; bar++) {
      const base = bar * STEPS_PER_BAR;
      const degree = bar % 2 === 0 ? 0 : 1;
      push(steps, base, { lane: "bass", velocity: 0.72, source: "dress", degree });
      push(steps, base + 8, { lane: "bass", velocity: 0.62, source: "dress", degree });
      push(steps, base + 6, { lane: "bass", velocity: 0.66, source: "dress", degree: degree + 2 });
      push(steps, base + 14, { lane: "bass", velocity: 0.58, source: "dress", degree: degree + 2 });
    }
    return steps;
  }

  const degrees =
    flavor === "funk"
      ? [0, 4, 5, 4, 0, 6, 4, 3]
      : flavor === "afro"
        ? [0, 0, 4, 2, 0, 3, 4, 1]
        : flavor === "bap"
          ? [0, 0, 3, 4, 0, 4, 2, 0]
          : [0, 0, 0, 3, 0, 4, 0, 5];

  let kickCount = 0;
  for (let i = 0; i < n; i++) {
    if (!steps[i]?.some((event) => event.lane === "kick")) continue;
    push(steps, i, {
      lane: "bass",
      velocity: 0.8,
      source: "dress",
      degree: degrees[kickCount % degrees.length] ?? 0,
    });
    kickCount++;
  }

  if (flavor === "funk" || flavor === "afro") {
    for (let bar = 0; bar < n / STEPS_PER_BAR; bar++) {
      const pickup = bar * STEPS_PER_BAR + (flavor === "funk" ? 3 : 6);
      push(steps, pickup, {
        lane: "bass",
        velocity: flavor === "funk" ? 0.42 : 0.5,
        source: "dress",
        degree: flavor === "funk" ? 4 : 2,
      });
    }
  }

  return steps;
}

export function resolveGroove(
  micSteps: HitEvent[][],
  flavor: Flavor,
  dressOn: boolean,
  edits: EditMap,
): HitEvent[][] {
  const base = dressOn
    ? dressSteps(micSteps, flavor)
    : micSteps.map((step) => step.map((event) => ({ ...event })));

  for (const [key, edit] of Object.entries(edits)) {
    const splitAt = key.indexOf(":");
    const idx = Number(key.slice(0, splitAt));
    const lane = key.slice(splitAt + 1) as Lane;
    const slot = base[idx];
    if (!slot || Number.isNaN(idx)) continue;
    for (let i = slot.length - 1; i >= 0; i--) {
      if (slot[i]?.lane === lane) slot.splice(i, 1);
    }
    if (edit.on) {
      slot.push({
        lane,
        velocity: edit.velocity,
        source: "user",
        degree: edit.degree,
      });
    }
  }
  return base;
}

export function countLanes(steps: HitEvent[][]): Record<Lane, number> {
  const counts: Record<Lane, number> = { kick: 0, snare: 0, hat: 0, perc: 0, bass: 0 };
  for (const step of steps) {
    for (const event of step) counts[event.lane] += 1;
  }
  return counts;
}
