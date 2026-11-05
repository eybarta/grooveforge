import { clsx } from "clsx";
import { Download, Mic, Pause, Play, RotateCcw, Square, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { bufferToMono, analyzeChannel } from "@/lib/audio/analyze";
import { getDemoGroove } from "@/lib/audio/demo";
import { renderStudioWav, StudioEngine } from "@/lib/audio/engine";
import {
  FLAVOR_SWING,
  FLAVORS,
  NOTES,
  type Flavor,
  type HitEvent,
  type Lane,
  type Mix,
} from "@/lib/audio/music";
import {
  countLanes,
  editKey,
  resolveGroove,
  stepsFromAnalysis,
  type EditMap,
} from "@/lib/audio/pattern";
import { Scope } from "@/components/scope";
import { StepGrid } from "@/components/step-grid";

type Take = "demo" | "mic" | "file";
type Source = "mouth" | "studio";

interface MouthTake {
  samples: Float32Array;
  sampleRate: number;
}

interface RecSession {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  timer: number;
  interval: number;
  started: number;
  src: MediaStreamAudioSourceNode;
  sink: MediaStreamAudioDestinationNode;
  micCtx: AudioContext;
  mime: string;
  done: boolean;
}

function pickMime(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function setAudioSession(type: "playback" | "play-and-record") {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = type;
}

async function decodeTake(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("no audio");
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    if (ctx.state === "suspended") await ctx.resume();
    return await ctx.decodeAudioData(bytes.slice(0));
  } finally {
    await ctx.close();
  }
}

function clock(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const tenth = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${tenth}`;
}

const LEVELS = { kick: 0.82, snare: 0.78, hat: 0.64, perc: 0.58, bass: 0.76, room: 0.36 };

export function GrooveForge() {
  const demo = useMemo(() => getDemoGroove(), []);
  const engineRef = useRef<StudioEngine | null>(null);
  const mouthRef = useRef<MouthTake>({ samples: demo.samples, sampleRate: demo.sampleRate });
  const recRef = useRef<RecSession | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stepsRef = useRef<HitEvent[][]>([]);
  const bpmRef = useRef(demo.bpm);
  const mixRef = useRef<Mix | null>(null);
  const sourceRef = useRef<Source>("studio");
  const playingRef = useRef(false);
  const playRef = useRef<() => void>(() => {});

  const [micSteps, setMicSteps] = useState(demo.micSteps);
  const [bpm, setBpm] = useState(demo.bpm);
  const [bars, setBars] = useState(demo.bars);
  const [flavor, setFlavor] = useState<Flavor>("funk");
  const [root, setRoot] = useState(41);
  const [swing, setSwing] = useState(FLAVOR_SWING.funk);
  const [swingDirty, setSwingDirty] = useState(false);
  const [dressOn, setDressOn] = useState(true);
  const [humanize, setHumanize] = useState(true);
  const [levels, setLevels] = useState(LEVELS);
  const [edits, setEdits] = useState<EditMap>({});
  const [source, setSource] = useState<Source>("studio");
  const [take, setTake] = useState<Take>("demo");
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playStep, setPlayStep] = useState<number | null>(null);
  const [bar, setBar] = useState(0);
  const [follow, setFollow] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(
    `Demo pocket is on the rack at ${demo.bpm} BPM. Play it, or record your mouth over it.`,
  );
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
  const [engineAnalyser, setEngineAnalyser] = useState<AnalyserNode | null>(null);

  const resolved = useMemo(
    () => resolveGroove(micSteps, flavor, dressOn, edits),
    [micSteps, flavor, dressOn, edits],
  );
  const heard = useMemo(() => countLanes(micSteps), [micSteps]);
  const mix = useMemo<Mix>(
    () => ({ ...levels, swing, humanize, flavor, root }),
    [levels, swing, humanize, flavor, root],
  );

  stepsRef.current = resolved;
  bpmRef.current = bpm;
  mixRef.current = mix;
  sourceRef.current = source;
  playingRef.current = playing;

  function ensure(): StudioEngine {
    if (!engineRef.current) engineRef.current = new StudioEngine();
    const engine = engineRef.current;
    engine.unlock();
    setEngineAnalyser(engine.analyser);
    return engine;
  }

  function stopTransport() {
    engineRef.current?.stop();
    setPlaying(false);
    setPlayStep(null);
  }

  function startPlayback(next: Source) {
    setAudioSession("playback");
    const engine = ensure();
    const live = mixRef.current;
    if (live) engine.setMix(live);
    if (next === "mouth") {
      const mouth = mouthRef.current;
      engine.playMouth(mouth.samples, mouth.sampleRate);
    } else {
      engine.playStudio(
        () => ({ steps: stepsRef.current, bpm: bpmRef.current }),
        () => mixRef.current ?? mix,
      );
    }
    setSource(next);
    setPlaying(true);
    setFollow(true);
  }

  function togglePlay() {
    if (playingRef.current) {
      stopTransport();
      return;
    }
    startPlayback(sourceRef.current);
  }
  playRef.current = togglePlay;

  function adopt(buffer: AudioBuffer, kind: Take) {
    const mono = bufferToMono(buffer);
    if (buffer.duration < 0.7) {
      setError("Give it at least a second of pocket.");
      return;
    }
    const analysis = analyzeChannel(mono, buffer.sampleRate);
    if (analysis.hits.length < 2) {
      setError("No attacks in that take. Get closer and punch the kicks, ka's, and tss.");
      return;
    }
    const steps = stepsFromAnalysis(analysis);
    const counts = countLanes(steps);
    mouthRef.current = { samples: mono, sampleRate: buffer.sampleRate };
    setMicSteps(steps);
    setBpm(analysis.bpm);
    setBars(analysis.bars);
    setEdits({});
    setBar(0);
    setTake(kind);
    setSource("studio");
    setError(null);
    setStatus(
      `Printed ${counts.kick} kicks, ${counts.snare} snares, ${counts.hat} hats at ${analysis.bpm} BPM.`,
    );
  }

  async function finishRecording() {
    const rec = recRef.current;
    if (!rec || rec.done) return;
    rec.done = true;
    window.clearTimeout(rec.timer);
    window.clearInterval(rec.interval);
    setRecording(false);
    setMicAnalyser(null);
    await new Promise<void>((resolve) => {
      if (rec.recorder.state === "inactive") {
        resolve();
        return;
      }
      rec.recorder.addEventListener("stop", () => resolve(), { once: true });
      rec.recorder.stop();
    });
    rec.stream.getTracks().forEach((track) => track.stop());
    try {
      rec.src.disconnect();
    } catch {
      /* stream source already closed */
    }
    void rec.micCtx.close();
    setAudioSession("playback");
    const blob = new Blob(rec.chunks, { type: rec.mime || rec.recorder.mimeType || "audio/webm" });
    if (blob.size < 80) {
      setError("That take came back empty. Try the mic again.");
      return;
    }
    try {
      const audio = await decodeTake(await blob.arrayBuffer());
      adopt(audio, "mic");
    } catch {
      setError("Couldn't read that take. Try recording once more.");
    }
  }

  async function startRecording() {
    stopTransport();
    setError(null);
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the mic. Load the demo, or upload a beatbox.");
      return;
    }
    setAudioSession("play-and-record");
    const micCtx = new Ctx({ latencyHint: "interactive" });
    void micCtx.resume();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        void micCtx.close();
        setAudioSession("playback");
        setError("Mic is blocked. Use the demo pocket, or upload a beatbox.");
        return;
      }
    }
    if (micCtx.state === "closed") {
      stream.getTracks().forEach((track) => track.stop());
      setAudioSession("playback");
      return;
    }
    if (micCtx.state === "suspended") void micCtx.resume();
    const src = micCtx.createMediaStreamSource(stream);
    const analyser = micCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    // Pull the graph so the scope can read it, but never into the speakers.
    // Routing the mic to destination is what howls on iPhone.
    const sink = micCtx.createMediaStreamDestination();
    src.connect(analyser);
    analyser.connect(sink);
    setMicAnalyser(analyser);
    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      void micCtx.close();
      setMicAnalyser(null);
      setAudioSession("playback");
      setError("Recording isn't supported in this browser. Upload a beatbox instead.");
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start();
    const started = performance.now();
    const session: RecSession = {
      recorder,
      stream,
      chunks,
      timer: 0,
      interval: 0,
      started,
      src,
      sink,
      micCtx,
      mime,
      done: false,
    };
    session.timer = window.setTimeout(() => {
      void finishRecording();
    }, 12000);
    session.interval = window.setInterval(() => setRecMs(performance.now() - started), 80);
    recRef.current = session;
    setRecMs(0);
    setRecording(true);
    setStatus("Listening. Kicks, snares, hats — twelve seconds max.");
  }

  function onRecordClick() {
    if (recording) {
      void finishRecording();
      return;
    }
    void startRecording();
  }

  function loadDemo() {
    stopTransport();
    const next = getDemoGroove();
    mouthRef.current = { samples: next.samples, sampleRate: next.sampleRate };
    setMicSteps(next.micSteps);
    setBpm(next.bpm);
    setBars(next.bars);
    setEdits({});
    setBar(0);
    setTake("demo");
    setFlavor("funk");
    if (!swingDirty) setSwing(FLAVOR_SWING.funk);
    setSource("studio");
    setError(null);
    setStatus(`Demo pocket reloaded at ${next.bpm} BPM. Hit play, then talk over it.`);
  }

  function onUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result;
      if (!(raw instanceof ArrayBuffer)) {
        setError("Couldn't open that file.");
        return;
      }
      void decodeTake(raw).then(
        (audio) => adopt(audio, "file"),
        () => setError("That file isn't audio this rack can read."),
      );
    };
    reader.readAsArrayBuffer(file);
  }

  function toggleStep(step: number, lane: Lane) {
    const current = resolved[step]?.find((event) => event.lane === lane);
    const key = editKey(step, lane);
    setEdits((prev) => ({
      ...prev,
      [key]: current
        ? { on: false, velocity: current.velocity, degree: current.degree }
        : { on: true, velocity: 0.86, degree: 0 },
    }));
  }

  function pickFlavor(next: Flavor) {
    setFlavor(next);
    if (!swingDirty) setSwing(FLAVOR_SWING[next]);
  }

  async function onExport() {
    setExporting(true);
    setError(null);
    try {
      const blob = await renderStudioWav(resolved, bpm, mix);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `grooveforge-${flavor}-${bpm}.wav`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export stumbled. Press play once, then try saving again.");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    setAudioSession("playback");
  }, []);

  useEffect(() => {
    engineRef.current?.setMix(mix);
  }, [mix]);

  useEffect(() => {
    if (!playing || source !== "studio") return;
    let frame = 0;
    const loop = () => {
      const step = engineRef.current?.getAudibleStep() ?? null;
      setPlayStep((prev) => (prev === step ? prev : step));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, source]);

  useEffect(() => {
    if (!follow || playStep == null) return;
    const next = Math.floor(playStep / 16);
    if (next >= 0 && next < bars) setBar((prev) => (prev === next ? prev : next));
  }, [follow, playStep, bars]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      playRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(
    () => () => {
      engineRef.current?.stop();
      const rec = recRef.current;
      if (!rec) return;
      rec.stream.getTracks().forEach((track) => track.stop());
      if (rec.recorder.state !== "inactive") rec.recorder.stop();
      void rec.micCtx.close();
    },
    [],
  );

  const flavour = FLAVORS.find((item) => item.id === flavor) ?? FLAVORS[0];
  const scopeNode = recording ? micAnalyser : playing ? engineAnalyser : null;
  const takeLabel = take === "demo" ? "Demo mouth" : take === "mic" ? "Your mouth" : "Uploaded take";

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="fixed inset-x-0 top-0 z-40 h-1 bg-tangerine" />
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 px-4 pt-6 pb-32 md:px-8 md:pt-8 [&>*]:min-w-0">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="font-display text-xs tracking-widest text-acid">MOUTH TO MIX</p>
            <h1 className="font-display text-2xl leading-none font-bold tracking-tight text-cream sm:text-4xl md:text-5xl">
              GROOVE<span className="text-tangerine">FORGE</span>
            </h1>
          </div>
          <p className="hidden max-w-xs text-right text-sm leading-snug text-muted md:block">
            Beatbox a pocket. The rack quantizes your hits, dresses a bassline, and prints a glued studio take.
          </p>
        </header>
        <p className="text-sm leading-relaxed text-muted md:hidden">
          Beatbox a pocket. We turn the hits into a swung, glued drum take.
        </p>

        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-panel p-4 [&>*]:min-w-0">
            <Scope analyser={scopeNode} live={Boolean(scopeNode)} acid={source === "studio" && !recording} />
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-snug text-cream">{status}</p>
              <p className="shrink-0 font-display text-lg tabular-nums text-tangerine">
                {recording ? clock(recMs) : `${bpm} BPM`}
              </p>
            </div>
            {error && <p className="text-sm text-tangerine">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                {recording && <span className="rec-ping absolute inset-0 rounded-full bg-tangerine" aria-hidden="true" />}
                <button
                  type="button"
                  onClick={onRecordClick}
                  className={clsx(
                    "relative inline-flex h-14 items-center gap-2 rounded-full px-5 font-display text-sm font-bold transition-transform duration-150 ease-out active:scale-[0.96]",
                    recording ? "bg-cream text-ink" : "bg-tangerine text-ink",
                  )}
                >
                  {recording ? <Square className="size-4 fill-current" /> : <Mic className="size-4" />}
                  {recording ? "Stop" : "Record"}
                </button>
              </div>
              <button
                type="button"
                onClick={loadDemo}
                className="inline-flex h-12 items-center gap-2 rounded-full border border-line bg-ink px-4 text-sm font-semibold text-cream transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                <RotateCcw className="size-4" />
                Demo
              </button>
              <button
                type="button"
                onClick={() => {
                  ensure();
                  fileRef.current?.click();
                }}
                className="inline-flex h-12 items-center gap-2 rounded-full border border-line bg-ink px-4 text-sm font-semibold text-cream transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                <Upload className="size-4" />
                Upload
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                  onUpload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
            <p className="text-xs text-faint">
              {takeLabel} · {heard.kick} kicks · {heard.snare} snares · {heard.hat} hats · {heard.perc} perc
            </p>
          </section>

          <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-panel p-4 [&>*]:min-w-0">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-widest text-faint uppercase">Flavor</p>
              <div className="flex flex-wrap gap-2">
                {FLAVORS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={item.id === flavor}
                    onClick={() => pickFlavor(item.id)}
                    className={clsx(
                      "h-11 shrink-0 rounded-full px-4 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96]",
                      item.id === flavor ? "bg-tangerine text-ink" : "border border-line bg-ink text-cream",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm leading-snug text-muted">{flavour?.blurb}</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-widest text-faint uppercase">Key</p>
              <div className="flex min-w-0 gap-1 overflow-x-auto pb-1">
                {NOTES.map((note, index) => {
                  const midi = 36 + index;
                  const on = midi === root;
                  return (
                    <button
                      key={note}
                      type="button"
                      aria-pressed={on}
                      aria-label={`Key ${note}`}
                      onClick={() => setRoot(midi)}
                      className={clsx(
                        "h-11 w-11 shrink-0 rounded-lg font-display text-xs font-bold transition-transform duration-150 ease-out active:scale-[0.96]",
                        on ? "bg-acid text-ink" : "border border-line bg-ink text-cream",
                      )}
                    >
                      {note}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-ink px-3 py-2">
                <p className="text-xs text-faint">BPM</p>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    aria-label="Slower"
                    onClick={() => setBpm((value) => Math.max(75, value - 1))}
                    className="flex size-11 items-center justify-center rounded-full text-lg text-cream"
                  >
                    −
                  </button>
                  <span className="font-display text-2xl tabular-nums">{bpm}</span>
                  <button
                    type="button"
                    aria-label="Faster"
                    onClick={() => setBpm((value) => Math.min(155, value + 1))}
                    className="flex size-11 items-center justify-center rounded-full text-lg text-cream"
                  >
                    +
                  </button>
                </div>
              </div>
              <label className="rounded-xl border border-line bg-ink px-3 py-2">
                <span className="flex items-center justify-between text-xs text-faint">
                  Swing
                  <span className="font-display text-sm text-cream tabular-nums">{Math.round(swing * 100)}%</span>
                </span>
                <input
                  className="mix-slider"
                  type="range"
                  min={50}
                  max={66}
                  value={Math.round(swing * 100)}
                  onChange={(event) => {
                    setSwingDirty(true);
                    setSwing(Number(event.target.value) / 100);
                  }}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={dressOn}
                onClick={() => setDressOn((value) => !value)}
                className={clsx(
                  "h-11 rounded-full px-4 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96]",
                  dressOn ? "bg-acid text-ink" : "border border-line bg-ink text-cream",
                )}
              >
                Dress the pocket
              </button>
              <button
                type="button"
                aria-pressed={humanize}
                onClick={() => setHumanize((value) => !value)}
                className={clsx(
                  "h-11 rounded-full px-4 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96]",
                  humanize ? "bg-cream text-ink" : "border border-line bg-ink text-cream",
                )}
              >
                Humanize
              </button>
              <button
                type="button"
                onClick={() => setEdits({})}
                className="h-11 rounded-full border border-line bg-ink px-4 text-sm font-semibold text-cream transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                Clear tweaks
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
              {(
                [
                  ["kick", "Kick"],
                  ["snare", "Snare"],
                  ["hat", "Hat"],
                  ["perc", "Perc"],
                  ["bass", "Bass"],
                  ["room", "Room"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
                  <input
                    className="mix-slider"
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(levels[key] * 100)}
                    onChange={(event) => {
                      const value = Number(event.target.value) / 100;
                      setLevels((prev) => ({ ...prev, [key]: value }));
                    }}
                  />
                </label>
              ))}
            </div>
          </section>
        </div>

        <section className="min-w-0 rounded-2xl border border-line bg-panel p-4 [&>*]:min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight">The rack</h2>
              <p className="text-sm text-muted">Tap a pad to rewrite a hit. Dots are notes the rack dressed in.</p>
            </div>
            <div className="flex items-center gap-2">
              {Array.from({ length: bars }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={bar === index}
                  onClick={() => {
                    setBar(index);
                    setFollow(false);
                  }}
                  className={clsx(
                    "h-11 min-w-11 rounded-full px-3 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96]",
                    bar === index ? "bg-cream text-ink" : "border border-line bg-ink text-cream",
                  )}
                >
                  Bar {index + 1}
                </button>
              ))}
              {!follow && bars > 1 && (
                <button
                  type="button"
                  onClick={() => setFollow(true)}
                  className="h-11 rounded-full border border-line px-3 text-sm font-semibold text-acid"
                >
                  Follow
                </button>
              )}
            </div>
          </div>
          <StepGrid steps={resolved} bar={bar} playStep={source === "studio" ? playStep : null} onToggle={toggleStep} />
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-acid px-5 font-display text-sm font-bold text-ink transition-transform duration-150 ease-out active:scale-[0.96]"
          >
            <span className="relative block size-5">
              <Play
                className={clsx(
                  "absolute inset-0 size-5 transition-[opacity,transform,filter] duration-300",
                  playing ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-none",
                )}
              />
              <Pause
                className={clsx(
                  "size-5 transition-[opacity,transform,filter] duration-300",
                  playing ? "scale-100 opacity-100 blur-none" : "scale-[0.25] opacity-0 blur-[4px]",
                )}
              />
            </span>
            {playing ? "Stop" : "Play"}
          </button>
          <div className="flex h-12 overflow-hidden rounded-full border border-line">
            <button
              type="button"
              aria-pressed={source === "mouth"}
              onClick={() => {
                if (playingRef.current) startPlayback("mouth");
                else setSource("mouth");
              }}
              className={clsx(
                "px-3 text-sm font-semibold sm:px-4",
                source === "mouth" ? "bg-cream text-ink" : "bg-ink text-cream",
              )}
            >
              Mouth
            </button>
            <button
              type="button"
              aria-pressed={source === "studio"}
              onClick={() => {
                if (playingRef.current) startPlayback("studio");
                else setSource("studio");
              }}
              className={clsx(
                "px-3 text-sm font-semibold sm:px-4",
                source === "studio" ? "bg-acid text-ink" : "bg-ink text-cream",
              )}
            >
              Studio
            </button>
          </div>
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={exporting}
            className="ml-auto inline-flex h-12 items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-semibold text-cream transition-transform duration-150 ease-out active:scale-[0.96] disabled:opacity-50"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">{exporting ? "Rendering" : "Save WAV"}</span>
            <span className="sm:hidden">{exporting ? "…" : "WAV"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
