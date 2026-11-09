# GrooveForge 2.0 — Build plan (current as of 2026-11-05)

Live version with diagrams: https://claude.ai/artifact/8kHFpNavnyYhTLReDbHcS7 (if this file and the live doc disagree, ask Eyal).
Project rules and decisions: `CLAUDE.md`.

## Why the POC can't reach studio quality
| Area | POC | Problem |
| --- | --- | --- |
| Hit detection | 3 one-pole bands + spectral flux, 70 ms min gap (`src/lib/audio/analyze.ts`) | misses fast hats/rolls; breaths trigger hits |
| Classification | hand-tuned thresholds → kick/snare/hat/perc | can't adapt to each mouth |
| Sound | oscillators + noise (`voices.ts`) | toy drum machine |
| Bass | fixed degree list following kicks (`pattern.ts`) | ignores what the user hums |
| Mix | browser DynamicsCompressor + convolver | no true-peak limiting or loudness target |
| Scaffolding | ~10k of 13k lines are Grok auth/PGlite/P2P/preview | unused |

Keep as reference only: the scheduler idea, `EditMap` (user overrides on top of detected hits), WAV writer, flavor concept.

## The pipeline
1. **Capture** — 48 kHz, processing off, no click by default (Eyal 2026-11-09; a Click option keeps the count-in), input meter + clip warning, normalise to −3 dBFS before analysis, latency-compensated with the *measured* round trip when something was playing (see `docs/spike-report.md`).
2. **Calibration "Teach me your kit"** (optional tuning since 2026-11-09; untaught = generic kit from AVP + the take's own sound clusters + the user's fixes; 15–20 s) — 5× each: kick, snare, closed hat, open hat, rim/click, hum. Per-user embeddings + KNN (research: ~0.87–0.90 accuracy vs ~0.83 for hand features).
3. **Split** — HPSS: percussive → onsets/classifier; harmonic → pitch tracker.
4. **Onsets** — log-mel SuperFlux-style, adaptive threshold, refine to ±2 ms; keep `offsetMs`.
5. **Classify** — small CNN embedding (trained on AVP + LVT beatbox datasets, ONNX ~1 MB) + per-user KNN; confidence per hit (low confidence → amber "?" in the grid). Fallback: MFCC + envelope + KNN.
6. **Tempo/downbeat/swing** — in the engine: onset-envelope autocorrelation with a mood tempo prior + dynamic-programming beat tracking (Ellis 2007); bar 1 from the kick/snare pattern (beat-this ONNX is MIT but 190 MB: not shippable); swing from median 16th offsets; half/double toggle; 2/4/8 bars.
7. **808 bass** — hum pitch (pYIN) → notes, 16th-quantized, key-snapped, moved to ~C1–E2, slides → glides. No hum → a mood-specific bassline locked to the kicks (progression, octave pops / long sliding 808s, turnaround).
8. **Melody layers** — sung pitch → notes (onset + stable pitch), vibrato smoothed, Key snap + Quantize knobs.
9. **Auto synth** — choose preset from register / note length / density / legato:
   | Sung | Preset |
   | --- | --- |
   | low, long | Lo-fi pad |
   | mid, held | Warm Rhodes |
   | mid, short/choppy | Glass pluck |
   | high, short | Bell |
   | high, sliding | Saw lead w/ glide |
   | high, held, bright | Supersaw festival lead (detuned unison, filter sweep, wide chorus, long reverb, kick-keyed pump; generic name) |
   | sparse | Dusty piano |
   Extras: octave ±, Harmonize (3rds/5ths), Arp, re-sing a bar.
   **Keep my voice** (any layer, drums too): the take's own sounds instead of the kit/synth — cleaned (noise gate from the take's silence, low cut, compression), placed on the grid (drum hits as slices; held notes time-stretched with Signalsmith Stretch, MIT), optionally pitch-corrected to key.
10. **Render** — sampler with velocity layers + round-robin; Hip-hop kit: kick (punch+sub), snare, clap, closed/open hat, rim, shaker, 808 (tuned, glide, saturation). Boom Bap: dusty, swing 55–62 %. Trap: tight, 1/32 hat rolls from fast "ts-ts-ts", long 808. Synth: 2-osc subtractive/wavetable + filter env + unison + chorus + tape sat; 1–2 sampled instruments (Rhodes, piano). 6–8 presets.
11. **Mix** — per-lane HPF/EQ, transient shaper, 4× oversampled saturation, pan; drum-bus glue, parallel bus, IR reverb send, tempo delay.
12. **Master/export** — true-peak limiter (−1 dBTP), BS.1770 LUFS (Streaming −14 / Club −9); WAV 24-bit, AAC/M4A (P5; no MP3, every encoder is LGPL), stems, MIDI, 9:16 video.
13. **Optional AI "Studio Polish"** (later) — server proxy (e.g. Stable Audio 2.5 on fal), result added as an extra layer, never replacing the beat; per-user cap.

## UX flow (see docs/design + docs/motion)
Record (audio-reactive orb, count-in rings, live sparks per hit) → **Forge transition** (button becomes progress bar, waveform bars shrink to lane-shaped dots, dots fly into the grid, stats rise, beam sweeps — exact timeline in `docs/motion/forge-film/film.html`) → Studio (grid, beam playhead on the audio clock, knobs: Quantize, Swing, Humanize, Punch, Space, Loudness; Boom Bap ⇄ Trap; "Your mouth ⇄ Studio" A/B; layer stack with "+ Sing a layer") → Export sheet.

## Phases and gates (≈ 12 weeks, one developer; estimates, not commitments)
### P0 · Foundation + audio spike (weeks 1–2) ✅ passed 2026-11-06 (iOS + web), see `docs/spike-report.md`
- [x] Branch `v2`; new Expo app (New Architecture, Expo Router, TypeScript strict); delete Grok scaffolding; keep POC audio files in `reference/` only.
- [x] **Audio spike on a real iPhone (+ Android, deferred 2026-11-06)**: react-native-audio-api — record while a loop plays, offline render to WAV, custom DSP node from C++, measured round-trip latency. Same on web with AudioWorklet + WASM.
- [x] C++ engine skeleton building for iOS (JSI) and web (WASM); one sine voice through it on both. Android JSI build written, not built (deferred).
- [x] `Song` types + zustand store; scoring harness + 2 synthetic golden takes. **10 real takes pending (Eyal; record with the spike's "Save last take").**
- **Gate:** spike report with latency numbers per device; engine plays on iOS + web; CI green. (Android deferred until iOS + web are solid.)

### P1 · Studio sound (weeks 3–4) · built; gate waiting on the A/B listeners, see `docs/p1-report.md`
- [x] **First: audio clock → UI thread.** The engine's frame counter must be readable from Reanimated UI worklets (shared value) on iOS and web; demo a beam locked to the loop at 60 fps. This is the biggest unknown left after P0.
- [x] Engine: lock-free event swap so the Song can change while it plays (live editing; P0's `setEvents` refuses while playing).
- [x] Sampler (velocity layers, round-robin), kit `manifest.json`, placeholder hip-hop kit (licence-checked).
- [x] 808 voice (synthesised by the engine: tuned, glide, saturation); mix chain; master (limiter + LUFS); WAV export (AAC/M4A in P5).
- **Gate:** ≥ 80 % prefer v2 in a blind A/B vs POC (20 listeners); export within ± 0.5 LU.

### P2 · Accurate ears (weeks 4–6)
- [ ] **Latency calibration as a product feature:**
  - per-route measurement with the reliability check;
  - auto re-calibrate on route change;
  - re-verify at take start on Bluetooth (drifts ~3 ms) and web (can step by a buffer; watch `MediaStreamTrack` audio stats);
  - UX lands in P3.
- [x] HPSS split; onsets; "teach me your kit" calibration flow; MFCC+KNN; confidence; hum → 808 notes.
- [ ] Re-scope 2026-11-09 (Eyal): untaught classification (generic kit from AVP, take clustering, learn from fixes); no-click recording with tempo/beat/bar-1 detection; musical bassline without a hum. ONNX embedding only if untaught accuracy falls short (ask first).
- **Gate:** onset F1 ≥ 0.92; class accuracy ≥ 0.85 untaught after ≤ 1 tap per sound (no-tap accuracy tracked; published user-agnostic best is ~0.73 on isolated sounds), ≥ 0.90 tuned; no-click takes: tempo right on ≥ 9/10, bar 1 on ≥ 8/10, ≥ 95 % of hits on the right step; record→playback ≤ 2.5 s.

### P3 · Neon UI (weeks 5–8, parallel to P2) ✅ passed 2026-11-08 (iOS + web), see `docs/p3-report.md`
- [x] Visual sync from the measured output latency (not OS `outputLatency`). Tokens, glass surfaces, lane colours+shapes; Record screen (Skia orb shader, sparks); Forge transition matching the motion spec; Studio grid/beam/knobs/A-B; reduced motion.
- **Gate:** 60 fps on a mid-range phone; transition matches the spec video side by side.

### P4 · Melody layers (weeks 8–10)
- [ ] Record-over-loop with latency compensation; sung pitch → notes; synth engine + 6–8 presets (incl. the supersaw festival lead); auto-pick; unlimited stacking with freeze; "keep my voice" on any layer.
- **Gate:** 5 testers each stack 3+ layers without help; no audio dropouts.

### P5 · Make it yours + share (weeks 10–12)
- [ ] Fills, ghost notes, humanize; MIDI/stems export; 9:16 video export from the `(song, t)` visualizer.
- **Gate:** MIDI opens in a DAW correctly; video in sync to the frame.

### Later
AI Studio Polish · more flavors (Funk, House, Afro) · live monitor mode (native, low latency) · Core ML acceleration.

## Sources
- POC: https://github.com/eybarta/grooveforge
- AVP classification paper: https://ar5iv.labs.arxiv.org/html/2204.04646
- beat-this-onnx (MIT, 190 MB: not used): https://huggingface.co/musetric/beat-this-onnx
- AVP dataset (CC BY 4.0): https://zenodo.org/records/5036529 · AVP-LVT: https://zenodo.org/records/5578744
- Signalsmith Stretch (MIT): https://github.com/Signalsmith-Audio/signalsmith-stretch
- AVL Drumkits (CC BY-SA 3.0): https://www.bandshed.net/avldrumkits/
- react-native-audio-api: https://npmjs.com/package/react-native-audio-api
- Stable Audio 2.5 on fal: https://fal.ai/models/fal-ai/stable-audio-25/inpaint
