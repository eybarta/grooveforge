# Phase 1 studio sound: gate report (draft)

Date: 2026-11-06 · Branch `v2` · CI green · Scope: **iOS + web** (Android deferred).

**Status: the export-loudness half of the gate passes on the iPhone, on web and in CI. The listening half is waiting
for listeners:** the blind A/B page is published but private. Nothing in Phase 2 starts before Eyal's OK.

## Gate

| Gate item | Target | Result |
| --- | --- | --- |
| Blind A/B, v2 vs POC | ≥ 80 % of 20 listeners prefer v2 | **Pending.** Page ready (below); no votes yet |
| Export loudness | target ± 0.5 LU, ≤ −1 dBTP | ✅ All 8 checks (2 moods × 2 targets × iPhone / web) and the same 4 in CI |

### Export loudness: the two demo grooves, 8 bars, default knobs

The master is: gain → band-limited soft clip → limiter at 4× the sample rate → 48 kHz. `masterTo()` renders, measures
(libebur128: integrated LUFS and 4× true peak) and corrects the gain until it is within 0.2 LU.

| Groove · target | iPhone 16 Pro (native, iOS 27.2) | Web (Chrome 156, WASM worklet) | CI (Node, WASM, same kit) |
| --- | --- | --- | --- |
| Boom Bap · Loud −9 | −9.13 LUFS · −1.28 dBTP · +9.39 dB | −9.13 · −1.29 · +9.42 dB | −9.13 · −1.29 · +9.40 dB |
| Boom Bap · Streaming −14 | −14.13 · −1.29 · +1.42 dB | −14.13 · −1.30 · +1.43 dB | −14.13 · −1.29 · +1.42 dB |
| Trap · Loud −9 | −9.03 · −1.21 · +4.58 dB | −9.03 · −1.23 · +4.60 dB | −9.03 · −1.21 · +4.58 dB |
| Trap · Streaming −14 | −14.01 · −2.38 · −2.54 dB | −14.01 · −2.37 · −2.53 dB | −14.01 · −2.37 · −2.54 dB |

The last number in each cell is the master gain that hit the target, found in 2–4 renders. The native and WASM
builds agree to 0.01 LU, 0.02 dB of true peak and 0.03 dB of gain, with the real kit, 808, mix and master. That is
the native-vs-WASM parity check for everything Phase 1 added (the bit-exact check still covers the spike loop).
CI runs the third column on every push (`src/audio/export.wasm.test.ts`).

## The blind A/B

- **Page:** https://grooveforge-listening-test.netlify.app (Netlify, Eyal's account: no login or claude.ai loader in
  front of it, which signed-out listeners got stuck on). The same page is also at
  https://claude.ai/artifact/2QHmQdTSyc847rsqrW3Qy9. Redeploy after editing `docs/p1-ab/listening-test.html`: wrap it
  in a full HTML document next to `.ab/audio/*.wav` (never `key.json`) and `netlify deploy --prod --site
  81d29251-6129-40cb-88fd-dda6f6b8d5b8`.
- **Material:** the two demo grooves, each as full beat, drums only, and kick + 808 (6 pairs). They play through the
  POC (its own default mix, its own export) and through v2 (default knobs, Loud master).
- **Fair:** both versions in a pair have the same 16th-grid pattern (1/32 rolls are dropped because the POC can't
  play them), the same length, and the same loudness: **−18.42 LUFS**. That is −16 or lower if any clip would pass
  −1 dBTP; the POC's peak-normalised Boom Bap set it. Files are named x/y at random. Each listener gets a random pair
  order and A/B sides. The answer key is only in `.ab/key.json`, which is git-ignored because the repo is public.
- **Votes:** each listener picks A or B per pair and gets a code such as `GF1.h.xyyxxy` (listening device, then the
  pick per pair), which they send to Eyal. A listener **prefers v2 if they pick it in ≥ 4 of 6 pairs. The gate passes
  at ≥ 16 of 20 listeners.** I'll also report the total vote share and the per-pair split. *Eyal: confirm this
  scoring rule before votes come in.*
- **Why codes, not saved votes:** the page's database only lets the owner, invited editors or members of a Team plan
  write. Anonymous listeners on a public link can't save anything.
- **Two caveats for reading the result:**
  - In the POC as shipped, Trap passes −12 as an octave count (`degreeToMidi(…, -12)` → −144 semitones). Every Trap
    kick and 808 therefore sits on its 36 Hz / 28 Hz floor, so the Trap pairs partly measure that bug. Boom Bap is
    the clean comparison.
  - The POC skips Trap bass notes that land on a kick, and every one does. Its Trap "full beat" and "drums only"
    clips are therefore identical.
- **Rebuild the set:** `npm run web` → `/dev/ab` → Build, then Download. Each build re-randomises x/y.

## Performance and assets

| Measure | Result |
| --- | --- |
| Whole chain (kit + 808 + mix + 4× master), offline render on iPhone 16 Pro | 35–39× real time ≈ 70–76 µs per 128-frame block (budget 2.67 ms, ≈ 3 %) |
| Same on web (Chrome 156, offline worklet) | 12–29× real time |
| Loop beam on the audio clock (step 1) | iPhone 120 fps, 0 dropped, raw clock jitter 2.7–4.1 ms; Brave 120 fps, 0 dropped, drawn 0.6–0.9 ms |
| Kit | 35 CC0 samples, 2.0 MB FLAC (target ≤ 15 MB), every file logged in `assets/kits/LICENSES.md`; all decoded at start in 426 ms on the iPhone |
| WASM engine | 136 KB |
| Live edits | Song, kit, mix and knobs swap lock-free while playing (ThreadSanitizer-clean stress test) |

## Changes from the plan

- **Reverb:** a feedback-delay-network reverb (Signalsmith Basics, MIT) replaces convolution + pffft. pffft was not
  needed, so it was not added.
- **Saturation:** Signalsmith's Crunch (2× oversampling with antiderivative anti-aliasing) instead of our own 4×.
- **Limiter:** single-stage smoothing (the 2-stage default leaked +0.84 dB at 40 dB of gain reduction), a 0.3 dB
  margin, a safety clamp at 4×, and a band-limited soft clipper before it. A clip at 4× overshot to +1.5 dBTP after
  downsampling.
- **Loudness knob:** two targets, Loud −9 (default, Eyal's choice) and Streaming −14, instead of a dial.
- **Punch / Space:** remapped after Eyal heard too little change. The measured 0→100 difference is now −14 / −11 dB
  (Punch) and −17 / −25 dB (Space) residual, Boom Bap / Trap. Not yet judged on good speakers.
- **Debug iOS builds** compile the engine at -O3. At -O0 it rendered only 2.6× real time.
- **Local patch to a vendored library:** Signalsmith Basics' reverb `reset()` skips one delay line (also on upstream
  `main`). Patched and logged in `engine/third_party/README.md`.

## Found and fixed during the gate work

- **Web engine idling into subnormal floats.** WASM has no flush-to-zero. After ~60 s of silence the output sank to
  ~10⁻⁴⁰ and stayed there. That is free on Apple Silicon but usually many times slower on x86 PCs. Fixes:
  - After 1 s below one 24-bit LSB the engine clears the mixer.
  - Patched the reverb reset above.
  - The 808's envelopes stop at exact zero.
  - Regression test: "silence after the music".

## Open items and known limits

- **iOS audio-session mode.** Eyal: Default mode is "definitely louder" on the speaker than Measurement mode, which
  Apple documents as lower-output. Plan: Default while only playing, Measurement while recording. **Waiting on** a
  latency calibration in each mode on the speaker; the toggles are on the Spike and Studio screens.
- **Knob extremes, heard on the JBL (Eyal, 2026-11-07): knobs now audible, two notes, deferred (not a gate item; the
  A/B uses the default knobs).**
  - Punch 100: big low end that distorts as the volume goes up. Measured (Loud master): Punch 100 raises the kick by
    3.9 LU, and the master clips 13.6 dB off the peaks (Boom Bap; default 10.7) / 10.6 dB (Trap; default 6.8). Candidate
    fix: gain-compensated Punch (same attack/tail contrast, no level rise). First check: does Streaming at Punch 100 still
    distort with the speaker turned up? If yes, it's the speaker.
  - Space 100: "maybe echoes on the hats, maybe just reverb". Measured: the reverb, not the delay (snare reverb tail
    6.5 LU under the dry snare; delay 14.4 LU under), with a 4–6 s decay in a 50–60 ms room. Candidate fix: Space grows
    the room, not only the decay.
- **Export has no tail.** The file stops hard at bar 8, so reverb and delay are cut. Planned with the P5 export work.
- **Saturation latency** of 0.3–0.7 ms is not compensated. It's inaudible next to the 17 ms round trip, but it is
  not zero.
- **Silent channel strips** still pass briefly through subnormal values after each tail on web. Not measured on x86.
- **CI doesn't compile the iOS JSI binding** (`engine/rn/GfEngineNode.h`). It is built on every device install.
- The kit's claps were downmixed to mono. The engine assumes a single control thread.

## What I'd carry into Phase 2

- Calibrate per session mode and settle the mode switch first, because Phase 2 records a lot of takes.
- Golden takes: Eyal's 10 real recordings are still pending from Phase 0, and Phase 2's scores depend on them.
- Retune the mix from the A/B results and Eyal's speaker notes before Phase 3 builds the real Studio on top of it.
