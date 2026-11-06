#pragma once
// EBU R128 / ITU-R BS.1770-4 measurement (libebur128, engine/third_party): what the export loop targets.

namespace gf {

struct Loudness {
  double lufs;        // integrated loudness (−inf for silence)
  double truePeakDb;  // max over both channels, dBTP (4× oversampled)
};

/** Measures a stereo render (r may equal l). Control thread: allocates. */
Loudness measureLoudness(const float* l, const float* r, int frames, float sampleRate);

}  // namespace gf
