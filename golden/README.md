# Golden takes

Labelled beatbox recordings that score the analysis pipeline (onset F1 at ±30 ms, hit-class accuracy). CI runs
`golden/golden.test.ts` on every take and fails if the scores drop more than 0.005 below `baseline.json`.
The detector under test lives in `golden/detect.ts`.

Target: 10 real takes from Eyal + one "teach me your kit" session (+ the 2 synthetic takes from `npm run golden:make`).

## What to record (Phase 2)

Record in the app (dev build): Record → beatbox over the click → after the forge, **"dev: save this take for the
golden set"** at the bottom of the Studio. Calibrate sync first on that route (the Studio's sync line), so the saved
take is latency-aligned (otherwise its name ends in `-unaligned`). AirDrop the WAVs to the Mac.

| # | Mood | What | Route |
| --- | --- | --- | --- |
| 1–3 | Boom Bap | kick / snare / closed hats, steady | speaker |
| 4 | Boom Bap | with ghost notes and an open hat | speaker |
| 5 | Boom Bap | drums, then hum a bassline (same take) | speaker |
| 6–7 | Trap | kick / clap-snare / hats incl. fast "ts-ts-ts" rolls | speaker |
| 8 | Trap | drums + hummed 808 with slides | speaker |
| 9 | either | a noisy room (TV or street in the background) | speaker |
| 10 | either | anything | Bluetooth earbuds |
| teach | either | 5× each, in order: kick, snare, closed hat, open hat, rim/click, then 5 hummed notes | speaker |

## Labelling (correcting, not typing)

1. `npm run golden:prelabel -- <take.wav>` → `<take>.labels.txt` with the detector's guesses.
2. Audacity: open the WAV, *File → Import → Labels…* the `.labels.txt`, then fix it:
   - a **point label at each hit's attack**: `k` kick · `sn` snare · `hh` closed hat · `oh` open hat · `perc`
     (rim, click, clap, anything else);
   - a **region label over each hummed note**: `hum`, or `hum 36` with the MIDI note if you know it;
   - delete wrong guesses, add missed hits. Count-in clicks aren't hits: leave them unlabelled.
3. *File → Export → Export Labels*, then
   `npm run golden:import -- <take.wav> <exported labels.txt> [--name boombap-01] [--device "iPhone 16 Pro, speaker"]`
   → `golden/takes/<name>.{wav,json}`, checked the same way CI checks it. Tempo and count-in come from the app's file
   name.

Or send me the WAVs and the exported label files and I'll import them.

## Files

`golden/takes/<name>.wav` + `golden/takes/<name>.json`, same name. WAV: **48 kHz**, mono (first channel is used),
16/24-bit or float.

```json
{
  "version": 1,
  "performer": "eyal",
  "device": "iPhone 16 Pro, speaker",
  "bpm": 92,
  "countInSec": 2.609,
  "hits": [
    { "t": 2.612, "class": "kick" },
    { "t": 2.945, "class": "hatClosed" }
  ],
  "hum": [
    { "start": 3.10, "end": 3.75, "midi": 36 }
  ]
}
```

- `t`: seconds from the start of the WAV, where the hit **starts** (sorted ascending).
- `class`: `kick` · `snare` · `hatClosed` · `hatOpen` · `perc`.
- `hum`: hummed bass segments for the 808 tracker; `midi` optional; `hum: []` if there's no hum.
- `bpm`, `countInSec`: optional (app takes have both: bar 1 starts at `countInSec`).

## Commands

- `npm test`: scores all takes against `baseline.json`.
- `npm run golden:update`: re-baselines after an intentional improvement (commit the new `baseline.json`).
- `npm run golden:make`: regenerates the synthetic takes (deterministic).
- `npm run golden:prelabel` / `npm run golden:import`: above.
