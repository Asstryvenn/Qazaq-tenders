"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";

/** One floating, blurred gradient orb. */
function Orb({
  className,
  delay = 0,
  duration = 18,
  drift = 60,
}: {
  className: string;
  delay?: number;
  duration?: number;
  drift?: number;
}) {
  return (
    <motion.div
      aria-hidden
      className={`absolute rounded-full blur-3xl opacity-30 ${className}`}
      animate={{
        x: [0, drift, -drift * 0.6, 0],
        y: [0, -drift * 0.8, drift * 0.5, 0],
        scale: [1, 1.12, 0.95, 1],
      }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/**
 * Full-page background: floating orbs + SVG grid + a spotlight
 * that follows the cursor and lights the grid beneath it.
 */
export function AnimatedBackground() {
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.2);
  const sx = useSpring(mx, { stiffness: 60, damping: 22, mass: 0.6 });
  const sy = useSpring(my, { stiffness: 60, damping: 22, mass: 0.6 });

  const spotlight = useTransform(
    [sx, sy],
    ([x, y]: number[]) =>
      `radial-gradient(560px circle at ${x * 100}% ${y * 100}%, rgba(0,178,254,0.18), transparent 70%)`
  );
  const maskImage = useTransform(
    [sx, sy],
    ([x, y]: number[]) =>
      `radial-gradient(420px circle at ${x * 100}% ${y * 100}%, black 10%, transparent 75%)`
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mx.set(e.clientX / window.innerWidth);
      my.set(e.clientY / window.innerHeight);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [mx, my]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Floating gradient orbs */}
      <Orb
        className="-left-40 -top-32 h-[34rem] w-[34rem] bg-[radial-gradient(circle_at_30%_30%,#00B2FE,transparent_65%)]"
        duration={22}
      />
      <Orb
        className="right-[-12rem] top-24 h-[30rem] w-[30rem] bg-[radial-gradient(circle_at_60%_40%,#10b981,transparent_65%)]"
        delay={2}
        duration={26}
        drift={80}
      />
      <Orb
        className="bottom-[-14rem] left-1/3 h-[38rem] w-[38rem] bg-[radial-gradient(circle_at_50%_50%,#6366f1,transparent_65%)]"
        delay={4}
        duration={30}
        drift={70}
      />
      <Orb
        className="bottom-10 right-1/4 h-[22rem] w-[22rem] bg-[radial-gradient(circle_at_50%_50%,#f43f5e,transparent_65%)]"
        delay={1.5}
        duration={24}
        drift={50}
      />

      {/* Static base grid */}
      <div
        className="bg-grid-lines absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(120% 80% at 50% 0%, black 30%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(120% 80% at 50% 0%, black 30%, transparent 85%)",
        }}
      />

      {/* Grid segment that lights up under the cursor */}
      <motion.div
        className="bg-grid-lines absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(0,178,254,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,178,254,0.35) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage,
          WebkitMaskImage: maskImage,
        }}
      />

      {/* Cursor spotlight */}
      <motion.div className="absolute inset-0" style={{ background: spotlight }} />

      {/* Vignette to keep text readable */}
      <div className="bg-vignette absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_40%,rgba(3,33,71,0.85)_100%)]" />
    </div>
  );
}
