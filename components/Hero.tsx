"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Clock, FileText, Languages, Rocket, Send, Sparkles } from "lucide-react";
import { Button } from "./ui/Button";
import { IsometricPreview } from "./IsometricPreview";
import { useI18n } from "@/lib/i18n";
import { PUBLIC_BOT_USERNAME } from "@/lib/telegram-public";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.1 + i * 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

/** Hero: what the product does in one sentence, and two ways to start. */
export function Hero() {
  const { tr, lang } = useI18n();

  return (
    <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
      <div>
        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            {tr({ kz: "Қазақстандағы шағын және орта бизнес үшін", ru: "Для малого и среднего бизнеса Казахстана" })}
          </span>
        </motion.div>

        <motion.h1
          key={lang}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={1}
          className="mt-6 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-[3.3rem]"
        >
          {lang === "kz" ? (
            <>
              Тендерге қатысу тиімді ме?{" "}
              <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
                5 секундта AI-мен тексеріңіз
              </span>
            </>
          ) : (
            <>
              Оцените выгоду и риски тендера{" "}
              <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
                за 5 секунд
              </span>{" "}
              до подачи заявки
            </>
          )}
        </motion.h1>

        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={2}
          className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-slate-300 sm:text-lg"
        >
          {tr({
            kz: "Шағын және орта бизнеске арналған ақылды AI-сервис: нақты таза пайданы есептейді, кассалық алшақтық туралы алдын ала ескертеді және шығынды лоттардан қорғайды.",
            ru: "Умный AI-сервис для МСБ Казахстана: рассчитывает реальную чистую прибыль, предупреждает о кассовом разрыве и защищает от убыточных лотов.",
          })}
        </motion.p>

        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3} className="mt-9 flex flex-wrap items-center gap-3">
          <Link href="/analyze">
            <Button className="px-6 py-3 text-base">
              <Rocket className="h-4 w-4" />
              {tr({ kz: "Тендерді тегін тексеру", ru: "Проверить тендер бесплатно" })}
            </Button>
          </Link>
          {PUBLIC_BOT_USERNAME && (
            <a href={`https://t.me/${PUBLIC_BOT_USERNAME}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="px-6 py-3 text-base">
                <Send className="h-4 w-4 text-sky-300" />
                {tr({ kz: "Telegram-да ашу", ru: "Запустить в Telegram" })}
              </Button>
            </a>
          )}
        </motion.div>

        <motion.ul
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={4}
          className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400"
        >
          {[
            { Icon: FileText, text: tr({ kz: "PDF немесе лотқа сілтеме", ru: "PDF или ссылка на лот" }) },
            { Icon: Clock, text: tr({ kz: "Жауап — бірнеше секундта", ru: "Ответ за несколько секунд" }) },
            { Icon: Languages, text: tr({ kz: "Қазақша және орысша", ru: "На казахском и русском" }) },
          ].map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-blue-400" />
              {text}
            </li>
          ))}
        </motion.ul>
      </div>

      <div className="flex justify-center lg:justify-end">
        <IsometricPreview />
      </div>
    </section>
  );
}
