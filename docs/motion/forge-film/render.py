#!/usr/bin/env python3
"""render.py — capture a seek(t) film with Playwright and encode with ffmpeg.
The film defines window.seek = async (t) => {...} and window.FILM = {w, h, duration, cuts: [...]}.
  python render.py stills film.html 0 1.5 6 12   -> out/stills/sheet.png
  python render.py beats  film.html 120 [offset] -> out/beats/sheet.png (one frame per beat)
  python render.py draft  film.html              -> out/draft.mp4 (30fps, half size, no blur)
  python render.py full   film.html [--sub 8] [--shutter 0.5] [--workers 3] [--fps 60] [--scale 1]
  python render.py pops   out/video.mp4          -> single-frame pops/flashes
  python render.py sheet  out/video.mp4 [fps]    -> out/contact.png
Env WEBGL=1 adds SwiftShader flags; GPU=d3d11|metal uses the real GPU.
"""
import functools, http.server, io, os, subprocess, sys, threading
from multiprocessing import Process
import numpy as np
from PIL import Image, ImageDraw

OUT = os.environ.get("OUT", "out")
FLAGS = ["--font-render-hinting=none", "--force-color-profile=srgb", "--disable-threaded-animation",
         "--run-all-compositor-stages-before-draw", "--disable-checker-imaging"]
if os.environ.get("WEBGL"):
    FLAGS += ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
if os.environ.get("GPU"):
    FLAGS += [f"--use-angle={os.environ['GPU']}", "--enable-gpu", "--ignore-gpu-blocklist"]


def serve(folder):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=folder)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


class Film:
    def __init__(self, html, scale=1.0):
        from playwright.sync_api import sync_playwright
        folder, name = os.path.split(os.path.abspath(html))
        self.port = serve(folder)
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(args=FLAGS, executable_path='/usr/bin/google-chrome')
        probe = self.browser.new_page()
        probe.goto(f"http://127.0.0.1:{self.port}/{name}")
        probe.wait_for_function("() => !!(window.FILM && window.seek)")
        self.meta = probe.evaluate("window.FILM")
        probe.close()
        w, h = self.meta["w"], self.meta["h"]
        self.page = self.browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
        self.page.goto(f"http://127.0.0.1:{self.port}/{name}")
        self.page.wait_for_function("() => !!(window.FILM && window.seek)")
        self.page.evaluate("""async () => {
            await document.fonts.ready;
            await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
            const s = document.createElement('style');
            s.textContent = '*,*::before,*::after{transition:none!important;animation-play-state:paused!important}';
            document.head.appendChild(s);
            document.getAnimations().forEach(a => a.pause());
            if (window.ready instanceof Promise) await window.ready;
        }""")

    def shot(self, t):
        self.page.evaluate("""async t => { await window.seek(t);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }""", t)
        return np.asarray(Image.open(io.BytesIO(self.page.screenshot(type="png"))).convert("RGB"))

    def close(self):
        self.browser.close(); self.pw.stop()


def sheet(images, labels, path, cols=6, width=320):
    h0, w0 = images[0].shape[:2]
    th = int(h0 * width / w0)
    rows = (len(images) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * width, rows * (th + 18)), (20, 20, 24))
    d = ImageDraw.Draw(canvas)
    for i, (im, lab) in enumerate(zip(images, labels)):
        x, y = (i % cols) * width, (i // cols) * (th + 18)
        canvas.paste(Image.fromarray(im).resize((width, th), Image.LANCZOS), (x, y + 18))
        d.text((x + 4, y + 3), lab, fill=(255, 200, 80))
    canvas.save(path)
    return path


def encoder(path, w, h, fps, crf=16, preset="medium"):
    return subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
        "-r", str(fps), "-i", "-", "-vf", "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-movflags", "+faststart", path], stdin=subprocess.PIPE)


def frame_times(f, fps, sub, shutter, cuts):
    """Subframe times over `shutter` of a frame, clamped so blur never crosses a hard cut."""
    t = f / fps
    if sub <= 1:
        return [t]
    ts = [t + (shutter / fps) * ((k + 0.5) / sub - 0.5) for k in range(sub)]
    for c in cuts:
        ts = [max(x, c) for x in ts] if t >= c else [min(x, c - 1e-4) for x in ts]
    return ts


def render_range(html, a, b, path, fps, sub, shutter, scale, crf, preset):
    film = Film(html, scale)
    m = film.meta
    w, h = int(m["w"] * scale), int(m["h"] * scale)
    enc = encoder(path, w, h, fps, crf, preset)
    cuts = m.get("cuts", [])
    for f in range(a, b):
        acc = None
        ts = frame_times(f, fps, sub, shutter, cuts)
        for t in ts:
            im = film.shot(t).astype(np.float32)
            acc = im if acc is None else acc + im
        enc.stdin.write(np.clip(acc / len(ts) + 0.5, 0, 255).astype(np.uint8).tobytes())
        if f % 60 == 0:
            print(f"  {os.path.basename(path)} frame {f}/{b}", flush=True)
    enc.stdin.close(); enc.wait(); film.close()


def opt(args, name, default, cast=float):
    if name in args:
        i = args.index(name); v = cast(args[i + 1]); del args[i:i + 2]; return v
    return default


def probe_frames(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
                        "stream=nb_read_frames", "-of", "csv=p=0", path], capture_output=True, text=True)
    return int(r.stdout.strip() or 0)


def report_pops(video, ratio=3.0):
    w, h = 320, 180
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", video, "-vf", f"scale={w}:{h},format=gray",
                          "-f", "rawvideo", "-"], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
    fps = float(eval(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                     "stream=r_frame_rate", "-of", "csv=p=0", video], capture_output=True, text=True).stdout.strip()))
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    found = []
    for i in range(1, len(d) - 1):
        if d[i] > ratio * max(d[i - 1], d[i + 1], 0.25):
            found.append((i + 1, "spike", d[i]))
    for n in range(1, len(fr) - 1):
        a, b = d[n - 1], d[n]
        if min(a, b) > 2.0 and np.abs(fr[n + 1] - fr[n - 1]).mean() < 0.35 * min(a, b):
            found.append((n, "flash", min(a, b)))
    if not found:
        print(f"no pops in {len(fr)} frames")
    for n, kind, v in sorted(set(found)):
        print(f"{kind:5s} frame {n:5d}  t={n / fps:7.3f}s  diff={v:.2f}  (intentional cut? say so)")
    return found


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__); sys.exit(1)
    cmd, src, rest = args[0], args[1], args[2:]
    os.makedirs(OUT, exist_ok=True)
    if cmd == "stills":
        film = Film(src)
        ts = [float(x) for x in rest] or [0]
        d = os.path.join(OUT, "stills"); os.makedirs(d, exist_ok=True)
        ims = []
        for t in ts:
            im = film.shot(t); ims.append(im)
            Image.fromarray(im).save(os.path.join(d, f"t{t:07.3f}.png"))
        film.close()
        print(sheet(ims, [f"t={t:.2f}s" for t in ts], os.path.join(d, "sheet.png"), cols=min(4, len(ims)), width=480))
    elif cmd == "beats":
        bpm = float(rest[0]); off = float(rest[1]) if len(rest) > 1 else 0.0
        film = Film(src); dur = film.meta["duration"]
        ims, labs, i = [], [], 0
        while off + i * 60 / bpm <= dur:
            t = off + i * 60 / bpm
            ims.append(film.shot(t)); labs.append(f"beat {i}  {t:.2f}s"); i += 1
        film.close()
        d = os.path.join(OUT, "beats"); os.makedirs(d, exist_ok=True)
        print(sheet(ims, labs, os.path.join(d, "sheet.png")))
    elif cmd == "draft":
        film = Film(src, 0.5); film.close()
        n = int(film.meta["duration"] * 30)
        path = os.path.join(OUT, "draft.mp4")
        render_range(src, 0, n, path, 30, 1, 0.5, 0.5, 23, "veryfast")
        print(path)
    elif cmd == "full":
        sub = opt(rest, "--sub", 8, int); shutter = opt(rest, "--shutter", 0.5)
        workers = opt(rest, "--workers", 1, int); fps = opt(rest, "--fps", 60, int)
        scale = opt(rest, "--scale", 1.0)
        film = Film(src); dur = film.meta["duration"]; film.close()
        n = int(round(dur * fps))
        path = os.path.join(OUT, "video.mp4")
        if workers <= 1:
            render_range(src, 0, n, path, fps, sub, shutter, scale, 16, "medium")
        else:
            bounds = [round(n * i / workers) for i in range(workers + 1)]
            segs = [os.path.join(OUT, f"seg{i}.mp4") for i in range(workers)]
            ps = [Process(target=render_range, args=(src, bounds[i], bounds[i + 1], segs[i], fps, sub, shutter, scale, 16, "medium"))
                  for i in range(workers)]
            [p.start() for p in ps]; [p.join() for p in ps]
            lst = os.path.join(OUT, "segs.txt")
            open(lst, "w").write("".join(f"file '{os.path.abspath(s)}'\n" for s in segs))
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", path], check=True)
        frames = probe_frames(path)
        print(f"{path}  frames={frames} expected={n}" + ("" if frames == n else "  <-- MISMATCH"))
    elif cmd == "pops":
        report_pops(src)
    elif cmd == "sheet":
        fps = rest[0] if rest else "2"
        path = os.path.join(OUT, "contact.png")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", f"fps={fps},scale=320:-1,tile=6x6",
                        "-frames:v", "1", path], check=True)
        print(path)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
