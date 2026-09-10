"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { Button } from "./ui/Button";
import { Lang, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useProfile } from "@/lib/profile";
import { LogOut, UserRound } from "lucide-react";
import { NotificationBell } from "./NotificationBell";

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

function AuthButtons() {
  const { t } = useI18n();
  const { session, isDemo, company, openModal, signOut } = useProfile();
  void openModal;

  if (session || !isDemo) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href="/profile"
          className="flex max-w-[180px] items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 transition-colors hover:bg-white/10"
          title={t.nav.profile}
        >
          <UserRound className="h-3.5 w-3.5 shrink-0 text-blue-300" />
          <span className="truncate">{company.name}</span>
        </Link>
        {session && (
          <button onClick={signOut} title={t.nav.logout} aria-label={t.nav.logout} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white">
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" className="px-3 py-2 text-sm" onClick={() => openModal("login")}>
        {t.nav.login}
      </Button>
      <Button className="px-4 py-2 text-sm" onClick={() => openModal("register")}>
        {t.nav.register}
      </Button>
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
          <NotificationBell />
          <AuthButtons />
        </div>
      </nav>
    </motion.header>
  );
}
