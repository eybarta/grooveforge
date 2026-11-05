# Kickoff prompt — paste this into Claude Code

> Setup first: unzip this pack into the root of the `grooveforge` repo (it adds `CLAUDE.md` and `docs/`), commit it on a new branch `v2`, then start Claude Code in the repo and paste everything below the line.

---

You're the lead engineer on **GrooveForge 2.0**: a hip-hop loop station you play with your mouth. Beatbox + hum → drums and an 808 bassline that loop; sing over it → melodies become swappable synths; stack layers; export a studio-grade track.

**Read first, in this order:**
1. `CLAUDE.md` — decisions, architecture rules, design system, quality bar, how to work. Treat the "Decisions" section as settled.
2. `docs/BUILD_PLAN.md` — pipeline, UX flow, phases with gates.
3. `docs/design/` — mockup source for Record, Forging and Studio (HTML with inline styles; read it for layout, tokens and copy). Live canvas: https://claude.ai/artifact/ERzfzCwqDLBTd37q2f2H4k
4. `docs/motion/` — `forge-transition.mp4` plus `forge-film/film.html`, the exact timeline (springs, stagger, timings at 112 BPM) for the Forge transition. Look at `stills/` too.
5. The existing POC under `src/` — reference only; we're rebuilding, not extending.

**This session's job: Phase 0 (Foundation + audio spike).** Use plan mode first and show me the plan before writing code.

1. Scaffold a new Expo app (New Architecture, Expo Router, TypeScript strict) on branch `v2`. Move the POC's `src/lib/audio/*` into `reference/poc-audio/` and delete the Grok scaffolding (auth, app-data, multiplayer, preview bridge, grok scripts, PGlite, better-auth).
2. **Audio spike — the most important task.** Build a tiny test screen that, on a real iPhone, a mid-range Android, and web:
   - plays a 2-bar loop while recording the mic (headphones),
   - measures round-trip latency and shifts the recorded take by it,
   - renders the loop offline to a 48 kHz WAV,
   - runs one custom DSP effect written in C++ (native via JSI, web via WASM in an AudioWorklet).
   Use react-native-audio-api on native. If it can't do any of the above, stop and report what failed and 2–3 alternatives with trade-offs — don't switch on your own.
3. C++ engine skeleton shared by all three platforms, with one voice playing through it.
4. `Song` / `Track` / `NoteEvent` types and the zustand store, following the rules in `CLAUDE.md`.
5. Golden-test harness: folder for 10 labelled takes (WAV + JSON), a scorer for onset F1 and class accuracy, wired into CI. I'll record the takes; generate 2 synthetic ones so the harness runs now.

**Gate — stop and report when done:** a short spike report (what worked per platform, latency in ms per device, any blockers), how to run each platform, and what you'd change in the plan. Don't start Phase 1 until I say go.

Ask me if anything in the docs contradicts itself. Keep commits small.
