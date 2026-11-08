# Phase 3 · Neon UI: gate report

Date: 2026-11-08 · Branch `v2` · CI green · Scope: **iOS + web** (Android deferred).

**Status: passed, approved by Eyal 2026-11-08** ("Amazing much better! Let's move on"). The iPhone and Brave hold
120 fps during playback; the forge follows the motion spec as one continuous Record → Forge → Studio screen.

## Gate

| Gate item | Target | Result |
| --- | --- | --- |
| Animations during playback | 60 fps on a mid-range phone (iPhone 16 Pro until Android returns: optimistic) | ✅ iPhone: **120 fps, 0 dropped frames** in every 5 s window (Studio playing after a recorded take). ✅ Brave (Mac): **120 fps**, 1 dropped frame in the first 10 s, then 0 |
| Forge vs spec video | matches side by side | The film's motion, ported exactly: stills SSIM **0.94–0.96**. The shipped flow keeps its timing, springs and flight order on the app's real screens (Eyal's call, below) |

### Frame timing on the iPhone (Studio playing, after Record → Forge)

| 5 s window | fps | dropped | raw clock spread | drawn (smoothed) clock spread |
| --- | --- | --- | --- | --- |
| 1 (just after Play) | 119.98 | 0 | 13.7 ms | 1.9 ms |
| 2 | 120.18 | 0 | 5.4 ms | 0.9 ms |
| 3 | 120.18 | 0 | 5.2 ms | 0.7 ms |

### Brave on the Mac (Studio playing)

| 5 s window | fps | dropped | raw clock spread | drawn clock spread |
| --- | --- | --- | --- | --- |
| 1 (start: the web clock waits for the engine's start frame, then snaps once) | 107.8 | 1 | 23.7 ms | 23.5 ms |
| 2 | 119.4 | 1 | 4.7 ms | 0.9 ms |
| 3 | 120.2 | 0 | 4.2 ms | 0.7 ms |
| 4 | 120.2 | 0 | 2.9 ms | 0.7 ms |
| 5 | 120.2 | 0 | 3.9 ms | 1.0 ms |

The beam draws the smoothed clock, so what you see moves within ~1 ms of a perfect line. The raw spread is how
unevenly the engine's clock reads arrive (audio buffers); it settles after the first seconds.

### The forge against the spec

- **The port:** `/dev/forge` is `docs/motion/forge-film/film.html`'s `seek(t)`, ported line for line onto one Skia
  canvas: the same analytic springs (`src/ui/motion.ts`, tested against the oscillator equation), the same 390 × 844
  frame. Against `docs/motion/stills` (SSIM, 1 = identical):

  | t | 0.6 s | 1.75 s | 2.9 s | 3.6 s | 4.9 s | 6.6 s |
  | --- | --- | --- | --- | --- | --- | --- |
  | SSIM | 0.959 | 0.964 | 0.964 | 0.956 | 0.953 | 0.936 |

  What's left is glow softness and font smoothing; positions and timing match.
- **What ships: one continuous screen** (Eyal, 2026-11-08, "B for both"). Record's orb design and the film's
  recording frame differ, and the film's 3-lane grid isn't the Studio's 6-lane grid, so the film couldn't be
  followed without two cuts. Now: Stop → the record button stretches into the progress bar, the orb sinks into it,
  the take's ribbon collapses and its hits fly as lane shapes, in play order, into the **real** Studio grid; the beam
  sweeps; the Studio's controls rise in. Timing is the film's (112 BPM beats from the Stop tap).
  Side by side with the spec, aligned at the Stop tap: `out/forge/flow-vs-spec.mp4`
  (`URL="http://localhost:8081/?forge=demo&t=0" SPEC_OFFSET=1.0714 node scripts/capture-forge.mjs video`).
  Pixel SSIM doesn't apply any more (different layout); the beats line up.
- **The orb becomes the bar** (Eyal's two rounds of notes on the iPhone: "clunky at the end", then "mutate it into
  the bar", then "smooth, natural, pixel-perfect"): the orb's shader works on a rounded box's distance field, so one
  shader draws the orb, every shape between and the progress bar; it lives on a full-screen layer, so nothing is
  handed over; it falls accelerating onto the record button, which dissolves into it, and the stretch starts with
  the fall's momentum (`springV`).

## What P3 built

| Screen / piece | |
| --- | --- |
| Design system | `src/ui/theme.ts`: colours, lane colour + shape (snare ◆, perc ▲ per CLAUDE.md where the mockups differ), Unbounded / Figtree / JetBrains Mono (six weights), spacing, motion constants |
| Record | Skia shader orb (the mockup's conic rim + glass disc; the halo follows the mic), count-in rings, sparks on level jumps, ribbon of the take, timer drawn from the audio clock. Engine: a mic peak meter next to the clock (`engine_test` covers it) |
| Forge | as above |
| Studio | one Skia picture per frame for the grid, beam and flashes; real buttons on top for taps and screen readers (rows 44 px); mood, Swing / Punch / Space / Loudness knobs, Export, sync calibration |
| Visual sync | every visual uses the **measured** output latency (calibrated RTL − reported input latency); uncalibrated, the OS figure with a visible "not measured" mark |
| Reduced motion | no spin, breath, sparks or flashes; the beam steps by 16ths; Stop goes straight to the Studio |

## Costs

| | |
| --- | --- |
| Skia on web | CanvasKit 7.7 MB raw · **3.2 MB gzip · 2.5 MB brotli**, cached after the first visit |
| Skia on iOS | Debug app 133.7 → 160.1 MB (+26.4 MB). Release (unsigned arm64 build): **68 MB on disk, 25.7 MB zipped**; Skia is linked into the 30 MB main binary (its exact share needs a Release build without it: not done) |
| Fonts | six TTF weights from `@expo-google-fonts` |

## Found and fixed

- **Two iPhone-only crashes** (worklets): a callback the React Compiler hoisted out of a UI-thread function, and two
  helpers that weren't marked as worklets. Web runs worklets on the JS thread, so neither showed there. Rule now:
  every function per-frame drawing calls is a module-level worklet, with no inline callbacks inside component
  worklets.
- The 25 s silence test needed a 60 s timeout on CI runners.

## Open items

- **A new take from the Studio**: after the forge, the only way back to Record is reopening the app (P2 defines
  takes 2…n).
- **The flying hits are the demo groove's** until P2 detects the real ones (the bars they come from are the take's).
- **"Your mouth ⇄ Studio", Quantize, Humanize, "Kit taught", the amber "not sure" marks**: P2.
- Calibration is in memory only; per-route persistence comes with P2's calibration feature.
- Open hat amber (#FFB020) is also the mockup's "not sure" colour: to settle before P2 shows those marks.
