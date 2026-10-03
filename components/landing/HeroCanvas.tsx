"use client";

import { useEffect, useRef } from "react";

/**
 * Монохромная «видео»-анимация для первого экрана, отрисованная на canvas:
 * точечная матрица с бегущими интерференционными полосами и две линии «рынка».
 * Без внешних файлов: не грузит трафик на телефоне, ставится на паузу вне экрана
 * и в фоновой вкладке, а при prefers-reduced-motion рисует один статичный кадр.
 */
export function HeroCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let fg = "250,250,250";
    const readColor = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--c-fg").trim().split(/\s+/);
      if (v.length === 3) fg = v.join(",");
    };
    readColor();
    const themeObserver = new MutationObserver(readColor);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Две «рыночные» кривые: детерминированная сумма синусов, сдвигается во времени.
    const series = (x: number, t: number, k: number) =>
      Math.sin(x * 0.006 + t * 0.35 + k) * 0.5 + Math.sin(x * 0.017 - t * 0.6 + k * 2) * 0.28 + Math.sin(x * 0.041 + t * 1.1 + k * 3) * 0.12;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const step = w < 640 ? 22 : 28;
      // Точечная матрица
      for (let y = step / 2; y < h; y += step) {
        const fadeY = 1 - Math.min(1, Math.abs(y - h * 0.45) / (h * 0.75));
        for (let x = step / 2; x < w; x += step) {
          const band = Math.sin(x * 0.011 + t * 0.55) * Math.cos(y * 0.017 - t * 0.38) + Math.sin((x + y) * 0.004 - t * 0.25);
          const a = 0.05 + Math.max(0, band) * 0.22 * fadeY;
          ctx.fillStyle = `rgba(${fg},${a.toFixed(3)})`;
          ctx.fillRect(x, y, 1.6, 1.6);
        }
      }
      // Горизонтальные уровни
      ctx.strokeStyle = `rgba(${fg},0.06)`;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = Math.round(h * (0.25 * i)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      // Кривые
      const curves = [
        { k: 0, base: 0.62, amp: 0.13, alpha: 0.55 },
        { k: 1.7, base: 0.7, amp: 0.09, alpha: 0.22 },
      ];
      for (const c of curves) {
        ctx.strokeStyle = `rgba(${fg},${c.alpha})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const y = h * (c.base + series(x, t, c.k) * c.amp);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (c.alpha > 0.5) {
          // Сканирующая вертикаль и «котировка» на кривой
          const sx = ((t * 60) % (w + 200)) - 100;
          if (sx > 0 && sx < w) {
            const sy = h * (c.base + series(sx, t, c.k) * c.amp);
            ctx.strokeStyle = `rgba(${fg},0.18)`;
            ctx.beginPath();
            ctx.moveTo(Math.round(sx) + 0.5, 0);
            ctx.lineTo(Math.round(sx) + 0.5, h);
            ctx.stroke();
            ctx.fillStyle = `rgba(${fg},0.95)`;
            ctx.fillRect(sx - 3, sy - 3, 6, 6);
            ctx.font = "11px var(--font-geist-mono), ui-monospace, monospace";
            ctx.fillStyle = `rgba(${fg},0.7)`;
            const value = (62 + series(sx, t, c.k) * 30).toFixed(1);
            ctx.fillText(`TOS ${value}`, Math.min(sx + 10, w - 70), sy - 10);
          }
        }
      }
    };

    let raf = 0;
    let visible = true;
    const start = performance.now();
    const loop = (now: number) => {
      draw((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    const play = () => {
      if (!raf && visible && !document.hidden && !reduce) raf = requestAnimationFrame(loop);
    };
    const pause = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) play();
      else pause();
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? pause() : play());
    document.addEventListener("visibilitychange", onVisibility);
    if (reduce) draw(4);
    else play();

    return () => {
      pause();
      io.disconnect();
      ro.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
