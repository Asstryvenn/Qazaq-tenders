"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { CheckCircle2, MapPin } from "lucide-react";
import { Badge } from "./ui/Badge";
import { useI18n } from "@/lib/i18n";

/** Example lot card for the hero: the three numbers an owner actually looks at. */
export function IsometricPreview() {
  const { tr } = useI18n();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [8, -8]), { stiffness: 140, damping: 18 });
  const ry = useSpring(useTransform(px, [0, 1], [-12, 12]), { stiffness: 140, damping: 18 });

  const metrics = [
    {
      label: tr({ kz: "Таза пайда", ru: "Чистая прибыль" }),
      value: tr({ kz: "+2,1 млн ₸", ru: "+2,1 млн ₸" }),
      hint: tr({ kz: "барлық шығыннан кейін", ru: "после всех расходов" }),
      tone: "text-emerald-300",
      ring: "border-emerald-400/30 bg-emerald-500/[0.07]",
    },
    {
      label: tr({ kz: "Кассалық алшақтық", ru: "Кассовый разрыв" }),
      value: tr({ kz: "ЖОҚ", ru: "НЕТ" }),
      hint: tr({ kz: "ақша жетеді", ru: "денег хватает" }),
      tone: "text-sky-300",
      ring: "border-sky-400/30 bg-sky-500/[0.07]",
    },
    {
      label: tr({ kz: "TOS балы", ru: "Балл TOS" }),
      value: "85/100",
      hint: tr({ kz: "тиімділік индексі", ru: "индекс выгоды" }),
      tone: "text-emerald-300",
      ring: "border-emerald-400/30 bg-emerald-500/[0.07]",
    },
  ];

  return (
    <div className="w-full max-w-md [perspective:1400px]">
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
        className="hairline glass-strong relative w-full p-6 shadow-[0_50px_100px_-30px_rgba(0,0,0,0.9)]"
      >
        <div className="pointer-events-none absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.25),transparent_65%)] blur-2xl" />

        <div style={{ transform: "translateZ(40px)" }}>
          <Badge tone="blue" pulse className="mb-3">
            {tr({ kz: "Лот мысалы", ru: "Пример лота" })}
          </Badge>
          <h3 className="text-base font-semibold leading-snug text-white">
            {tr({ kz: "Мектептерге компьютерлік жабдық жеткізу", ru: "Поставка компьютеров для школ" })}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin className="h-3.5 w-3.5" />
            {tr({ kz: "Талдықорған · 84 млн ₸", ru: "Талдыкорган · 84 млн ₸" })}
          </p>
        </div>

        <div className="mt-5 space-y-2.5" style={{ transform: "translateZ(30px)" }}>
          {metrics.map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8 + i * 0.15, duration: 0.5 }}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 ${m.ring}`}
            >
              <div>
                <p className="text-sm font-medium text-slate-200">{m.label}</p>
                <p className="text-[11px] text-slate-400">{m.hint}</p>
              </div>
              <p className={`font-mono text-xl font-bold ${m.tone}`}>{m.value}</p>
            </motion.div>
          ))}
        </div>

        {/* TOS progress */}
        <div className="mt-5" style={{ transform: "translateZ(20px)" }}>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-wave"
              initial={{ width: 0 }}
              animate={{ width: "85%" }}
              transition={{ duration: 1.4, delay: 1.2, ease: "easeOut" }}
            />
          </div>
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {tr({ kz: "Шешім: қатысуға болады", ru: "Вердикт: можно участвовать" })}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
