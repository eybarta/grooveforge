# Vendored third-party code

Copied unmodified, except the local patch listed below. Update by re-copying from the tagged release, re-applying the patch
(unless upstream has fixed it) and re-running `npm run test:engine` and `npx vitest run src/audio/export.wasm.test.ts`.

| Library | Version | Licence | Source | What we use |
| --- | --- | --- | --- | --- |
| Signalsmith DSP | v1.7.3 (`ca390d28c41ea5108a528e2e81faa4088f2f8ac8`) | MIT (`signalsmith-dsp/LICENSE.txt`) | https://github.com/Signalsmith-Audio/dsp | biquads, delay buffers, envelopes, `Oversampler2xFIR` (all headers copied; they include each other) |
| Signalsmith Basics | 1.2.1 (`369e906e03760ec219d07b06fa06dc4fd099f377`) | MIT (`signalsmith-basics/LICENSE.txt`) | https://github.com/Signalsmith-Audio/basics | `crunch.h` (oversampled ADAA saturation), `dynamics.h` (compressor), `reverb.h` (FDN reverb), `limiter.h`, `stfx/stfx-library.h` |
| libebur128 | v1.2.6 (`67b33abe1558160ed76ada1322329b0e9e058b02`) | MIT (`libebur128/COPYING`) | https://github.com/jiixyj/libebur128 | `ebur128.c/.h` (+ its bundled `queue/sys/queue.h`, BSD-3-Clause, notice in the file): EBU R128 / BS.1770-4 integrated loudness and 4× true peak |

## Local patches

- `signalsmith-basics/reverb.h`, `reset()`: also `delay4.reset()`. Upstream (1.2.1, and `main` as of 2026-01-20) clears every
  other delay line but not `delay4`, so a reset left the last tail in it; in WASM (no flush-to-zero) that tail then held the
  output filters in subnormal floats forever. Covered by "silence after the music" in `src/audio/export.wasm.test.ts`.
