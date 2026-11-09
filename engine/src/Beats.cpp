#include "gf/Beats.h"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace gf {
namespace {

constexpr double kMinBpm = 50, kMaxBpm = 220;
constexpr double kPriorOctaves = 0.5;  // σ of the tempo prior, in octaves
constexpr double kTightness = 400;     // how strongly beats keep the period

/**
 * The tempo (BPM) whose period best repeats the envelope, under the prior. Each candidate period scores its
 * autocorrelation plus that at 2, 3 and 4 periods (a comb): the beat repeats every beat and every bar, while a
 * syncopated kick's spacing (5 sixteenths, say) doesn't line up with the bar.
 */
double estimateTempo(const std::vector<double>& e, double fps, double centreBpm) {
  constexpr int kComb = 4;
  const int n = static_cast<int>(e.size());
  const int lo = static_cast<int>(std::floor(60 * fps / kMaxBpm)), hi = std::min(n - 1, static_cast<int>(std::ceil(60 * fps / kMinBpm)));
  if (hi <= lo + 2) return 0;
  const double mean = std::accumulate(e.begin(), e.end(), 0.0) / n;
  const int maxLag = std::min(n - 1, kComb * (hi + 1));
  std::vector<double> r(maxLag + 1, 0.0);
  for (int l = 1; l <= maxLag; ++l) {  // unbiased autocorrelation of the mean-removed envelope
    double s = 0;
    for (int t = 0; t + l < n; ++t) s += (e[t] - mean) * (e[t + l] - mean);
    r[l] = s / (n - l);
  }
  int best = -1;
  double bestScore = 0;
  for (int l = lo; l <= hi; ++l) {
    double comb = 0;
    for (int k = 1; k <= kComb && k * l <= maxLag; ++k) comb += r[k * l];
    const double octaves = std::log2(60 * fps / l / centreBpm) / kPriorOctaves;
    const double score = comb * std::exp(-0.5 * octaves * octaves);
    if (r[l] > r[l - 1] && r[l] >= r[l + 1] && score > bestScore) bestScore = score, best = l;
  }
  if (best < 0) return 0;
  const double a = r[best - 1], b = r[best], c = r[best + 1], den = a - 2 * b + c;  // parabola through the peak
  const double lag = best + (den < 0 ? 0.5 * (a - c) / den : 0);
  return 60 * fps / lag;
}

}  // namespace

Beats trackBeats(const std::vector<float>& envelope, double frameRate, double centreBpm, const std::vector<double>& onsets,
                 const std::vector<float>& accent) {
  Beats out;
  const int n = static_cast<int>(envelope.size());
  if (n < 4) return out;
  // envelope scaled to unit spread (librosa normalises onset strength by its standard deviation)
  std::vector<double> e(envelope.begin(), envelope.end());
  const double mean = std::accumulate(e.begin(), e.end(), 0.0) / n;
  double var = 0;
  for (double v : e) var += (v - mean) * (v - mean);
  const double sd = std::sqrt(var / n);
  if (sd <= 0) return out;
  for (double& v : e) v /= sd;

  const double bpm = estimateTempo(e, frameRate, centreBpm);
  if (bpm <= 0) return out;
  const double period = 60 * frameRate / bpm;
  if (accent.size() == envelope.size()) {  // beats sit where the accented (loud) hits are
    for (int t = 0; t < n; ++t) e[t] *= accent[t];
    if (*std::max_element(e.begin(), e.end()) <= 0) return out;
  }

  // local score: the envelope smoothed by a Gaussian of σ = period / 32 (librosa)
  const int half = static_cast<int>(std::round(period));
  std::vector<double> win(2 * half + 1), local(n, 0.0);
  for (int i = -half; i <= half; ++i) win[i + half] = std::exp(-0.5 * std::pow(i * 32.0 / period, 2));
  for (int t = 0; t < n; ++t)
    for (int i = -half; i <= half; ++i)
      if (t + i >= 0 && t + i < n) local[t] += win[i + half] * e[t + i];

  // dynamic programming: cumulative score with the best previous beat 0.5–2 periods back
  std::vector<double> cum(n, 0.0);
  std::vector<int> back(n, -1);
  // no beat before the first hit (librosa: where the local score first passes 1 % of its max), nor linked to one
  const double maxLocal = *std::max_element(local.begin(), local.end());
  int first = 0;
  while (first < n && local[first] <= 0.01 * maxLocal) ++first;
  for (int t = first; t < n; ++t) {
    double best = 0;
    int from = -1;
    for (int tau = std::max(first, t - static_cast<int>(std::round(2 * period))); tau <= t - static_cast<int>(std::round(period / 2)); ++tau) {
      const double score = cum[tau] - kTightness * std::pow(std::log((t - tau) / period), 2);
      if (from < 0 || score > best) best = score, from = tau;
    }
    cum[t] = local[t] + (from >= 0 ? best : 0);
    back[t] = from;
  }

  // the last beat: the best cumulative score within the last period of hits (Ellis 2007), not merely the latest peak
  // (that is often the final off-beat hat, which drags the end of the chain off the grid)
  int end = n - 1;
  while (end > first && local[end] <= 0.01 * maxLocal) --end;
  if (end <= first) return out;
  int last = end;
  for (int t = std::max(first, end - static_cast<int>(std::round(period))); t <= end; ++t)
    if (cum[t] > cum[last]) last = t;

  std::vector<int> beats;
  for (int t = last; t >= 0; t = back[t]) beats.push_back(t);
  std::reverse(beats.begin(), beats.end());

  // trim beats without hits around them at either end: below half the RMS of the local score at the beats, smoothed
  // by a 5-point Hann ([0, ½, 1, ½, 0], 'same' convolution: the ends see fewer neighbours, as in librosa)
  std::vector<double> smooth(beats.size(), 0.0);
  for (size_t i = 0; i < beats.size(); ++i) {
    smooth[i] = local[beats[i]];
    if (i > 0) smooth[i] += 0.5 * local[beats[i - 1]];
    if (i + 1 < beats.size()) smooth[i] += 0.5 * local[beats[i + 1]];
  }
  double rms = 0;
  for (double v : smooth) rms += v * v;
  const double threshold = 0.5 * std::sqrt(rms / std::max<size_t>(1, smooth.size()));
  size_t a = 0, b = beats.size();
  while (a < b && smooth[a] < threshold) ++a;
  while (b > a && smooth[b - 1] < threshold) --b;

  // onto the hits: the envelope's frames peak a little before an attack, so a beat with a refined onset within 40 ms
  // takes its time; beats without one shift by the median of those corrections
  std::vector<double> shifts;
  std::vector<double> snapped;
  for (size_t i = a; i < b; ++i) {
    const double t = beats[i] / frameRate;
    double near = 1e9;
    for (double o : onsets)
      if (std::fabs(o - t) < std::fabs(near - t)) near = o;
    snapped.push_back(std::fabs(near - t) <= 0.04 ? near : NAN);
    if (std::fabs(near - t) <= 0.04) shifts.push_back(near - t);
  }
  double shift = 0;
  if (!shifts.empty()) {
    std::nth_element(shifts.begin(), shifts.begin() + shifts.size() / 2, shifts.end());
    shift = shifts[shifts.size() / 2];
  }
  for (size_t i = a; i < b; ++i) out.times.push_back(std::isnan(snapped[i - a]) ? beats[i] / frameRate + shift : snapped[i - a]);
  if (out.times.size() >= 2) {
    std::vector<double> gaps;
    for (size_t i = 1; i < out.times.size(); ++i) gaps.push_back(out.times[i] - out.times[i - 1]);
    std::nth_element(gaps.begin(), gaps.begin() + gaps.size() / 2, gaps.end());
    out.bpm = 60 / gaps[gaps.size() / 2];
  }
  return out;
}

}  // namespace gf
