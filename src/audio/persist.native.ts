import { File, Paths } from "expo-file-system";
import type { StateStorage } from "zustand/middleware";

/** Native: zustand stores persist to `<name>.json` in the app's documents (expo-file-system, already installed). */
const file = (name: string) => new File(Paths.document, `${name}.json`);
export const persistStorage: StateStorage = {
  getItem: async (name) => (file(name).exists ? file(name).text() : null),
  setItem: (name, value) => {
    const f = file(name);
    if (!f.exists) f.create();
    f.write(value);
  },
  removeItem: (name) => {
    if (file(name).exists) file(name).delete();
  },
};
