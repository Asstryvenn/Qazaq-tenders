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
import { Eq, Frac, Num, Op, Sum, V } from "@/components/Math";

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
            <div className="mt-5 rounded-xl border border-white/10 bg-black/30 px-4 py-1">
              <Eq
                lhs={<V>Π</V>}
                def={
                  <>
                    <V>S</V>
                    <Op>−</Op>
                    <span className="text-slate-400">(</span>
                    <V sub="purch">C</V>
                    <Op>+</Op>
                    <V sub="log">C</V>
                    <Op>+</Op>
                    <V sub="tax">C</V>
                    <Op>+</Op>
                    <V sub="bank">C</V>
                    <Op>+</Op>
                    <V sub="oper">C</V>
                    <span className="text-slate-400">)</span>
                  </>
                }
              />
              <Eq
                lhs={<V sub="rel">M</V>}
                def={
                  <>
                    <Frac num={<V>Π</V>} den={<V>S</V>} />
                    <Op>×</Op>
                    <Num>100%</Num>
                  </>
                }
              />
              <Eq
                lhs={<V sub="t">CF</V>}
                def={
                  <>
                    <V sub="0">CF</V>
                    <Op>+</Op>
                    <Sum sub="i≤t" />
                    <V sub="i">In</V>
                    <Op>−</Op>
                    <Sum sub="i≤t" />
                    <V sub="i">Out</V>
                  </>
                }
              />
              <Eq
                lhs={<V>TOS</V>}
                def={
                  <>
                    <Num>0,35</Num>
                    <Op>·</Op>
                    <V>M</V>
                    <Op>+</Op>
                    <Num>0,30</Num>
                    <Op>·</Op>
                    <span className="text-slate-400">(</span>
                    <Num>100</Num>
                    <Op>−</Op>
                    <V sub="risk">CF</V>
                    <span className="text-slate-400">)</span>
                    <Op>+</Op>
                    <Num>0,15</Num>
                    <Op>·</Op>
                    <V>L</V>
                    <Op>+</Op>
                    <Num>0,20</Num>
                    <Op>·</Op>
                    <span className="text-slate-400">(</span>
                    <Num>100</Num>
                    <Op>−</Op>
                    <V sub="legal">R</V>
                    <span className="text-slate-400">)</span>
                  </>
                }
              />
            </div>
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
