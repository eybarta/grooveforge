# GrooveForge — project guide for Claude Code

## What we're building
A hip-hop loop station you play with your mouth.
1. **Take 1:** the user beatboxes and hums a bassline in one pass. The app splits the take (HPSS) into percussive hits → drum lanes (hip-hop kit) and hum → 808 bassline (pitch → notes, in key, with glides). The result loops (2/4/8 bars).
2. **Take 2…n:** the user sings melodies over the playing loop (headphones). Each take becomes notes → an auto-chosen synth preset the user can swap. Layers stack without limit; layers not being edited are frozen (rendered to audio) to save CPU.
3. Everything stays editable: step grid, velocities, quantize/swing/humanize, key snap, synth choice, mix knobs. Export WAV/MP3/stems/MIDI and a 9:16 visualizer video.

v1 ships ONE flavor: **Hip-hop**, with a **Boom Bap ⇄ Trap** switch.

## Decisions (do not relitigate without asking Eyal)
- One **Expo** (React Native, New Architecture) codebase + Expo Router → iOS, Android and web (react-native-web).
- **Android is deferred** (Eyal, 2026-11-06): build for iOS + web until the app works well on both, then bring up Android. Keep code cross-platform; `engine/android/` exists but is unbuilt.
- **Shared C++ audio engine** (or Faust → C++): native via JSI, web as WASM inside an AudioWorklet. All synthesis, sampling, mixing and mastering run there, never in JS.
- Audio I/O: **react-native-audio-api** (Web Audio-style API), **confirmed by the Phase 0 spike** (`docs/spike-report.md`), pinned to an exact version. The engine plugs in as a custom node through its `StableAPI.h` (see `engine/rn/`). Web uses Web Audio directly (AudioWorklet + WASM).
- Audio session and routing: react-native-audio-api's `AudioManager` (no separate native module). **Latency is measured, never taken from the OS:**
  - Why: OS/browser figures were 30–48 ms short on Bluetooth and web.
  - How: the engine captures its output and the mic on one frame clock; clicks + cross-correlation give the round trip (RTL).
  - When: per route; re-calibrate on route change; re-verify around takes on Bluetooth and web (latency drifts and can step by a buffer).
- Visuals: **React Native Skia** for everything that glows (orb shader, sparks, grid, beam); **Reanimated** for springs, morphs and transitions.
- ML: **onnxruntime** (react-native + web). Core ML acceleration is a later optimisation.
- State: **zustand**. One `Song` store is the single source of truth.
- v1 = record → process → edit. Live real-time transformation ("monitor mode") is out of scope for v1.
- Samples: Eyal has budget for a commissioned/licensed hip-hop kit. Until it arrives use **CC0 sounds only** (e.g. Gogodze Phu Vol II, VCSL, Sonic Pi samples). The 808 is synthesised by our engine. No CC BY-SA (e.g. AVL Drumkits): its no-technical-restrictions clause conflicts with App Store DRM (decided 2026-11-06). Never ship a sample without a licence that allows bundling it in an app; log every sample source in `assets/kits/LICENSES.md`.
- Export formats: WAV 24-bit now; AAC/M4A with the P5 share/export work. No MP3: every MP3 encoder is LGPL (decided 2026-11-06).
- **No teaching required** (Eyal, 2026-11-09): hits are classified untaught, from a generic kit built from the AVP beatbox dataset (CC BY 4.0, credited in `assets/kits/LICENSES.md`), the take's own sound clusters, and the user's fixes. "Teach me your kit" is optional tuning.
- **Take 1 has no metronome by default** (Eyal, 2026-11-09): the user beatboxes freely; the engine finds the tempo, the beats and bar 1. A Click option keeps the count-in.

## Architecture rules
- `Song → Track → NoteEvent {tick, lane, velocity, offsetMs, source}` — hits keep their original timing offset (the user's feel); quantize is a blend knob, not destructive.
- Live playback and offline export render from the same Song through the same engine, so they sound identical.
- Heavy analysis (HPSS, onsets, classification, tempo, pitch) runs off the UI thread (worker / native thread).
- **Never push playback position through React state.** The engine exposes its clock minus the *measured* output latency (calibrated RTL minus the small reported input latency; never the OS `outputLatency` alone) as a Reanimated shared value; visuals read it every frame.
- Visualizers are pure functions of `(song, t)`: live playback reads t from the audio clock; video export steps t frame by frame. Same code, always in sync.
- Takes recorded over playback (the click, the loop) are shifted by the measured round-trip latency before analysis. A take with nothing playing needs no shift.
- Mic capture: echo cancellation, noise suppression and auto gain OFF.

## Design system ("Neon Forge")
- Background `#07060B`; glass surfaces `rgba(255,255,255,.04)` + 1px `rgba(255,255,255,.08)` border.
- Lanes: kick `#FF2BD6` ●, snare `#00E5FF` ◆, closed hat `#C6FF3D` ■, open hat `#FFB020`, perc `#8B5CFF`, bass `#FF5A1F`. Every lane colour also has a shape (colour-blind safe).
- Type: Unbounded (display), Figtree (UI), JetBrains Mono (BPM/LUFS readouts).
- Glow means "sound is happening now" — never decoration. Idle UI is quiet glass.
- Motion: springs damping ratio ≈ 0.8; one object turns into the next (morph, never cross-fade between screens); flashes decay exponentially (~6/s); honour reduced-motion.
- Touch targets ≥ 44 px; real buttons with accessibility labels.
- References: `docs/design/` (mockups) and `docs/motion/` (forge transition spec video + its exact timeline source).

## Quality bar (each phase must be measured, not eyeballed)
| Metric | Target |
| --- | --- |
| Onset F1 (±30 ms) | ≥ 0.92 on the golden takes |
| Hit class accuracy, untaught (AVP leave-one-person-out + the golden takes) | ≥ 0.85 |
| Hit class accuracy, tuned (teach or fixes) | ≥ 0.90 |
| No-click takes: tempo right (±2 %, right octave) / bar 1 right / hits on the right step | ≥ 9 of 10 / ≥ 8 of 10 / ≥ 95 % |
| Timing error after quantize | ≤ 5 ms |
| Export loudness | target ± 0.5 LU, ≤ −1 dBTP |
| Record → first playback, 8 bars | ≤ 2.5 s on a mid-range Android (until Android returns: measure on the iPhone + web; the iPhone 16 Pro is faster, so treat its numbers as optimistic) |
| Animations | 60 fps on a mid-range phone during playback |

## How to work
- Work phase by phase from `docs/BUILD_PLAN.md`. Each phase ends at a **gate**: demo it, report the measured numbers, and stop for Eyal's OK.
- Use plan mode before each phase; keep a task list.
- Test on real devices every phase (the iPhone now; a mid-range Android once Android returns). Simulators lie about audio.
- Golden audio fixtures + Vitest/Jest scoring for anything in the analysis pipeline; a regression in the scores fails CI.
- Prefer few, well-maintained dependencies. Ask before adding anything heavy.
- Commit small, descriptive commits on the `v2` branch.
