"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Calculator, FileSearch, Layers, Route, Wallet } from "lucide-react";
import { Hero } from "@/components/Hero";
import { EngineFlow } from "@/components/EngineFlow";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n";
import { StartCta } from "@/components/AccountGate";

const FEATURE_ICONS = [Wallet, Calculator, Route, FileSearch, Layers, Brain];
const FEATURE_GLOW = ["crimson", "blue", "blue", "blue", "emerald", "blue"] as const;

export default function LandingPage() {
  const { t, lang } = useI18n();
  const L = t.landing;

  return (
    <>
      <Hero />

      {/* Architecture — interactive pipeline, then the two layers in detail */}
      <section id="how" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20">
        <SectionHeading eyebrow={L.archEyebrow} title={L.archTitle} subtitle={L.archSubtitle} />
        <p className="mb-5 mt-10 text-xs text-slate-400">{L.flowHint}</p>
        <EngineFlow />

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <GlassCard glow="blue" className="p-8">
            <Badge tone="blue" className="mb-4">Layer 1 · AI</Badge>
            <h3 className="text-lg font-semibold text-white">{t.flow.steps[1].title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{t.flow.steps[1].detail}</p>
          </GlassCard>
          <GlassCard glow="emerald" className="p-8">
            <Badge tone="emerald" className="mb-4">Layer 2 · Economics</Badge>
            <h3 className="text-lg font-semibold text-white">{t.flow.steps[2].title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{t.flow.steps[2].detail}</p>
            <pre className="mt-5 overflow-x-auto rounded-xl border border-white/5 bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
{`Π      = S − (C_purch + C_log + C_tax + C_bank + C_oper)
M_rel  = Π / S × 100%
CF_t   = CF₀ + Σ Inflow − Σ Outflow
TOS    = 0.35·M + 0.30·(100−CF) + 0.15·L + 0.20·(100−R)`}
            </pre>
          </GlassCard>
        </div>
      </section>

      {/* Features */}
      <section id="engine" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20">
        <SectionHeading eyebrow={L.featEyebrow} title={L.featTitle} subtitle={L.featSubtitle} />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {L.features.map((f, i) => {
            const Icon = FEATURE_ICONS[i];
            return (
              <motion.div
                key={`${lang}-${i}`}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: i * 0.07, duration: 0.6 }}
              >
                <GlassCard glow={FEATURE_GLOW[i]} className="h-full p-7">
                  <Icon className="h-5 w-5 text-blue-300" />
                  <h3 className="mt-4 text-base font-semibold text-white">{f.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-300">{f.body}</p>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <GlassCard interactive={false} className="overflow-hidden p-12 text-center">
          <div className="pointer-events-none absolute inset-x-0 -top-24 h-56 bg-[radial-gradient(closest-side,rgba(59,130,246,0.35),transparent)] blur-2xl" />
          <h2 className="relative text-2xl font-semibold text-white sm:text-3xl">{L.ctaTitle}</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-sm text-slate-300">{L.ctaBody}</p>
          <StartCta className="relative mt-8 inline-block">
            <Button className="px-7 py-3">
              {L.ctaButton} <ArrowRight className="h-4 w-4" />
            </Button>
          </StartCta>
        </GlassCard>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-slate-500">{L.footer}</footer>
    </>
  );
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">{subtitle}</p>
    </motion.div>
  );
}
