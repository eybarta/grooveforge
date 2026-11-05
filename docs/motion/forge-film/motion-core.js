// motion-core.js — pure-function-of-time helpers for seek(t) films. Everything lives on window.M.
(() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const prog = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
  const ease = {
    linear: u => u,
    inOut: u => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    out: u => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.pow(1 - u, 3)),
    in: u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u),
    outExpo: u => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  };
  const spring = (t, w = 12, z = 0.8) => {
    if (t <= 0) return 0;
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  };
  const springs = (t, keys, w = 12, z = 0.8) => {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], w, z);
    return v;
  };
  const track = (t, keys, fn = ease.inOut) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i], [t0, v0] = keys[i - 1];
      if (t <= t1) return lerp(v0, v1, fn(prog(t, t0, t1)));
    }
    return keys[keys.length - 1][1];
  };
  const logLerp = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u));
  const camera = (t, keys, W, H, fn = ease.inOut) => {
    let k0 = keys[0], k1 = keys[0], u = 0;
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) { k0 = keys[i - 1]; k1 = keys[i]; u = fn(prog(t, k0[0], k1[0])); break; }
      k0 = k1 = keys[i];
    }
    const z = logLerp(k0[1], k1[1], u), x = lerp(k0[2], k1[2], u), y = lerp(k0[3], k1[3], u);
    return { z, x, y, css: `translate(${W / 2}px,${H / 2}px) scale(${z}) translate(${-x}px,${-y}px)` };
  };
  const floodRadius = (u, cx, cy, W, H) => {
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
    return far * 1.05 * ease.out(u);
  };
  const beats = (bpm, offset = 0) => ({ len: 60 / bpm, at: n => offset + n * 60 / bpm, of: t => (t - offset) * bpm / 60 });
  const beatPulse = (t, bpm, offset = 0, decay = 8) => {
    const b = 60 / bpm, ph = (t - offset) / b;
    if (ph < 0) return 0;
    return Math.exp(-decay * (ph - Math.floor(ph)) * b);
  };
  const rng = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const cyc = (t, n, T) => ((t * n / T) % 1 + 1) % 1;
  const typed = (t, text, t0, step = 0.125) => {
    let time = t0, n = 0;
    for (const ch of text) {
      if (t < time) break;
      n++;
      time += step * (ch === ' ' ? 1.6 : ch === ',' || ch === '.' ? 2.5 : 1);
    }
    return n;
  };
  window.M = { clamp, lerp, prog, ease, spring, springs, track, logLerp, camera, floodRadius, beats, beatPulse, rng, cyc, typed };
})();
