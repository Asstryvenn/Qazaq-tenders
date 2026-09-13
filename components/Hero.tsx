"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "./ui/Button";
import { IsometricPreview } from "./IsometricPreview";
import { useI18n } from "@/lib/i18n";
import { StartCta } from "./AccountGate";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.1 + i * 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export function Hero() {
  const { t } = useI18n();
  return (
    <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:pt-28">
      <div>
        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            {t.hero.eyebrow}
          </span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={1}
          className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]"
        >
          <span className="text-gradient">Qazaq Tenders:</span>{" "}
          <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
            {t.hero.titleMid}
          </span>{" "}
          <span className="text-gradient">{t.hero.titleTail}</span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={2}
          className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-slate-400 sm:text-lg"
        >
          {t.hero.subtitle}
        </motion.p>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={3}
          className="mt-9 flex flex-wrap items-center gap-3"
        >
          <StartCta>
            <Button className="px-6 py-3">
              {t.hero.ctaPrimary} <ArrowRight className="h-4 w-4" />
            </Button>
          </StartCta>
          <Link href="#engine">
            <Button variant="outline" className="px-6 py-3">
              {t.hero.ctaSecondary}
            </Button>
          </Link>
        </motion.div>

        <motion.dl
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={4}
          className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/10 pt-8"
        >
          {t.hero.stats.map((s) => (
            <div key={s.v}>
              <dt className="font-mono text-lg font-semibold text-white">{s.v}</dt>
              <dd className="mt-1.5 text-xs leading-relaxed text-slate-400">{s.l}</dd>
            </div>
          ))}
        </motion.dl>
      </div>

      <div className="flex justify-center lg:justify-end">
        <IsometricPreview />
      </div>
    </section>
  );
}
