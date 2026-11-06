# Phase 0 audio spike: report (in progress)

Status 2026-11-06: **web and the iOS build are verified offline; real-device runs (iPhone, then Android) are next.**
Numbers marked "pending" come from the spike screen (`/spike`) on real hardware, logged as `[spike]` JSON.

## Stack under test
Expo SDK 58 (RN 0.88.1, New Architecture) · react-native-audio-api **1.0.0** (pinned) · shared C++20 engine
`engine/` → JSI `AudioNode` on iOS/Android, standalone WASM (26 KB, Emscripten 6.0.13) in an AudioWorklet on web.

## Results per requirement

| Requirement | Web (Chrome 156, Mac) | iOS | Android |
| --- | --- | --- | --- |
| C++ engine plays one voice | ✅ worklet + WASM | ✅ builds and runs (simulator); device pending | written, not built (step 11) |
| Custom C++ DSP effect (Drive) | ✅ changes output (mean abs 0.038 → 0.217 at drive 1) | ✅ compiled into the node; live A/B on device pending | — |
| Offline render → 48 kHz WAV | ✅ 256 000 frames, **bit-matches host render** (mean abs 0.037653, peak 0.731704), 15 ms | ✅ via audio-api `OfflineAudioContext`: **matches host** (simulator, 26 ms) | — |
| Loop plays while recording (headphones) | pending (needs mic permission + you) | pending device | — |
| Round-trip latency measured + take shifted | pending | pending device (wired + Bluetooth) | — |

**Latency per device (ms):** pending. Method: the engine captures its own output and the mic on one frame clock;
8 clicks are played through the earbud held to the mic; per-click normalised cross-correlation → RTL = median,
repeatability = spread over 3 runs; then the take is shifted and re-measured (target residual ≤ 1 ms). The OS-reported
latencies (`outputLatency`, `baseLatency`, `inputLatency`) are logged next to it.

## What worked
- audio-api 1.0's extension contract (`StableAPI.h`, pure C++ TurboModule, autolinked like `react-native-audio-worklets`)
  hosts our engine without touching the library. `AudioRecorder.connect(ctx, node)` feeds the mic into our node.
- The same C++ produces identical samples on macOS (host test), WASM (Node + Chrome) and iOS arm64 (simulator).

## Findings / blockers so far
1. **Toolchain:** Expo 58 needs Xcode ≥ 26.4 (upgraded to 27.2). Installed Emscripten 6.0.13, ninja and CocoaPods 1.17 via Homebrew.
2. **audio-api processes nodes in place** (input buffer = output buffer). The engine originally wrote output before
   reading the mic sample; fixed, with a test.
3. **wavefile 11.0.0 bug:** its float→int converter uses `parseInt(x * max)`, so tiny values like `9e-9` become 9 LSB.
   That's −71 dBFS noise in every 16-bit fade-out. We quantise ourselves and keep wavefile for the container and reading.
4. audio-api's **web build has no recorder / worklet / custom node**, so web talks to Web Audio directly (as planned).
5. Docs drift: the audio-api custom-node guide shows a pre-1.0 `AudioNode` API; the headers in the package are the truth.

## How to reproduce
See README → "How to run". Spike screen: Route chip → 1 Loop + record → 2 Calibrate (earbud on the mic) → 3 Verify
shift → 4 Render WAV. Results stay on screen and print to Metro.
