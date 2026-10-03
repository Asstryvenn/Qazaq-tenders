"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogIn, LogOut, Menu, Moon, ShieldCheck, Sun, UserRound, X } from "lucide-react";
import { Button } from "./ui/Button";
import { Lang, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useProfile } from "@/lib/profile";
import { useIsAdmin } from "@/lib/use-is-admin";
import { useTheme } from "@/lib/theme";
import { NotificationBell } from "./NotificationBell";

/** Знак: квадрат с «столбиком» — график/лот, без иконок-клипартов. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative grid h-6 w-6 place-items-center border border-fg bg-fg", className)} aria-hidden>
      <span className="absolute bottom-1 left-1 h-2 w-1 bg-app-bg" />
      <span className="absolute bottom-1 left-[9px] h-3 w-1 bg-app-bg" />
      <span className="absolute bottom-1 left-[15px] h-[14px] w-1 bg-app-bg" />
    </span>
  );
}

function LangToggle() {
  const { lang, setLang } = useI18n();
  const opts: { v: Lang; label: string }[] = [
    { v: "kz", label: "KZ" },
    { v: "ru", label: "RU" },
  ];
  return (
    <div role="group" aria-label={lang === "kz" ? "Тіл" : "Язык"} className="flex h-8 border border-line">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => setLang(o.v)}
          aria-pressed={lang === o.v}
          className={cn("px-2.5 font-mono text-[11px] font-semibold transition-colors", lang === o.v ? "bg-fg text-app-bg" : "text-zinc-500 hover:text-fg")}
        >
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
    <button onClick={toggle} aria-label={label} title={label} className="grid h-8 w-8 place-items-center border border-line text-zinc-400 transition-colors hover:border-fg/60 hover:text-fg">
      {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Вошёл → чип компании + выход. Профиль только в этом браузере — НЕ сессия (оплата требует входа),
 * поэтому показываем чип и «Кіру».
 */
function AuthButtons({ stacked = false, onAction }: { stacked?: boolean; onAction?: () => void }) {
  const { t, tr } = useI18n();
  const { session, isDemo, company, openModal, signOut } = useProfile();
  const logoutLabel = tr({ kz: "Аккаунттан шығу", ru: "Выйти из аккаунта" });
  const open = (m: "login" | "register") => {
    onAction?.();
    openModal(m);
  };
  const signInButtons = (
    <>
      <Button variant="outline" className={cn("h-8 px-3 py-0 text-[13px]", stacked && "h-11 w-full text-sm")} onClick={() => open("login")}>
        <LogIn className="h-3.5 w-3.5" /> {t.nav.login}
      </Button>
      <Button className={cn("h-8 px-3.5 py-0 text-[13px]", stacked && "h-11 w-full text-sm")} onClick={() => open("register")}>
        {t.nav.register}
      </Button>
    </>
  );

  if (isDemo && !session) return <div className={cn("flex items-center gap-2", stacked && "flex-col")}>{signInButtons}</div>;

  return (
    <div className={cn("flex items-center gap-1.5", stacked && "flex-col items-stretch gap-2")}>
      <Link
        href="/profile"
        onClick={onAction}
        className={cn(
          "h-8 items-center gap-2 border border-line px-3 text-xs text-zinc-300 transition-colors hover:border-fg/60 hover:text-fg",
          stacked ? "flex h-11" : session ? "flex max-w-[180px]" : "hidden max-w-[140px] xl:flex"
        )}
        title={session ? session.user.email ?? t.nav.profile : tr({ kz: "Жергілікті профиль — аккаунтқа кірмегенсіз", ru: "Локальный профиль — вы не вошли в аккаунт" })}
      >
        <UserRound className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{company.name}</span>
      </Link>
      {!session && signInButtons}
      <button
        onClick={() => {
          onAction?.();
          signOut();
        }}
        title={logoutLabel}
        aria-label={logoutLabel}
        className={cn("grid h-8 w-8 place-items-center text-zinc-500 transition-colors hover:text-fg", stacked && "flex h-11 w-full items-center justify-center gap-2 border border-line text-sm")}
      >
        <LogOut className="h-4 w-4" />
        {stacked && logoutLabel}
      </button>
    </div>
  );
}

export function Navbar() {
  const { t, tr } = useI18n();
  const { hasAccount } = useProfile();
  const isAdmin = useIsAdmin();
  const pathname = usePathname();
  const adminLabel = tr({ kz: "Админ-панель", ru: "Админ-панель" });
  const ref = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false);

  // Экраны на всю высоту (AI Studio) считают calc(100dvh - var(--nav-h)).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty("--nav-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = menu ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menu]);

  const links = [
    { href: "/home", label: tr({ kz: "Басты бет", ru: "Главная" }), show: true },
    { href: "/dashboard", label: t.nav.dashboard, show: true },
    { href: "/analyze", label: tr({ kz: "PDF талдау", ru: "Анализ PDF" }), show: true },
    { href: "/ai-studio", label: "AI Studio", show: hasAccount },
    { href: "/supplier", label: tr({ kz: "Жеткізушілерге", ru: "Поставщикам" }), show: true },
    { href: "/admin", label: adminLabel, show: isAdmin },
  ].filter((l) => l.show);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === "/dashboard" && pathname.startsWith("/tender/"));

  return (
    <>
    <header ref={ref} className="sticky top-0 z-50 border-b border-line bg-app-bg/95 backdrop-blur supports-[backdrop-filter]:bg-app-bg/80">
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/home" className="flex shrink-0 items-center gap-2.5" aria-label="Qazaq Tenders">
          <LogoMark />
          <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em] text-fg">
            Qazaq<span className="text-zinc-500">Tenders</span>
          </span>
        </Link>

        <div className="hidden h-full items-center gap-6 lg:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={cn(
                "relative flex h-full items-center text-[13px] transition-colors",
                isActive(l.href) ? "text-fg" : "text-zinc-500 hover:text-fg"
              )}
            >
              {l.label}
              {isActive(l.href) && <span className="absolute inset-x-0 bottom-0 h-px bg-fg" />}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">
            <LangToggle />
            <ThemeToggle />
          </div>
          {hasAccount && <NotificationBell />}
          {isAdmin && (
            <Link href="/admin" title={adminLabel} aria-label={adminLabel} className="hidden h-8 items-center gap-1.5 border border-line px-2.5 text-xs text-zinc-300 hover:text-fg xl:flex">
              <ShieldCheck className="h-3.5 w-3.5" />
            </Link>
          )}
          <div className="hidden lg:block">
            <AuthButtons />
          </div>
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            aria-controls="mobile-menu"
            aria-label={menu ? tr({ kz: "Мәзірді жабу", ru: "Закрыть меню" }) : tr({ kz: "Мәзір", ru: "Меню" })}
            className="grid h-9 w-9 place-items-center border border-line text-fg lg:hidden"
          >
            {menu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </nav>
    </header>

      {/* Вне <header>: backdrop-filter шапки иначе станет контейнером для position: fixed. */}
      {menu && (
        <div id="mobile-menu" className="fixed inset-x-0 bottom-0 top-14 z-50 overflow-y-auto border-t border-line bg-app-bg lg:hidden">
          <div className="flex min-h-full flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
            <ul className="divide-y divide-line border-b border-line">
              {links.map((l, i) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={() => setMenu(false)} className={cn("flex items-center justify-between py-4 text-lg", isActive(l.href) ? "text-fg" : "text-zinc-400")}>
                    <span>{l.label}</span>
                    <span className="font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center gap-2">
              <LangToggle />
              <ThemeToggle />
            </div>
            <div className="mt-auto pt-8">
              <AuthButtons stacked onAction={() => setMenu(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
