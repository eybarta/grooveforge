# Phase 0 audio spike: gate report

Date: 2026-11-06 · Branch `v2` · CI green · Scope: **iOS + web** (Android deferred by Eyal on 2026-11-06).

**Verdict: react-native-audio-api 1.0.0 passes on iOS; the Web Audio + WASM path passes on web.** No library switch needed.
Every requirement was met on real hardware. The one open item is the wired route (no USB-C earphones to hand).

## Stack under test
Expo SDK 58 (RN 0.88.1, New Architecture) · react-native-audio-api **1.0.0** (pinned) · shared C++20 engine
`engine/`: JSI `AudioNode` on iOS, standalone WASM (26 KB, Emscripten 6.0.13) in an AudioWorklet on web.

## Results per requirement

| Requirement | Web (Brave on MacBook Pro) | iPhone 16 Pro, iOS 27.2 |
| --- | --- | --- |
| C++ engine plays a voice through it | ✅ worklet + WASM | ✅ JSI `GfEngineNode` |
| Custom C++ DSP effect (Drive) | ✅ output changes (mean abs 0.038 → 0.217) | ✅ live 0 ↔ 1: clean ↔ fuzzy/louder (confirmed by ear) |
| Loop plays while recording | ✅ real time (ratio 0.9998 over 25 s) | ✅ real time, speaker + Bluetooth (0.999–0.9998) |
| Round-trip latency measured + take shifted | ✅ 66.8 → 77.3 ms (see note), residual 0 ms when fresh | ✅ speaker ≈ 17.0 ms, Bluetooth 366–369 ms; residual 0–0.94 ms |
| Offline render → 48 kHz WAV | ✅ 256 000 frames, bit-matches host render, 15 ms | ✅ audio-api `OfflineAudioContext`, matches host, 64 ms |

### Latency per device (measured round trip vs what the OS/browser reports)

| Device / route | Measured RTL | Repeatability | Residual after shift | OS-reported | Under-report |
| --- | --- | --- | --- | --- | --- |
| iPhone 16 Pro · speaker + built-in mic | **≈ 17.0 ms** (16.85–17.23 over 3 sessions) | ≤ 0.35 ms | 0–0.40 ms | 18.4 ms | (over by ~1 ms) |
| iPhone 16 Pro · Bluetooth A2DP (Monster XKT15) + built-in mic | **366–369 ms** (drifts ~3 ms per session) | ≤ 0.33 ms | 0.94 ms; shifted take in time by ear | 321.8 ms | **~45–48 ms** |
| iPhone 16 Pro · wired | not tested (needs a USB-C earphone/adapter) | | | | |
| Web · Brave/Chromium 156, MacBook Pro speakers + mic | **66.8 ms, then 77.3 ms** (one-buffer step) | 0 ms within a calibration | 10.5 ms with a stale calibration; 0 ms after recalibrating | 35.0 ms | **~32–42 ms** |

Method: the engine captures its own output and the mic on one frame clock. The calibration loop plays 8 clicks
(2.6 kHz, 4 ms) per run, 3 runs. Per-click normalised cross-correlation gives the lag; clicks scoring < 0.5 are dropped.
A run needs ≥ 6 clear clicks to count as reliable. Verify shifts a fresh take by the RTL and re-measures (target ≤ 1 ms).

## Findings

1. **Measured latency is non-negotiable.** iOS under-reports Bluetooth by ~48 ms and the browser under-reports by
   32–42 ms. Shifting takes by OS figures would misalign every Bluetooth/web take by more than the ±30 ms onset window.
2. **Latency is not constant:**
   - iPhone speaker: stable (< 0.4 ms across sessions).
   - Bluetooth: drifts ~3 ms between sessions.
   - Web: stepped up by one buffer (10.5 ms ≈ 505 samples) mid-session and stayed there.
   - The first iPhone session after install was off by 5 ms with weak clicks; the reliability check now catches that.
3. **Visual sync:** CLAUDE.md's "audio clock − output latency" would put Bluetooth visuals ~48 ms early and web ~30 ms early.
4. **audio-api processes nodes in place** (input buffer = output buffer); the engine now reads input before writing output.
5. **wavefile 11.0.0 bug:** its float→int converter uses `parseInt`, so `9e-9` becomes 9 LSB (−71 dBFS noise in 16-bit
   fades). We quantise ourselves and keep wavefile for the container and for reading.
6. audio-api's web build has no recorder / worklet / custom node, so web uses Web Audio directly (as planned).
7. Docs drift: the audio-api custom-node guide shows a pre-1.0 API; the shipped `StableAPI.h` headers are the truth.
8. iOS dev builds need `NSLocalNetworkUsageDescription`, otherwise the app can't reach Metro.
9. Mic AGC is off by design, so take levels vary (−9 to −16 dBFS here) and close plosives come in hot.
10. Toolchain: Expo 58 needs Xcode ≥ 26.4 (now 27.2). Installed via Homebrew: Emscripten 6.0.13, ninja, CocoaPods 1.17.

## What I'd change in the plan (for Eyal's OK)
1. **Drop the "Expo native module for audio session / latency" decision.** audio-api's `AudioManager` already covers
   session category/mode/options, permissions and the current route. Latency has to be *measured*, and that lives in our
   engine + TS, not in a native module.
2. **Make calibration a product feature, not a setup step:**
   - measure per route;
   - re-calibrate automatically on route change;
   - quick re-verify at the start of each Bluetooth session;
   - on web, watch the mic track's latency stats (`MediaStreamTrack` audio stats) for buffer steps, and re-check before a take.
   Put it in P2 (capture) with UX in P3.
3. **Visual sync from the measured RTL** (minus a small input share) instead of OS `outputLatency`; update the CLAUDE.md rule.
4. **De-risk the audio clock → UI thread path early (start of P1).** Reanimated visuals need the engine's frame counter on
   the UI thread, and the spike didn't cover it. That's the next-biggest unknown.
5. **Engine events need a lock-free swap in P1:** `setEvents` is refused while playing, but live editing needs it.
6. **Input meter + clip warning + −3 dBFS normalisation** in the capture step (already in BUILD_PLAN; confirmed needed).
7. **Golden takes:** record them with the spike's "Save last take" (already latency-shifted) on the iPhone, then label.
   I can add an Audacity-labels → JSON converter.
8. The live Build Plan doc (claude.ai artifact) is stale vs `docs/BUILD_PLAN.md`; update or archive it.

## How to run
See README → "How to run" (tests, web, iPhone). On the phone: spike screen → Route chip → 2 Calibrate → 3 Verify
shift → 4 Render WAV → 1 Loop + record → Play take + loop. Results show on screen and print to Metro / the browser console.
After code changes, force-close and reopen the app (hot reload keeps the old audio object).
