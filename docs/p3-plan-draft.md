# Phase 3 · Neon UI: plan draft (not started; waiting for Eyal's OK and the P1 gate)

BUILD_PLAN: P3 runs in parallel with P2 (weeks 5–8). **Gate:** 60 fps on a mid-range phone during playback, and the
Forge transition matches the spec video side by side. Until Android returns, that means the iPhone (optimistic) and web.

## Inputs (read for this draft)

- **Mockups** (`docs/design/`, 390×844; the live canvas "GrooveForge Neon UI"):
  - Record: orb, timer, "Click 96 BPM", "Kit taught ✓", lane counters ● kick / ▲ snare / ■ hat / ◆ perc;
  - Forging;
  - Studio: song title, "112 BPM · A minor · swing 58% · −14 LUFS", lane grid, knobs, an amber "not sure what you
    played: tap to fix" mark, "Your mouth ⇄ Studio", Export.
- **Motion** (`docs/motion/`):
  - the film is 14 beats at 112 BPM (7.5 s) and `forge-film/film.html` is a pure `seek(t)`;
  - rules: one object turns into the next, springs at damping ratio ≈ 0.8, flight order = play order, flashes decay at ≈ 6/s;
  - stills at t = 0.6 / 1.75 / 2.9 / 3.6 / 4.9 / 6.6 s.
- **Tokens:**
  - ground `#07060B`; glass `rgba(255,255,255,.04)` with a 1 px `.08` border;
  - text `#F4F1FF`, muted `#CFC8E8` / `#A69DC4`;
  - lanes: kick `#FF2BD6`, snare `#00E5FF`, closed hat `#C6FF3D`, open hat `#FFB020`, perc `#8B5CFF`, bass `#FF5A1F`;
  - type: Unbounded, Figtree, JetBrains Mono.
- **Already built:**
  - the audio clock on the UI thread (`engine.clock`, a worklet-readable C++ atomic);
  - `LoopBeam` with its fps / dropped-frame / jitter stats (`ClockStats`);
  - the measured output latency;
  - lock-free song/mix swaps, so knobs and edits are live.

## Dependencies (SDK 58 versions, checked in `node_modules/expo/bundledNativeModules.json` and npm)

| Package | Version | Why | Cost |
| --- | --- | --- | --- |
| `@shopify/react-native-skia` | 2.14.0 | Everything that glows (CLAUDE.md decision): orb shader, sparks, grid, beam | Native: an iOS rebuild. **Web: CanvasKit 0.41.0 is 7.2 MB (2.9 MB gzip, 2.2 MB brotli), measured**; it loads before the first Skia frame |
| `@expo-google-fonts/unbounded`, `/figtree`, `/jetbrains-mono` | 0.4.1 | The three faces, loaded by `expo-font` (installed) | A few hundred KB of font files |
| `expo-haptics` (optional) | ~58.0.7 | Record / stop feedback | Small |

## Steps (one small commit each; device check after each visible step)

1. **Tokens + type:**
   - `src/ui/theme.ts`: colours, lanes with their shapes, spacing, radii, type scale and motion constants (spring
     ratio 0.8, flash decay 6/s);
   - fonts load in the root layout;
   - reduced motion follows Reanimated's `useReducedMotion`.
2. **Primitives:**
   - glass surface; button and chip (≥ 44 px, accessibility labels);
   - lane mark (colour plus shape); mono stat row.
3. **One Skia canvas per surface:** the 16 × lanes grid, cell flashes and the beam are drawn in a single `Canvas`
   driven by shared values: one draw call per frame, not one view per cell. This is the main 60 fps decision.
4. **Studio screen** (testable today with P1's engine):
   - header; grid on the audio clock;
   - Mood, Punch, Space and Loudness wired live; Export;
   - Quantize / Swing / Humanize and "Your mouth ⇄ Studio" appear once P2 produces takes.
   - The P1 benches move to `/dev/*`.
5. **Record screen:**
   - the orb is a Skia `RuntimeEffect`, driven by the mic level, which needs a small engine addition: an input-level
     atomic next to the clock;
   - count-in rings; sparks per hit (P2 onsets; until then the demo groove).
6. **Forge transition:**
   - port `film.html`'s timeline as a pure function of `(song, t)`, with Reanimated springs at stiffness = ω²
     (BEATMAP note);
   - real hits come from P2, the demo groove until then.
   - **Verification:** capture the app at the six still times and compare object positions with `docs/motion/stills`,
     then a side-by-side video with `forge-transition.mp4`.
7. **Measure:** fps, dropped frames and jitter during playback on the iPhone and in the browser (`ClockStats`), with
   Studio and Record open; check reduced-motion; report.

## Questions for Eyal

1. OK to add Skia 2.14.0 (including the ~2–3 MB compressed CanvasKit download on web) and the three font packages?
2. Order: Studio first (it uses everything P1 built and can be tested today), then Record and Forge, which need P2's
   take pipeline for real data?
3. P2 (accurate ears) and P3 run in parallel in the plan. Which do you want first after the P1 gate?
