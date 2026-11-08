#pragma once
// Take analysis (Phase 2): harmonic/percussive split and drum-hit onsets. Control thread / worker: allocates.
#include <vector>

namespace gf {

/** STFT used throughout: 2048-point Hann (42.7 ms at 48 kHz), hop 256 (5.3 ms), frames centred on hop × n. */
constexpr int kStftSize = 2048;
constexpr int kStftHop = 256;

/**
 * What a hit sounds like, from its first 60 ms (or up to the next hit): 13 MFCCs (40 mel bands, 30 Hz–16 kHz),
 * log₂ spectral centroid, spectral flatness, decay (log energy 20–80 ms vs 0–20 ms), zero crossings per ms over
 * 30 ms, and low (< 300 Hz) vs high (> 3 kHz) energy. src/analysis/classify.ts compares these with the user's kit.
 */
constexpr int kHitFeatures = 18;

struct Onset {
  double time;     // seconds: where the hit starts (refined on the percussive waveform)
  float strength;  // SuperFlux peak height (relative loudness of the hit)
  float features[kHitFeatures];
};

struct TakeAnalysis {
  std::vector<float> percussive, harmonic;  // HPSS split of the (normalised) take; same length as the input
  std::vector<Onset> onsets;
  std::vector<float> f0;  // the hum: pYIN on the harmonic part (gf/Pitch.h), Hz per kPitchHop, 0 = unvoiced
};

struct AnalysisOptions {
  /**
   * What the engine played during the take: its output capture as captured, with the take already shifted by the
   * measured round trip (src/audio/latency.ts alignTake), so the two line up. The metronome bleeding into the mic is
   * subtracted from the take's spectrum, scaled per frequency by a least-squares fit, so clicks aren't hits even when
   * a real hit lands on one.
   */
  const float* reference = nullptr;
};

/**
 * HPSS by median filtering (Fitzgerald 2010; soft Wiener masks, so percussive + harmonic = the input), then
 * SuperFlux onsets on the percussive part (Böck & Widmer 2013: log-spaced filterbank, maximum filter across
 * frequency, flux against the frame μ = 2 hops back, adaptive peak picking), each refined to the attack on the
 * waveform. The take is normalised to −3 dBFS first; with `reference`, the engine's own sound is removed first.
 */
TakeAnalysis analyzeTake(const float* x, int n, float sampleRate, const AnalysisOptions& options = {});

}  // namespace gf
