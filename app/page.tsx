"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BadgeCheck, FileUp, Gauge, Rocket, Send, Sparkles, Truck, Wallet } from "lucide-react";
import { Hero } from "@/components/Hero";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { PUBLIC_BOT_USERNAME } from "@/lib/telegram-public";

export default function LandingPage() {
  const { tr, lang } = useI18n();

  const benefits = [
    {
      Icon: Gauge,
      glow: "blue" as const,
      title: tr({ kz: "TOS тиімділік индексі (0–100)", ru: "Индекс выгоды TOS (0–100)" }),
      body: tr({
        kz: "Қатысудың қаншалықты тиімді екенін көрсететін бір түсінікті балл. Ондаған сандарды өзіңіз салыстырудың қажеті жоқ.",
        ru: "Один понятный балл: насколько выгодно участвовать. Не нужно самому сравнивать десятки цифр.",
      }),
    },
    {
      Icon: Wallet,
      glow: "emerald" as const,
      title: tr({ kz: "Кассалық алшақтықтан қорғау", ru: "Защита от кассового разрыва" }),
      body: tr({
        kz: "Тапсырыс беруші төлегенге дейін компанияңыздың айналым қаражаты жете ме — алдын ала біліңіз.",
        ru: "Узнайте заранее, хватит ли у компании оборотных средств до того, как заказчик заплатит.",
      }),
    },
    {
      Icon: Truck,
      glow: "blue" as const,
      title: tr({ kz: "Жасырын шығындарды есепке алу", ru: "Учёт скрытых расходов" }),
      body: tr({
        kz: "Логистика, салықтар, банк комиссиялары мен айыппұлдар автоматты түрде есептеледі.",
        ru: "Логистика, налоги, комиссии банков и штрафы рассчитываются автоматически.",
      }),
    },
  ];

  const steps = [
    {
      Icon: FileUp,
      title: tr({ kz: "Жүктеңіз", ru: "Загрузите" }),
      body: tr({ kz: "Техникалық ерекшеліктің PDF файлын немесе лотқа сілтемені жіберіңіз.", ru: "PDF техспецификации или ссылку на лот." }),
    },
    {
      Icon: Sparkles,
      title: tr({ kz: "AI талдайды", ru: "AI анализирует" }),
      body: tr({ kz: "AI шарттарды бірден шығарып, қаржылық модельді есептейді.", ru: "AI мгновенно извлекает условия и рассчитывает финансовую модель." }),
    },
    {
      Icon: BadgeCheck,
      title: tr({ kz: "Шешім алыңыз", ru: "Получите вердикт" }),
      body: tr({ kz: "Шешім, таза пайда және ұсыныстар — бір басу арқылы.", ru: "Вердикт, чистая прибыль и рекомендации — в 1 клик." }),
    },
  ];

  return (
    <>
      <Hero />

      {/* What you get */}
      <section id="engine" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20">
        <SectionHeading
          title={tr({ kz: "Сіз не аласыз", ru: "Что вы получаете" })}
          subtitle={tr({
            kz: "Күрделі кестелер мен формулалар жоқ — тек өтінім беру туралы шешім қабылдауға қажет нәрсе.",
            ru: "Никаких сложных таблиц и формул — только то, что нужно для решения, подавать ли заявку.",
          })}
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {benefits.map(({ Icon, glow, title, body }, i) => (
            <motion.div
              key={`${lang}-${i}`}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.08, duration: 0.6 }}
            >
              <GlassCard glow={glow} className="h-full p-7">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-blue-400/30 bg-blue-500/10 text-blue-300">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-slate-300">{body}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20">
        <SectionHeading
          title={tr({ kz: "Бұл қалай жұмыс істейді", ru: "Как это работает" })}
          subtitle={tr({ kz: "Үш қадам — және сіз лоттың пайдалы-пайдасызын білесіз.", ru: "Три шага — и вы знаете, стоит ли лот ваших денег." })}
        />
        <div className="relative mt-12 grid gap-5 md:grid-cols-3">
          <div className="pointer-events-none absolute left-[16%] right-[16%] top-11 hidden h-px bg-gradient-to-r from-blue-500/0 via-blue-500/40 to-blue-500/0 md:block" />
          {steps.map(({ Icon, title, body }, i) => (
            <motion.div
              key={`${lang}-step-${i}`}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.12, duration: 0.6 }}
              className="relative text-center"
            >
              <div className="relative mx-auto grid h-[5.5rem] w-[5.5rem] place-items-center rounded-2xl border border-white/10 bg-ink-800/80 shadow-glow">
                <Icon className="h-8 w-8 text-blue-300" />
                <span className="keep-white absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-accent-blue text-xs font-bold text-white">
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-slate-300">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <GlassCard interactive={false} className="overflow-hidden p-12 text-center">
          <div className="pointer-events-none absolute inset-x-0 -top-24 h-56 bg-[radial-gradient(closest-side,rgba(59,130,246,0.35),transparent)] blur-2xl" />
          <h2 className="relative text-2xl font-semibold text-white sm:text-3xl">
            {tr({ kz: "Өтінім бермес бұрын тендеріңізді тексеріңіз", ru: "Проверьте свой тендер до подачи заявки" })}
          </h2>
          <p className="relative mx-auto mt-3 max-w-xl text-sm text-slate-300">
            {tr({
              kz: "Техникалық ерекшелікті жүктеңіз — бірнеше секундта пайда, тәуекелдер және нақты шешім.",
              ru: "Загрузите техспецификацию — за несколько секунд получите прибыль, риски и понятный вердикт.",
            })}
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/analyze">
              <Button className="px-7 py-3 text-base">
                <Rocket className="h-4 w-4" />
                {tr({ kz: "Тендерді тегін тексеру", ru: "Проверить тендер бесплатно" })}
              </Button>
            </Link>
            {PUBLIC_BOT_USERNAME && (
              <a href={`https://t.me/${PUBLIC_BOT_USERNAME}`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="px-7 py-3 text-base">
                  <Send className="h-4 w-4 text-sky-300" />
                  {tr({ kz: "Telegram-да ашу", ru: "Запустить в Telegram" })}
                </Button>
              </a>
            )}
          </div>
        </GlassCard>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-slate-500">
        {tr({ kz: "Qazaq Tenders · есептер ақпараттық сипатта, инвестициялық ұсыным емес", ru: "Qazaq Tenders · расчёты носят информационный характер и не являются инвестиционной рекомендацией" })}
      </footer>
    </>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="mx-auto max-w-2xl text-center"
    >
      <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-300 sm:text-base">{subtitle}</p>
    </motion.div>
  );
}
