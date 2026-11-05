import { create } from "zustand";
import type { NoteEvent, Song } from "./types";

type Knob = "bpm" | "quantize" | "swing";

interface SongState {
  song: Song;
  setSong: (song: Song) => void;
  setKnob: (knob: Knob, value: number) => void;
  addNote: (trackId: string, note: NoteEvent) => void;
  removeNote: (trackId: string, noteId: string) => void;
}

export const emptySong = (): Song => ({
  id: "song", bpm: 90, bars: 2, mood: "boomBap", quantize: 0.5, swing: 0.5, tracks: [],
});

const mapTrack = (song: Song, trackId: string, f: (notes: NoteEvent[]) => NoteEvent[]): Song => ({
  ...song,
  tracks: song.tracks.map((t) => (t.id === trackId ? { ...t, notes: f(t.notes) } : t)),
});

/** The single source of truth for the song (CLAUDE.md). Playback position never goes through here. */
export const useSong = create<SongState>()((set) => ({
  song: emptySong(),
  setSong: (song) => set({ song }),
  setKnob: (knob, value) => set((s) => ({ song: { ...s.song, [knob]: value } })),
  addNote: (trackId, note) => set((s) => ({ song: mapTrack(s.song, trackId, (ns) => [...ns, note]) })),
  removeNote: (trackId, noteId) =>
    set((s) => ({ song: mapTrack(s.song, trackId, (ns) => ns.filter((n) => n.id !== noteId)) })),
}));
