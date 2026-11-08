import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { persistStorage } from "./persist";
import type { AudioEngine } from "./types";

/**
 * The measured round trip (src/audio/spikeRuns.ts `calibrate`, or a take's own count-in), per output route and kept
 * across launches (BUILD_PLAN P2: latency calibration as a feature). `rtlMs` is the current route's, or null when this
 * route hasn't been measured: every screen that draws on the audio clock or aligns a take reads it.
 */
export const useCalibration = create<{
  route: string;
  byRoute: Record<string, number>;
  rtlMs: number | null;
  setRoute: (route: string) => void;
  setRtlMs: (ms: number | null) => void;
}>()(
  persist(
    (set) => ({
      route: "default",
      byRoute: {},
      rtlMs: null,
      setRoute: (route) => set((s) => ({ route, rtlMs: s.byRoute[route] ?? null })),
      setRtlMs: (ms) => set((s) => {
        const byRoute = { ...s.byRoute };
        if (ms === null || !Number.isFinite(ms)) delete byRoute[s.route];
        else byRoute[s.route] = ms;
        return { byRoute, rtlMs: byRoute[s.route] ?? null };
      }),
    }),
    { name: "gf-calibration", storage: createJSONStorage(() => persistStorage) },
  ),
);

/** A route's key: the output ports in use (engine.route()), or "default" where the platform doesn't say (Safari). */
export const routeKey = (outputs: string[]) => outputs.join(" + ") || "default";
/** For people: the port names without their category ("AirPods Pro (BluetoothA2DPOutput)" → "AirPods Pro"). */
export const routeName = (key: string) => (key === "default" ? "this output" : key.replace(/ \([^)]*\)/g, ""));

/** Keeps the calibration on the route actually in use: now, and whenever the output changes (plugging in, Bluetooth). */
export function useRoute(audio: AudioEngine | null) {
  const setRoute = useCalibration((c) => c.setRoute);
  useEffect(() => {
    if (!audio) return;
    const check = () => void audio.route().then((r) => setRoute(routeKey(r.outputs))).catch(() => {});
    check();
    return audio.onRouteChange(check);
  }, [audio, setRoute]);
}
