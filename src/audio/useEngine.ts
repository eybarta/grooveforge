import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { createAudioEngine } from "./engine";
import type { AudioEngine } from "./types";

/** The audio engine, alive only while the screen is focused (a screen pushed on top runs its own; the mic closes). */
export function useEngine() {
  const [audio, setAudio] = useState<AudioEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let created: AudioEngine | null = null;
    let gone = false;
    createAudioEngine()
      .then((a) => { created = a; if (gone) void a.close(); else setAudio(a); })
      .catch((e) => setError(`The audio engine didn't start: ${e}`));
    return () => {
      gone = true;
      setAudio(null);
      void created?.close();
    };
  }, []));
  return { audio, error };
}
