"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { analyzeTender } from "./engine";
import { deadlineAt, readDocState } from "./documents";
import { formatKzt, useI18n } from "./i18n";
import { useProfile } from "./profile";
import type { AnalysisResult, TenderSpec } from "./types";
import type { TenderFeed } from "./tenders/source";

export type AlertKind = "tos" | "deadline" | "cashflow";

export interface AppAlert {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  tenderId?: string;
  /** ms epoch — for sorting and "x min ago" */
  at: number;
  simulated?: boolean;
}

export interface Toast {
  id: string;
  kind: AlertKind | "info" | "error" | "success";
  title: string;
  body?: string;
  href?: string;
}

interface NotificationsValue {
  feed: TenderFeed | null;
  results: Map<string, AnalysisResult>;
  alerts: AppAlert[];
  unread: number;
  isRead: (id: string) => boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Adds an alert to the centre and flashes it as a toast. */
  simulate: () => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<NotificationsValue | null>(null);
const READ_KEY = "qt-read-alerts";
const HIGH_TOS = 75;
const HOUR = 3_600_000;

/**
 * Derives alerts from the live feed + engine + checklist state. Everything is computed
 * client-side from the same numbers the dashboard shows — nothing is invented.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { company } = useProfile();
  const { lang, tr, lotTitle } = useI18n();
  const [feed, setFeed] = useState<TenderFeed | null>(null);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [simulated, setSimulated] = useState<AppAlert[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [docsVersion, setDocsVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    fetch("/api/tenders")
      .then((r) => r.json())
      .then(setFeed)
      .catch(() => setFeed({ live: false, tenders: [], sources: [] }));
    try {
      setRead(new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")));
    } catch {}
    const onDocs = () => setDocsVersion((v) => v + 1);
    window.addEventListener("qt-docs-changed", onDocs);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.removeEventListener("qt-docs-changed", onDocs);
      clearInterval(tick);
    };
  }, []);

  const results = useMemo(() => {
    const m = new Map<string, AnalysisResult>();
    feed?.tenders.forEach((t) => m.set(t.id, analyzeTender(t, company)));
    return m;
  }, [feed, company]);

  const derived = useMemo<AppAlert[]>(() => {
    if (!feed) return [];
    const k = (v: number) => formatKzt(v, lang);
    const out: AppAlert[] = [];
    for (const t of feed.tenders) {
      const r = results.get(t.id)!;
      const title = lotTitle(t);
      const closes = deadlineAt(t).getTime();
      const hoursLeft = (closes - now) / HOUR;
      if (hoursLeft <= 0) continue;

      if (r.verdict === "go" && r.tos >= HIGH_TOS)
        out.push({
          id: `tos:${t.id}`,
          kind: "tos",
          tenderId: t.id,
          at: closes - 14 * 24 * HOUR,
          title: tr({ kz: `Профиліңізге сай жаңа тендер: TOS ${Math.round(r.tos)}/100`, ru: `Новый тендер под ваш профиль: TOS ${Math.round(r.tos)}/100` }),
          body: `${title} · ${k(t.contractAmount)}`,
        });

      if (hoursLeft <= 72) {
        const docs = readDocState(t.id);
        const missingGuarantee = !docs.bidSecurity;
        const left = hoursLeft < 48 ? tr({ kz: `${Math.floor(hoursLeft)} сағат`, ru: `${Math.floor(hoursLeft)} ч` }) : tr({ kz: `${Math.floor(hoursLeft / 24)} күн`, ru: `${Math.floor(hoursLeft / 24)} дн.` });
        out.push({
          id: `deadline:${t.id}:${missingGuarantee ? "g" : "ok"}`,
          kind: "deadline",
          tenderId: t.id,
          at: closes - 72 * HOUR,
          title: tr({ kz: `№ ${t.externalId} лотына ${left} қалды`, ru: `До закрытия лота № ${t.externalId} осталось ${left}` }),
          body: missingGuarantee
            ? tr({ kz: "1% банк кепілдігі әлі дайын емес!", ru: "Не готова 1% банковская гарантия!" })
            : title,
        });
      }

      if (r.cashFlowGap)
        out.push({
          id: `cash:${t.id}`,
          kind: "cashflow",
          tenderId: t.id,
          at: closes - 10 * 24 * HOUR,
          title: tr({ kz: `Кассалық алшақтық: ${r.gapDay}-күні ${k(r.maxDeficit)}`, ru: `Кассовый разрыв: ${k(r.maxDeficit)} на ${r.gapDay}-й день` }),
          body: title,
        });
    }
    return out;
    // docsVersion re-runs this when a checklist changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, results, lang, now, docsVersion]);

  const alerts = useMemo(() => [...simulated, ...derived].sort((a, b) => b.at - a.at), [simulated, derived]);

  const persistRead = (s: Set<string>) => {
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(Array.from(s)));
    } catch {}
  };
  const markRead = useCallback((id: string) => {
    setRead((prev) => {
      const s = new Set(prev).add(id);
      persistRead(s);
      return s;
    });
  }, []);
  const markAllRead = useCallback(() => {
    setRead(() => {
      const s = new Set(alerts.map((a) => a.id));
      persistRead(s);
      return s;
    });
  }, [alerts]);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      setTimeout(() => dismissToast(id), 6500);
    },
    [dismissToast]
  );

  /** Presentation helper: cycles through the three alert kinds using real lots. */
  const simulate = useCallback(() => {
    const lots: TenderSpec[] = feed?.tenders ?? [];
    if (!lots.length) return;
    const kinds: AlertKind[] = ["tos", "deadline", "cashflow"];
    const kind = kinds[simulated.length % kinds.length];
    const byTos = [...lots].sort((a, b) => (results.get(b.id)?.tos ?? 0) - (results.get(a.id)?.tos ?? 0));
    const t = kind === "tos" ? byTos[0] : kind === "deadline" ? [...lots].sort((a, b) => a.deadline.localeCompare(b.deadline))[0] : byTos[byTos.length - 1];
    const r = results.get(t.id)!;
    const k = (v: number) => formatKzt(v, lang);
    const alert: AppAlert = {
      id: `sim:${Date.now()}`,
      kind,
      tenderId: t.id,
      at: Date.now(),
      simulated: true,
      title:
        kind === "tos"
          ? tr({ kz: `Жаңа тендер профиліңізге сай: TOS ${Math.round(r.tos)}/100`, ru: `Новый тендер под ваш профиль: TOS ${Math.round(r.tos)}/100` })
          : kind === "deadline"
            ? tr({ kz: `№ ${t.externalId} лотына 24 сағат қалды. 1% банк кепілдігі жоқ!`, ru: `До лота № ${t.externalId} осталось 24 ч. Нет 1% банковской гарантии!` })
            : tr({ kz: "Бақыланатын тендерде жеткізуші бағасы өзгерді (+8%)", ru: "Изменилась цена поставщика по отслеживаемому тендеру (+8%)" }),
      body: kind === "cashflow" ? `${lotTitle(t)} · ${k(r.netProfit)}` : lotTitle(t),
    };
    setSimulated((s) => [alert, ...s]);
    toast({ kind, title: alert.title, body: alert.body, href: `/tender/${encodeURIComponent(t.id)}` });
  }, [feed, results, simulated.length, lang, tr, lotTitle, toast]);

  const isRead = useCallback((id: string) => read.has(id), [read]);
  const unread = alerts.filter((a) => !read.has(a.id)).length;

  return (
    <Ctx.Provider value={{ feed, results, alerts, unread, isRead, markRead, markAllRead, simulate, toasts, toast, dismissToast }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNotifications must be used inside <NotificationsProvider>");
  return v;
}
