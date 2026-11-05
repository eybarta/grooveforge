# Forge transition — motion spec (112 BPM, beat = 0.536 s, 14 beats = 7.5 s)

Phone frame 390×844 (rendered at 2×). No audio: this is a motion reference for Reanimated + Skia.

| Beat | What happens | Made from |
| --- | --- | --- |
| 0–2 | Recording: waveform ribbon breathes, hits glow in lane colours, label "RECORDING · BAR 4 OF 4" | waveform bars |
| 2 | Stop tap: record button dips (spring) | record button |
| 2.5–3.5 | Button morphs into the progress bar; label swaps to "FORGING YOUR BEAT" (masked rise) | record button → progress bar |
| 2.5–4 | Non-hit bars collapse to nothing; hit bars shrink into lane-shaped dots (● kick, ◆ snare, ■ hat); empty grid rises in | bars → dots |
| 4–7.5 | Dots fly on spring arcs, left to right in time order, and land in their grid cells, each flashing on landing | dots → cells |
| 8, 9, 10 | Status lines rise in: tempo, swing, hits | text |
| 10–14 | Light-beam playhead sweeps one bar; each lit cell pulses as the beam passes; progress bar resolves to "Ready" | beam |

Rules for the implementation: one object turns into the next (never a fade between screens); springs z ≈ 0.8; flight stagger follows the order the hits were played; every flash decays exponentially (≈ 6/s).
