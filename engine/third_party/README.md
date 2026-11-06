# Vendored third-party code

Copied unmodified. Update by re-copying from the tagged release and re-running `npm run test:engine`.

| Library | Version | Licence | Source | What we use |
| --- | --- | --- | --- | --- |
| Signalsmith DSP | v1.7.3 (`ca390d28c41ea5108a528e2e81faa4088f2f8ac8`) | MIT (`signalsmith-dsp/LICENSE.txt`) | https://github.com/Signalsmith-Audio/dsp | biquads, delay buffers, envelopes, `Oversampler2xFIR` (all headers copied; they include each other) |
| Signalsmith Basics | 1.2.1 (`369e906e03760ec219d07b06fa06dc4fd099f377`) | MIT (`signalsmith-basics/LICENSE.txt`) | https://github.com/Signalsmith-Audio/basics | `crunch.h` (oversampled ADAA saturation), `dynamics.h` (compressor), `reverb.h` (FDN reverb), `limiter.h`, `stfx/stfx-library.h` |
