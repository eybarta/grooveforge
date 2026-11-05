import { useEffect, useRef } from "react";

interface ScopeProps {
  analyser: AnalyserNode | null;
  live: boolean;
  acid: boolean;
}

export function Scope({ analyser, live, acid }: ScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const data = new Uint8Array(2048);

    const draw = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2 || height < 2) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const pxW = Math.floor(width * dpr);
      const pxH = Math.floor(height * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const styles = getComputedStyle(canvas);
      const ink = styles.getPropertyValue("--color-ink").trim() || "#100e0c";
      const stroke = (acid ? styles.getPropertyValue("--color-acid") : styles.getPropertyValue("--color-tangerine")).trim();
      const faint = styles.getPropertyValue("--color-line").trim();
      context.fillStyle = ink;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = faint;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();

      context.beginPath();
      context.lineWidth = 2.25;
      context.strokeStyle = stroke || "#ff5a1f";
      context.lineJoin = "round";
      context.lineCap = "round";

      const usingLive = Boolean(live && analyser);
      if (usingLive && analyser) {
        if (data.length !== analyser.fftSize) {
          /* keep the buffer; fftSize is fixed at 2048 */
        }
        analyser.getByteTimeDomainData(data);
        const step = Math.max(1, Math.floor(analyser.fftSize / width));
        for (let x = 0; x < width; x++) {
          const v = (data[x * step] ?? 128) / 128 - 1;
          const y = height / 2 + v * (height * 0.42);
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
      } else {
        const t = reduce ? 0 : now * 0.001;
        for (let x = 0; x < width; x++) {
          const p = x / width;
          const y =
            height / 2 +
            Math.sin(p * 14 + t * 2.2) * height * 0.16 +
            Math.sin(p * 5 - t * 1.3) * height * 0.07;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
      }
      context.stroke();
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser, live, acid]);

  return (
    <canvas
      ref={canvasRef}
      className="h-36 w-full rounded-xl border border-line bg-ink md:h-44"
      aria-hidden="true"
    />
  );
}
