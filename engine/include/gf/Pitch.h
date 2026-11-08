#pragma once
// Pitch tracking for the hummed 808 line (Phase 2). Control thread / worker: allocates.
#include <vector>

namespace gf {

/** One pitch frame every kPitchHop input samples (10.7 ms at 48 kHz), centred on hop × k. */
constexpr int kPitchHop = 512;
/** The range a hum is looked for in: G1 … G5. */
constexpr float kPitchMinHz = 50.f, kPitchMaxHz = 800.f;

/**
 * pYIN (Mauch & Dixon 2014; parameters as librosa.pyin, ISC): YIN's cumulative mean normalised difference on the
 * signal decimated to ~12 kHz, pitch candidates weighted over a Beta(2, 18) distribution of thresholds, then a
 * Viterbi path through voiced/unvoiced pitch states (¼-semitone bins). Returns n / kPitchHop + 1 frames: Hz, or 0 where
 * the path is unvoiced.
 */
std::vector<float> pyin(const float* x, int n, float sampleRate);

}  // namespace gf
