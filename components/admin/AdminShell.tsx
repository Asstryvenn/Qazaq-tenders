"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, BarChart3, LayoutDashboard, Loader2, Settings, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { useProfile } from "@/lib/profile";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", Icon: Users },
  { href: "/admin/analytics", label: "Analytics", Icon: BarChart3 },
  { href: "/admin/health", label: "API Health", Icon: Activity },
  { href: "/admin/settings", label: "Settings", Icon: Settings },
];

type Gate = "checking" | "ok" | "denied";

/** Renders the admin area only after the server confirms the admin role. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { session, loading } = useProfile();
  const router = useRouter();
  const pathname = usePathname();
  const [gate, setGate] = useState<Gate>("checking");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!session) {
      setGate("denied");
      router.replace("/");
      return;
    }
    let cancelled = false;
    fetch("/api/admin/me", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) {
          setEmail((await r.json()).email ?? "");
          setGate("ok");
        } else {
          setGate("denied");
          router.replace("/");
        }
      })
      .catch(() => !cancelled && setGate("denied"));
    return () => {
      cancelled = true;
    };
  }, [loading, session, router]);

  if (gate !== "ok")
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        {gate === "checking" ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Проверяем доступ…
          </p>
        ) : (
          <div>
            <ShieldAlert className="mx-auto h-8 w-8 text-rose-400" />
            <p className="mt-3 text-lg font-semibold text-white">403 — доступ запрещён</p>
            <p className="mt-1 text-sm text-slate-400">Админ-панель доступна только администраторам.</p>
          </div>
        )}
      </div>
    );

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-4 pb-16 pt-6 lg:grid-cols-[220px_1fr] lg:px-6">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="glass p-3">
          <p className="flex items-center gap-2 px-2 pb-3 pt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> Admin
          </p>
          <nav className="flex gap-1 overflow-x-auto lg:flex-col">
            {NAV.map(({ href, label, Icon }) => {
              const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active ? "bg-accent-blue/15 font-semibold text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </Link>
              );
            })}
          </nav>
          <p className="mt-3 truncate border-t border-white/5 px-2 pt-3 text-[11px] text-slate-500">{email}</p>
        </div>
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
