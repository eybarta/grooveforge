import type { StateStorage } from "zustand/middleware";

/** Web: zustand stores persist to localStorage (persist.native.ts: a file per store in the app's documents). */
export const persistStorage: StateStorage = {
  getItem: (name) => globalThis.localStorage?.getItem(name) ?? null,
  setItem: (name, value) => globalThis.localStorage?.setItem(name, value),
  removeItem: (name) => globalThis.localStorage?.removeItem(name),
};
