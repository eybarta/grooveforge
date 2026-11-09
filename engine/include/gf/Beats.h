#pragma once
// Tempo and beats of a take recorded without a click (P2 re-scope, 2026-11-09). Control thread / worker: allocates.
#include <vector>

namespace gf {

struct Beats {
  double bpm = 0;              // the take's tempo (median beat spacing); 0 if no beat was found
  std::vector<double> times;   // seconds, from the first beat with hits around it to the last
};

/**
 * Beats from an onset envelope (SuperFlux per frame, `frameRate` frames per second):
 * - tempo: autocorrelation of the envelope (summed at 1–4 periods, a comb), weighted by a log-normal prior around
 *   `centreBpm` (σ = ½ octave; the mood's typical tempo settles half vs double time), peak refined by a parabola;
 * - beats: dynamic programming (Ellis 2007, "Beat Tracking by Dynamic Programming"; parameters as librosa's
 *   beat_track, ISC): each beat maximises onset strength minus a penalty on log(interval / period)², so small tempo
 *   drift is followed; the last beat is the best score in the last period of hits; leading and trailing beats without
 *   hits are trimmed; a beat with one of `onsets` (refined hit times, s) within 40 ms moves onto it. With `accent`
 *   (a weight per frame, e.g. loudness), beats are placed on envelope × accent: tempo from every hit, phase from the
 *   loud ones.
 */
Beats trackBeats(const std::vector<float>& envelope, double frameRate, double centreBpm, const std::vector<double>& onsets = {},
                 const std::vector<float>& accent = {});

}  // namespace gf
