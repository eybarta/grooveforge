/**
 * The motion spec's pure-function-of-time helpers (docs/motion/forge-film/motion-core.js), as worklets so they run
 * per frame on the UI thread. `spring` is the analytic damped spring from rest: identical to Reanimated's
 * withSpring with stiffness = w², damping = 2·z·w, mass 1.
 */
export const clamp = (x: number, a = 0, b = 1) => {
  "worklet";
  return Math.min(b, Math.max(a, x));
};
export const lerp = (a: number, b: number, u: number) => {
  "worklet";
  return a + (b - a) * u;
};
export const prog = (t: number, t0: number, t1: number) => {
  "worklet";
  return clamp((t - t0) / (t1 - t0));
};
export const easeInOut = (u: number) => {
  "worklet";
  return u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
export const spring = (t: number, w = 12, z = 0.8) => {
  "worklet";
  if (t <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
};
/** The same spring, starting with velocity `v0` (units/s): a motion that carries on into it doesn't stop dead first. */
export const springV = (t: number, w: number, z: number, v0: number) => {
  "worklet";
  if (t <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w - v0) / wd) * Math.sin(wd * t));
};
export const smoothstep = (a: number, b: number, x: number) => {
  "worklet";
  const u = clamp((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
/** Piecewise [time, value] keys, eased in-out between them. */
export const track = (t: number, keys: [number, number][]) => {
  "worklet";
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!, [t0, v0] = keys[i - 1]!;
    if (t <= t1) return lerp(v0, v1, easeInOut(prog(t, t0, t1)));
  }
  return keys[keys.length - 1]![1];
};
