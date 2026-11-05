import { clsx } from "clsx";
import type { HitEvent, Lane } from "@/lib/audio/music";

const LANES: { id: Lane; label: string }[] = [
  { id: "kick", label: "Kick" },
  { id: "snare", label: "Snare" },
  { id: "hat", label: "Hat" },
  { id: "perc", label: "Perc" },
  { id: "bass", label: "Bass" },
];

interface StepGridProps {
  steps: HitEvent[][];
  bar: number;
  playStep: number | null;
  onToggle: (step: number, lane: Lane) => void;
}

function padClass(lane: Lane, on: boolean): string {
  if (!on) return "border-line bg-ink";
  if (lane === "kick") return "border-tangerine bg-tangerine";
  if (lane === "snare") return "border-cream bg-cream";
  if (lane === "hat") return "border-acid bg-acid";
  if (lane === "perc") return "border-acid bg-panel-2";
  return "border-tangerine bg-panel-2";
}

export function StepGrid({ steps, bar, playStep, onToggle }: StepGridProps) {
  const offset = bar * 16;
  return (
    <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain pb-1">
      <div className="w-max">
        <div className="mb-1 flex">
          <div className="w-12 shrink-0" />
          {Array.from({ length: 16 }, (_, index) => (
            <div
              key={index}
              className="flex h-6 w-11 shrink-0 items-end justify-center pb-1 font-display text-xs text-faint"
            >
              {index % 4 === 0 ? index / 4 + 1 : ""}
            </div>
          ))}
        </div>
        {LANES.map((lane) => (
          <div key={lane.id} className="flex">
            <div className="flex h-11 w-12 shrink-0 items-center text-xs font-semibold tracking-wide text-muted uppercase">
              {lane.label}
            </div>
            {Array.from({ length: 16 }, (_, index) => {
              const global = offset + index;
              const event = steps[global]?.find((item) => item.lane === lane.id);
              const on = Boolean(event);
              const play = playStep === global;
              return (
                <div key={index} className="flex w-11 shrink-0 justify-center py-0.5">
                  <button
                    type="button"
                    aria-label={`${lane.label} step ${index + 1}, ${on ? "on" : "off"}`}
                    aria-pressed={on}
                    onClick={() => onToggle(global, lane.id)}
                    className={clsx(
                      "relative size-10 rounded-md border transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.96]",
                      padClass(lane.id, on),
                      index % 4 === 0 && !on && "border-faint",
                      play && "ring-2 ring-cream",
                    )}
                    style={on && event ? { opacity: 0.62 + event.velocity * 0.38 } : undefined}
                  >
                    {event?.source === "dress" && (
                      <span className="absolute top-1 right-1 size-1.5 rounded-full bg-ink" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
