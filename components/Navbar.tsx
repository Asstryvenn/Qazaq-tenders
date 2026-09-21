"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { Activity } from "lucide-react";
import { Button } from "./ui/Button";
import { Lang, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useProfile } from "@/lib/profile";
import { LogIn, LogOut, Moon, ShieldCheck, Sun, UserRound } from "lucide-react";
import { useIsAdmin } from "@/lib/use-is-admin";
import { useTheme } from "@/lib/theme";
import { NotificationBell } from "./NotificationBell";

function LangToggle() {
  const { lang, setLang } = useI18n();
  const opts: { v: Lang; label: string }[] = [
    { v: "kz", label: "KZ" },
    { v: "ru", label: "RU" },
  ];
  return (
    <div role="group" aria-label={lang === "kz" ? "Тіл" : "Язык"} className="relative flex rounded-lg border border-white/10 bg-white/5 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => setLang(o.v)}
          aria-pressed={lang === o.v}
          className={cn(
            "relative z-10 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
            lang === o.v ? "keep-white text-white" : "text-slate-400 hover:text-slate-200"
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

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { tr } = useI18n();
  const label = theme === "dark" ? tr({ kz: "Жарық режим", ru: "Светлая тема" }) : tr({ kz: "Қараңғы режим", ru: "Тёмная тема" });
  return (
    <button
      onClick={toggle}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-200 transition-colors hover:bg-white/10"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

/**
 * Signed in → company chip + Шығу. A profile saved only in this browser is NOT a session
 * (paying needs one), so it shows the chip plus Кіру — no more "looks logged in but isn't".
 */
function AuthButtons() {
  const { t, tr } = useI18n();
  const { session, isDemo, company, openModal, signOut } = useProfile();
  const logoutLabel = tr({ kz: "Аккаунттан шығу", ru: "Выйти из аккаунта" });

  const signInButtons = (
    <>
      <Button variant="outline" className="px-3.5 py-2 text-sm" onClick={() => openModal("login")}>
        <LogIn className="h-3.5 w-3.5" /> {t.nav.login}
      </Button>
      <Button className="px-4 py-2 text-sm" onClick={() => openModal("register")}>
        {t.nav.register}
      </Button>
    </>
  );

  // Not signed in (also when Supabase runs in local fallback): both actions side by side.
  if (isDemo && !session) return <div className="flex items-center gap-2">{signInButtons}</div>;

  return (
    <div className="flex items-center gap-1.5">
      <Link
        href="/profile"
        className={cn(
          "items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 transition-colors hover:bg-white/10",
          session ? "flex max-w-[170px]" : "hidden max-w-[140px] xl:flex"
        )}
        title={session ? session.user.email ?? t.nav.profile : tr({ kz: "Жергілікті профиль — аккаунтқа кірмегенсіз", ru: "Локальный профиль — вы не вошли в аккаунт" })}
      >
        <UserRound className="h-3.5 w-3.5 shrink-0 text-blue-300" />
        <span className="truncate">{company.name}</span>
      </Link>
      {!session && signInButtons}
      <button onClick={signOut} title={logoutLabel} aria-label={logoutLabel} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Navbar() {
  const { t, tr } = useI18n();
  const { hasAccount } = useProfile();
  const isAdmin = useIsAdmin();
  const adminLabel = tr({ kz: "Админ-панель", ru: "Админ-панель" });
  const ref = useRef<HTMLElement>(null);

  // Full-height views (AI Studio) size themselves with calc(100dvh - var(--nav-h)).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty("--nav-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.header
      ref={ref}
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
            Qazaq<span className="text-wave">Tenders</span>
          </span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {[
            { href: "/#how", label: t.nav.how },
            { href: "/#engine", label: t.nav.engine },
            { href: "/dashboard", label: t.nav.dashboard },
            { href: "/analyze", label: tr({ kz: "PDF талдау", ru: "Анализ PDF" }) },
            { href: "/ai-studio", label: "AI Studio" },
          ]
            // App screens appear only after registration.
            .filter((l) => hasAccount || l.href.startsWith("/#") || l.href === "/analyze")
            .map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-slate-300 transition-colors hover:text-white">
              {l.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/admin" className="text-sm font-medium text-emerald-300 transition-colors hover:text-emerald-200">
              {adminLabel}
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          <LangToggle />
          <ThemeToggle />
          {hasAccount && <NotificationBell />}
          {isAdmin && (
            <Link
              href="/admin"
              title={adminLabel}
              aria-label={adminLabel}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20"
            >
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden lg:inline">{adminLabel}</span>
            </Link>
          )}
          <AuthButtons />
        </div>
      </nav>
    </motion.header>
  );
}
