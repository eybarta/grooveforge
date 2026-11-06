import { describe, expect, it } from "vitest";
import { emptySong, useSong } from "./store";
import { defaultInstruments, ENGINE_EVENT_STRIDE, ENGINE_INSTRUMENT_STRIDE, LANES, noteTimeSec, songToEngineEvents } from "./time";
import { PPQ, type NoteEvent, type Song } from "./types";

const note = (tick: number, offsetMs = 0, extra: Partial<NoteEvent> = {}): NoteEvent => ({
  id: `n${tick}`, tick, lane: "kick", velocity: 1, offsetMs, source: "detected", ...extra,
});
const song = (over: Partial<Song> = {}): Song => ({ ...emptySong(), bpm: 120, quantize: 0, ...over });

describe("noteTimeSec", () => {
  it("places a beat at 60/bpm seconds", () => {
    expect(noteTimeSec(note(PPQ), song())).toBeCloseTo(0.5, 9);
  });
  it("keeps the user's offset at quantize 0 and removes it at quantize 1, without changing the note", () => {
    const n = note(PPQ, 12);
    expect(noteTimeSec(n, song({ quantize: 0 }))).toBeCloseTo(0.512, 9);
    expect(noteTimeSec(n, song({ quantize: 0.5 }))).toBeCloseTo(0.506, 9);
    expect(noteTimeSec(n, song({ quantize: 1 }))).toBeCloseTo(0.5, 9);
    expect(n.offsetMs).toBe(12);
  });
  it("swings only the off-beat 16th", () => {
    const s = song({ swing: 0.6 }); // 8th = 0.25 s at 120 BPM → off 16th moves from 0.125 to 0.15
    expect(noteTimeSec(note(PPQ / 4), s)).toBeCloseTo(0.15, 9);
    expect(noteTimeSec(note(PPQ / 2), s)).toBeCloseTo(0.25, 9);
  });
});

describe("songToEngineEvents", () => {
  const s = song({
    bars: 2,
    tracks: [
      { id: "d", kind: "drums", name: "Drums", gainDb: 0, muted: false, frozen: false,
        notes: [note(PPQ, 0), note(0, -10)] },
      { id: "m", kind: "drums", name: "Muted", gainDb: 0, muted: true, frozen: false, notes: [note(0)] },
    ],
  });
  const { events, loopFrames } = songToEngineEvents(s, 48000);

  it("sizes the loop in whole frames", () => {
    expect(loopFrames).toBe(2 * 4 * 0.5 * 48000);
  });
  it("skips muted tracks, sorts by frame and wraps early hits to the loop end", () => {
    expect(events.length).toBe(2 * ENGINE_EVENT_STRIDE);
    expect(events[0]).toBe(24000); // the beat-2 kick
    expect(events[ENGINE_EVENT_STRIDE]).toBe(loopFrames - 480); // tick 0 played 10 ms early
  });
  it("maps the lane to its instrument slot and uses MIDI pitch when present", () => {
    const p = songToEngineEvents(song({ tracks: [{ ...s.tracks[0]!, notes: [note(0, 0, { lane: "bass", pitch: 69 })] }] }), 48000);
    expect(p.events[1]).toBe(LANES.indexOf("bass"));
    expect(p.events[3]).toBe(69);
    expect(p.events[5]).toBe(-1); // no glide yet
    expect(songToEngineEvents(song({ tracks: [{ ...s.tracks[0]!, notes: [note(0)] }] }), 48000).events[3]).toBe(60); // drums: original pitch
  });

  it("gives every lane an instrument, with closed and open hat sharing a choke group", () => {
    const inst = defaultInstruments();
    expect(inst.length).toBe(LANES.length * ENGINE_INSTRUMENT_STRIDE);
    const choke = (lane: (typeof LANES)[number]) => inst[LANES.indexOf(lane) * ENGINE_INSTRUMENT_STRIDE + 1];
    expect(choke("hatClosed")).toBe(1);
    expect(choke("hatOpen")).toBe(1);
    expect(choke("kick")).toBe(-1);
  });
});

describe("useSong store", () => {
  it("adds and removes notes immutably and sets knobs", () => {
    useSong.getState().setSong(song({ tracks: [{ id: "d", kind: "drums", name: "D", gainDb: 0, muted: false, frozen: false, notes: [] }] }));
    const before = useSong.getState().song;
    useSong.getState().addNote("d", note(0));
    expect(useSong.getState().song.tracks[0]!.notes).toHaveLength(1);
    expect(before.tracks[0]!.notes).toHaveLength(0);
    useSong.getState().removeNote("d", "n0");
    expect(useSong.getState().song.tracks[0]!.notes).toHaveLength(0);
    useSong.getState().setKnob("quantize", 1);
    expect(useSong.getState().song.quantize).toBe(1);
  });
});
