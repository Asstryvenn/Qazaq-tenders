"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard, FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { Modal } from "../auth/Modal";
import { Button } from "../ui/Button";
import { useBilling } from "@/lib/billing-client";
import { useI18n } from "@/lib/i18n";
import { useNotifications } from "@/lib/notifications";
import { useProfile } from "@/lib/profile";
import { priceLabel, TIERS } from "@/lib/chat-client";
import { PLAN_RANK, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase";

const WIDGET_SRC = "https://widget.cloudpayments.ru/bundles/cloudpayments.js";

function loadWidget(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).cp?.CloudPayments) return resolve();
    const s = document.createElement("script");
    s.src = WIDGET_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("widget-load-failed"));
    document.head.appendChild(s);
  });
}

type Checkout = { mode: "cloudpayments" | "test"; amount: number; invoiceId: string; description: string; publicId?: string; accountId?: string; email?: string };

/**
 * Plan picker + payment. Card data never touches Qazaq Tenders: the CloudPayments widget
 * collects it, and only their signed webhook activates a plan. Without merchant keys a
 * clearly-labelled test checkout activates the plan locally.
 */
export function CheckoutModal() {
  const { tr, lang } = useI18n();
  const { session, openModal, pendingEmail, isDemo } = useProfile();
  const { toast } = useNotifications();
  const billing = useBilling();
  const open = billing.checkoutPlan !== null;
  const [selected, setSelected] = useState<PlanId>("pro");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<Checkout | null>(null);

  useEffect(() => {
    if (billing.checkoutPlan) {
      setSelected(billing.checkoutPlan === "free" ? "pro" : billing.checkoutPlan);
      setTest(null);
    }
  }, [billing.checkoutPlan]);

  const current = billing.plan;

  /** After a real payment the webhook activates the plan; poll until the server agrees. */
  const waitForPlan = async (plan: PlanId) => {
    for (let i = 0; i < 30; i++) {
      const s = await billing.refresh();
      if (s && PLAN_RANK[s.plan] >= PLAN_RANK[plan]) {
        toast({ kind: "success", title: tr({ kz: `${TIERS[plan].name} қосылды`, ru: `${TIERS[plan].name} активирован` }) });
        billing.closeCheckout();
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    toast({ kind: "info", title: tr({ kz: "Төлем өңделуде", ru: "Платёж обрабатывается" }), body: tr({ kz: "Тариф бірнеше минутта қосылады.", ru: "Тариф активируется в течение нескольких минут." }) });
  };

  const pay = async () => {
    if (!isSupabaseConfigured) {
      toast({ kind: "info", title: tr({ kz: "Төлем уақытша қолжетімсіз", ru: "Оплата временно недоступна" }), body: tr({ kz: "Сервердегі аккаунттар бапталмаған.", ru: "На сервере не настроены аккаунты." }) });
      return;
    }
    if (!session) {
      billing.closeCheckout();
      // Already registered (profile saved locally) → sign in; otherwise register.
      const hasAccount = !!pendingEmail || !isDemo;
      openModal(hasAccount ? "login" : "register");
      toast({
        kind: "info",
        title: hasAccount ? tr({ kz: "Аккаунтқа кіріңіз", ru: "Войдите в аккаунт" }) : tr({ kz: "Алдымен тіркеліңіз", ru: "Сначала зарегистрируйтесь" }),
        body: tr({ kz: "Тариф аккаунтқа байланады.", ru: "Тариф привязывается к аккаунту." }),
      });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json", ...billing.headers() }, body: JSON.stringify({ plan: selected }) });
      const d = (await r.json()) as Checkout & { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (d.mode === "test") {
        setTest(d);
        return;
      }
      await loadWidget();
      const widget = new (window as any).cp.CloudPayments({ language: lang === "kz" ? "kk" : "ru-RU" });
      billing.closeCheckout();
      widget.pay(
        "charge",
        { publicId: d.publicId, description: d.description, amount: d.amount, currency: "KZT", accountId: d.accountId, invoiceId: d.invoiceId, email: d.email, skin: "modern" },
        {
          onSuccess: () => waitForPlan(selected),
          onFail: (reason: string) => toast({ kind: "error", title: tr({ kz: "Төлем өтпеді", ru: "Платёж не прошёл" }), body: reason }),
        }
      );
    } catch (e) {
      toast({ kind: "error", title: tr({ kz: "Төлемді бастау мүмкін болмады", ru: "Не удалось начать оплату" }), body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const confirmTest = async () => {
    setBusy(true);
    const r = await fetch("/api/billing/test-confirm", { method: "POST", headers: { "Content-Type": "application/json", ...billing.headers() }, body: JSON.stringify({ plan: selected }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return toast({ kind: "error", title: tr({ kz: "Қате", ru: "Ошибка" }), body: d.error });
    const active: PlanId = d.plan ?? selected;
    billing.grant(active, d.until);
    await billing.refresh();
    billing.closeCheckout();
    toast({
      kind: "success",
      title: tr({ kz: `${TIERS[active].name} қосылды (тест)`, ru: `${TIERS[active].name} активирован (тест)` }),
      body: d.persisted ? undefined : tr({ kz: "Сервер жадында — қайта іске қосқанда өшеді.", ru: "В памяти сервера — сбросится при перезапуске." }),
    });
  };

  return (
    <Modal
      open={open}
      onClose={billing.closeCheckout}
      width="max-w-4xl"
      title={tr({ kz: "Тарифті таңдаңыз", ru: "Выберите тариф" })}
      subtitle={tr({ kz: "Шектеулерді сервер тексереді — сандарды әрдайым қозғалтқыш есептейді", ru: "Лимиты проверяет сервер — числа всегда считает движок" })}
    >
      {test ? (
        <div className="space-y-5">
          <div className="flex gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.08] p-4 text-sm text-amber-100">
            <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <p className="font-semibold">{tr({ kz: "Тест төлем режимі", ru: "Тестовый режим оплаты" })}</p>
              <p className="mt-1 leading-relaxed text-amber-100/90">
                {tr({
                  kz: "Visa/Mastercard шлюзі (CloudPayments) кілттері әлі қосылмаған. Нақты ақша алынбайды, карта деректері сұралмайды.",
                  ru: "Ключи шлюза Visa/Mastercard (CloudPayments) ещё не подключены. Деньги не списываются, данные карты не запрашиваются.",
                })}
              </p>
            </div>
          </div>
          <dl className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-400">{tr({ kz: "Тариф", ru: "Тариф" })}</dt>
              <dd className="font-semibold text-white">{TIERS[selected].icon} {TIERS[selected].name}</dd>
            </div>
            <div className="mt-2 flex justify-between">
              <dt className="text-slate-400">{tr({ kz: "Сомасы", ru: "Сумма" })}</dt>
              <dd className="font-mono text-white">{priceLabel(selected, lang)}</dd>
            </div>
            <div className="mt-2 flex justify-between">
              <dt className="text-slate-400">Invoice</dt>
              <dd className="font-mono text-xs text-slate-300">{test.invoiceId}</dd>
            </div>
          </dl>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTest(null)}>
              {tr({ kz: "Артқа", ru: "Назад" })}
            </Button>
            <Button onClick={confirmTest} disabled={busy} className="disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} {tr({ kz: "Тест төлемді растау", ru: "Подтвердить тестовый платёж" })}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {(Object.keys(TIERS) as PlanId[]).map((t) => {
              const m = TIERS[t];
              const isCurrent = t === current;
              const sel = t === selected;
              const selectable = t !== "free" && PLAN_RANK[t] > PLAN_RANK[current];
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!selectable}
                  onClick={() => setSelected(t)}
                  className={cn("flex flex-col rounded-2xl border p-4 text-left transition-colors", sel && selectable ? "bg-white/[0.07]" : "border-white/10 bg-white/[0.02]", !selectable && "cursor-default opacity-80")}
                  style={sel && selectable ? { borderColor: `${m.color}aa`, boxShadow: `0 0 30px -12px ${m.color}` } : undefined}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">
                      {m.icon} {m.name} <span className="font-normal text-slate-400">· {tr(m.sub)}</span>
                    </p>
                    {isCurrent && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">{tr({ kz: "ағымдағы", ru: "текущий" })}</span>}
                  </div>
                  <p className="mt-2 font-mono text-2xl font-bold" style={{ color: m.color }}>
                    {priceLabel(t, lang)}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">{m.model}</p>
                  <ul className="mt-4 space-y-2">
                    {m.features.map((f) => (
                      <li key={f.ru} className="flex gap-2 text-sm text-slate-200">
                        <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: m.color }} />
                        {tr(f)}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              {tr({ kz: "Visa / Mastercard · карта деректерін CloudPayments өңдейді, біз сақтамаймыз", ru: "Visa / Mastercard · данные карты обрабатывает CloudPayments, мы их не храним" })}
            </p>
            <Button onClick={pay} disabled={busy || PLAN_RANK[selected] <= PLAN_RANK[current]} className="disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {tr({ kz: `${TIERS[selected].name} төлеу · ${priceLabel(selected, "kz")}`, ru: `Оплатить ${TIERS[selected].name} · ${priceLabel(selected, "ru")}` })}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
