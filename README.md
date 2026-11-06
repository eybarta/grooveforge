# GrooveForge 2.0

A hip-hop loop station you play with your mouth. Rebuild in progress on branch `v2`. See `CLAUDE.md` and `docs/BUILD_PLAN.md`.
The GrooveForge 1 proof-of-concept is on `main`; its audio code is kept for reference in `reference/poc-audio/`.

## Layout
- `src/app/`: screens (Expo Router). `/spike` is the Phase 0 audio spike.
- `src/song/`: Song / Track / NoteEvent model + zustand store.
- `src/audio/`: platform audio (`spike.web.ts` = Web Audio + WASM, `spike.native.ts` = react-native-audio-api), latency, WAV.
- `engine/`: the shared C++ engine; also the autolinked `gf-engine` native package (podspec, Android CMake, JSI node).
- `golden/`: labelled takes + scoring harness (see `golden/README.md`).

## Setup (macOS)
Node 24+, Xcode ≥ 26.4, then: `brew install emscripten ninja cocoapods` and `npm install`.

## How to run
| Target | Command |
| --- | --- |
| Tests | `npm test` (Vitest) · `npm run test:engine` (C++ ctest) |
| Web | `npm run build:wasm` then `npm run web` → open `/spike` in Chrome or Safari |
| iPhone | plug in the phone (Developer Mode on), then `npm run ios -- --device` |
| Android | Android SDK + JDK 17, USB debugging on, then `npm run android -- --device` |

Device logs (the spike's `[spike]` JSON lines) appear in the Metro terminal.
Headless check: `EXPO_PUBLIC_SPIKE_AUTO=render npx expo start` makes the app open `/spike` and run the offline render.
