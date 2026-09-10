"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { Button } from "./ui/Button";
import { Lang, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function LangToggle() {
  const { lang, setLang } = useI18n();
  const opts: { v: Lang; label: string }[] = [
    { v: "kz", label: "KZ" },
    { v: "ru", label: "RU" },
  ];
  return (
    <div role="group" aria-label="Language" className="relative flex rounded-lg border border-white/10 bg-white/5 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => setLang(o.v)}
          aria-pressed={lang === o.v}
          className={cn(
            "relative z-10 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
            lang === o.v ? "text-white" : "text-slate-400 hover:text-slate-200"
          )}
        >
          {lang === o.v && (
            <motion.span
              layoutId="lang-pill"
              className="absolute inset-0 -z-10 rounded-md bg-accent-blue shadow-glow"
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Navbar() {
  const { t } = useI18n();
  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="sticky top-0 z-50 border-b border-white/5 bg-ink/70 backdrop-blur-xl"
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative grid h-9 w-9 place-items-center rounded-xl border border-blue-400/30 bg-accent-blue/15">
            <Activity className="h-4 w-4 text-blue-300" />
            <span className="absolute inset-0 animate-pulse-ring rounded-xl border border-blue-400/40" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">
            Qazaq<span className="text-blue-400">Tenders</span>
          </span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {[
            { href: "/#how", label: t.nav.how },
            { href: "/#engine", label: t.nav.engine },
            { href: "/dashboard", label: t.nav.dashboard },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-slate-300 transition-colors hover:text-white">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <LangToggle />
          <Link href="/dashboard" className="hidden sm:block">
            <Button className="text-sm">{t.nav.open}</Button>
          </Link>
        </div>
      </nav>
    </motion.header>
  );
}
