#!/usr/bin/env node
// Forge transition vs the motion spec (P3 gate), like the film's render.py: one headless Chrome, seek(t) per frame,
// screenshot over the DevTools protocol. No npm deps (Node's WebSocket + installed Chrome + ffmpeg).
// Needs `npm run web` running.
//   node scripts/capture-forge.mjs stills  → out/forge/t*.png at the spec's still times + SSIM vs docs/motion/stills
//   node scripts/capture-forge.mjs video   → out/forge/forge.mp4 (60 fps, 2×) + out/forge/side-by-side.mp4
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODE = process.argv[2] ?? "stills";
const URL_ = process.env.URL ?? "http://localhost:8081/dev/forge?t=0&capture";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "out/forge", PORT = 9334, SCALE = MODE === "video" ? 2 : 1; // spec stills 390×844, spec video 780×1688
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(join(OUT, "frames"), { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "gf-capture-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--hide-scrollbars",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=600,1000", "about:blank"], { stdio: "ignore" });
try {
  let ver;
  for (let i = 0; i < 100 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(100); } }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: s } } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: SCALE, mobile: false }, s);
  await send("Page.navigate", { url: URL_ }, s);
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;
  for (let i = 0; i < 300 && !(await evaluate("typeof seek === 'function' && !!globalThis.CanvasKit")); i++) await sleep(100);
  await sleep(1500); // fonts into Skia
  const frameAt = async (t, file) => {
    await evaluate(`seek(${t}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } }, s);
    writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  };
  if (MODE === "stills") {
    for (const f of readdirSync("docs/motion/stills").filter((n) => /^t[\d.]+\.png$/.test(n)).sort()) {
      const out = join(OUT, f);
      await frameAt(Number(f.slice(1, -4)), out);
      const log = spawnSync("ffmpeg", ["-hide_banner", "-i", out, "-i", join("docs/motion/stills", f), "-lavfi", "ssim", "-f", "null", "-"], { encoding: "utf8" }).stderr;
      console.log(f.slice(0, -4), "SSIM", (log.match(/All:([\d.]+)/) ?? [])[1] ?? "?");
    }
  } else {
    const duration = await evaluate("FILM.duration");
    const n = Math.round(duration * 60);
    for (let i = 0; i < n; i++) await frameAt(i / 60, join(OUT, "frames", `${String(i).padStart(4, "0")}.png`));
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-framerate", "60", "-i", join(OUT, "frames/%04d.png"), "-pix_fmt", "yuv420p", join(OUT, "forge.mp4")]);
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", "docs/motion/forge-transition.mp4", "-i", join(OUT, "forge.mp4"),
      "-filter_complex", "[0:v]scale=780:1688[a];[1:v]scale=780:1688[b];[a][b]hstack", "-pix_fmt", "yuv420p", join(OUT, "side-by-side.mp4")]);
    console.log(`${n} frames → ${OUT}/side-by-side.mp4 (left: spec, right: app)`);
  }
  ws.close();
} finally {
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited; // Chrome writes its profile until it exits
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
