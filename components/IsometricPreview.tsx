"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { MapPin, TrendingUp } from "lucide-react";
import { Badge } from "./ui/Badge";
import { useI18n } from "@/lib/i18n";

const SPARK = [42, 48, 45, 61, 58, 72, 68, 84, 79, 92];

/** Isometric, tilt-on-hover preview card with a glowing TOS badge. */
export function IsometricPreview() {
  const { t, lang } = useI18n();
  const c = t.hero.card;
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [10, -10]), { stiffness: 140, damping: 18 });
  const ry = useSpring(useTransform(px, [0, 1], [-14, 14]), { stiffness: 140, damping: 18 });

  const path = SPARK.map((v, i) => `${(i / (SPARK.length - 1)) * 260},${70 - (v / 100) * 58}`).join(" ");

  return (
    <div className="[perspective:1400px]" >
      <motion.div
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          px.set((e.clientX - r.left) / r.width);
          py.set((e.clientY - r.top) / r.height);
        }}
        onPointerLeave={() => {
          px.set(0.5);
          py.set(0.5);
        }}
        initial={{ opacity: 0, y: 40, rotateX: 18 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.9, ease: "easeOut", delay: 0.35 }}
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        className="hairline glass-strong relative w-full max-w-md p-6 shadow-[0_50px_100px_-30px_rgba(0,0,0,0.9)]"
      >
        {/* Ambient glow behind the card */}
        <div className="pointer-events-none absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_50%_40%,rgba(16,185,129,0.22),transparent_65%)] blur-2xl" />

        <div className="flex items-start justify-between gap-4" style={{ transform: "translateZ(40px)" }}>
          <div>
            <Badge tone="blue" pulse className="mb-2">
              {c.active}
            </Badge>
            <h3 className="text-sm font-medium leading-snug text-white">
              {lang === "kz" ? "Облыстық мектептерге компьютерлік жабдық жеткізу" : "Поставка компьютерного оборудования для областных школ"}
            </h3>
            <p className="mt-1 text-xs text-slate-400">{lang === "kz" ? "Білім басқармасы · Талдықорған" : "Управление образования · Талдыкорган"}</p>
          </div>

          {/* Glowing TOS badge */}
          <motion.div
            animate={{ boxShadow: ["0 0 22px -4px #10b981", "0 0 40px -2px #10b981", "0 0 22px -4px #10b981"] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            className="grid shrink-0 place-items-center rounded-2xl border border-emerald-300/60 bg-emerald-950/80 px-3.5 py-2.5 ring-1 ring-inset ring-emerald-400/20"
            style={{ transform: "translateZ(70px)" }}
          >
            <span className="font-mono text-2xl font-bold leading-none text-emerald-200 [text-shadow:0_0_14px_rgba(16,185,129,0.8)]">85</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">TOS</span>
          </motion.div>
        </div>

        <div
          className="mt-5 grid grid-cols-3 gap-3 text-center"
          style={{ transform: "translateZ(30px)" }}
        >
          {[
            { label: c.margin, value: "17.3%", color: "#6ee7b7" },
            { label: c.gap, value: c.none, color: "#93c5fd" },
            { label: c.reach, value: `260 ${t.units.km}`, color: "#c7d2fe" },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-white/5 bg-white/[0.03] py-2.5">
              <p className="font-mono text-sm font-medium" style={{ color: m.color }}>
                {m.value}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Mini cash-flow sparkline */}
        <div className="mt-5 rounded-xl border border-white/5 bg-white/[0.02] p-3" style={{ transform: "translateZ(20px)" }}>
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
            <span>{c.flow}</span>
            <span className="text-emerald-400">CF_t &gt; 0</span>
          </div>
          <svg viewBox="0 0 260 76" className="h-16 w-full overflow-visible">
            <defs>
              <linearGradient id="hero-spark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
              <filter id="hero-glow">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <polygon points={`0,76 ${path} 260,76`} fill="url(#hero-spark)" />
            <motion.polyline
              points={path}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
              filter="url(#hero-glow)"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.6, delay: 0.9, ease: "easeInOut" }}
            />
          </svg>
        </div>

        <div
          className="mt-4 flex items-center justify-between text-xs text-slate-400"
          style={{ transform: "translateZ(20px)" }}
        >
          <span className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> 84 {t.units.mln}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {c.deferral}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
