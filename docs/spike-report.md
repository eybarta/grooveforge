# Phase 0 audio spike: report (in progress)

Status 2026-11-06: **web verified offline; iPhone verified on the speaker route; Bluetooth, a wired route
(needs a USB-C adapter), live web and Android are still to run.**
All device numbers come from the spike screen (`/spike`), logged as `[spike]` JSON via Metro.

## Stack under test
Expo SDK 58 (RN 0.88.1, New Architecture) · react-native-audio-api **1.0.0** (pinned) · shared C++20 engine
`engine/` → JSI `AudioNode` on iOS/Android, standalone WASM (26 KB, Emscripten 6.0.13) in an AudioWorklet on web.

## Results per requirement

| Requirement | Web (Chrome 156, Mac) | iPhone 16 Pro, iOS 27.2 | Android |
| --- | --- | --- | --- |
| C++ engine plays one voice | ✅ worklet + WASM | ✅ on device | written, not built (step 11) |
| Custom C++ DSP effect (Drive) | ✅ changes output (mean abs 0.038 → 0.217 at drive 1) | ✅ in the JSI node; audible A/B pending your ears | — |
| Offline render → 48 kHz WAV | ✅ 256 000 frames, **bit-matches host render**, 15 ms | ✅ audio-api `OfflineAudioContext`: **matches host**, 64 ms | — |
| Loop plays while recording | pending (needs mic permission + you) | ✅ speaker: callback real time (25.003 s audio / 25.025 s wall) | — |
| Round-trip latency measured + take shifted | pending | ✅ speaker: **≈ 17.0 ms**, residual after shift **0–0.4 ms** | — |

### iPhone 16 Pro latency (speaker + built-in mic, `measurement` mode, voice processing off)

| Session | RTL (median of 3 runs) | Run-to-run spread | Reliable (≥ 6 clear clicks/run) |
| --- | --- | --- | --- |
| 1 (first launch after install) | 22.17 ms | 0 ms | ✗: click match scores 0.06–0.33 |
| 2, phone on table | 16.96 ms | 0.04 ms | ✓ (scores 0.97–0.98) |
| 3, phone on table | 17.23 ms | 0.35 ms | ✓ (0.97) |
| 3, hand-held | 16.85 ms | 0 ms | ✓ (0.94–0.98) |

- OS-reported while running: output 12.4 + base 2.7 + input 3.3 = **18.4 ms** (reported 0 ms in session 1).
  Our measured value differs from it by up to 1.4 ms (and by 3.8 ms in the unreliable session 1).
- Bluetooth: pending. Wired: pending a USB-C earphone or adapter (the iPhone 16 has no 3.5 mm jack).

**Method:** the engine captures its own output and the mic on one frame clock. The calibration loop plays 8 clicks
(2.6 kHz, 4 ms). Per-click normalised cross-correlation gives the lag; clicks scoring < 0.5 are dropped. RTL is the median;
3 runs per calibration. Verify then shifts a fresh take by the RTL and re-measures (target ≤ 1 ms).

## What worked
- audio-api 1.0's extension contract (`StableAPI.h`, pure C++ TurboModule, autolinked like `react-native-audio-worklets`)
  hosts our engine without touching the library. `AudioRecorder.connect(ctx, node)` feeds the mic into our node.
- The same C++ produces identical samples on macOS (host test), WASM (Node + Chrome) and iOS arm64 (simulator + device).
- Capturing engine output next to the mic lets us play back "take + loop" sample-accurately, with no scheduling.

## Findings / blockers so far
1. **Toolchain:** Expo 58 needs Xcode ≥ 26.4 (upgraded to 27.2). Installed Emscripten 6.0.13, ninja and CocoaPods 1.17 via Homebrew.
2. **audio-api processes nodes in place** (input buffer = output buffer). The engine originally wrote output before
   reading the mic sample; fixed, with a test.
3. **wavefile 11.0.0 bug:** its float→int converter uses `parseInt(x * max)`, so tiny values like `9e-9` become 9 LSB.
   That's −71 dBFS noise in every 16-bit fade-out. We quantise ourselves and keep wavefile for the container and reading.
4. audio-api's **web build has no recorder / worklet / custom node**, so web talks to Web Audio directly (as planned).
5. Docs drift: the audio-api custom-node guide shows a pre-1.0 `AudioNode` API; the headers in the package are the truth.
6. **iOS dev builds need `NSLocalNetworkUsageDescription`**; without it the app can't reach Metro ("No script URL provided").
7. **First-launch session was unreliable** (session 1 above: 5 ms off, weak clicks, OS latencies reported as 0).
   Calibration now rejects weak clicks and flags unreliable runs; the product should re-calibrate on every route change.
8. A 55 Hz voice is inaudible on a phone speaker; the spike loop now also has an off-beat 2.4 kHz hat.
9. Mic AGC is off by design, so close-mic plosives come in hot. We need an input meter / clip warning and −3 dBFS
   normalisation before analysis (both already in BUILD_PLAN's capture step).

## How to reproduce
See README → "How to run". Spike screen: Route chip → 2 Calibrate → 3 Verify shift → 4 Render WAV → 1 Loop + record →
Play take + loop. Results stay on screen and print to Metro.
