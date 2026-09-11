"use client";

import { Check } from "lucide-react";
import { TIERS } from "@/lib/chat-client";
import { TIER_RANK, type Tier } from "@/lib/chat-types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Modal } from "../auth/Modal";
import { Button } from "../ui/Button";

/** Plan comparison. Payment isn't integrated — switching is an explicit demo action. */
export function UpgradeModal({
  open,
  highlight,
  plan,
  onClose,
  onSelect,
}: {
  open: boolean;
  highlight: Tier;
  plan: Tier;
  onClose: () => void;
  onSelect: (t: Tier) => void;
}) {
  const { tr } = useI18n();
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={tr({ kz: "Жоспарды таңдаңыз", ru: "Выберите план" })}
      subtitle={tr({ kz: "Сандарды әрдайым детерминистік қозғалтқыш есептейді", ru: "Числа всегда считает детерминированный движок" })}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {(Object.keys(TIERS) as Tier[]).map((t) => {
          const m = TIERS[t];
          const current = t === plan;
          return (
            <div
              key={t}
              className={cn("flex flex-col rounded-2xl border p-4", t === highlight ? "bg-white/[0.06]" : "border-white/10 bg-white/[0.02]")}
              style={t === highlight ? { borderColor: `${m.color}99`, boxShadow: `0 0 30px -12px ${m.color}` } : undefined}
            >
              <p className="text-sm font-semibold text-white">
                {m.icon} {m.name}
              </p>
              <p className="mt-1 font-mono text-xl font-bold" style={{ color: m.color }}>
                {tr(m.price)}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{m.model}</p>
              <ul className="mt-4 flex-1 space-y-2">
                {m.features.map((f) => (
                  <li key={f.ru} className="flex gap-2 text-sm text-slate-200">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: m.color }} />
                    {tr(f)}
                  </li>
                ))}
              </ul>
              <Button
                variant={current ? "outline" : "primary"}
                disabled={current}
                onClick={() => {
                  onSelect(t);
                  onClose();
                }}
                className="mt-5 w-full disabled:opacity-60"
              >
                {current
                  ? tr({ kz: "Ағымдағы жоспар", ru: "Текущий план" })
                  : TIER_RANK[t] > TIER_RANK[plan]
                    ? tr({ kz: "Демо режимде қосу", ru: "Включить в демо-режиме" })
                    : tr({ kz: "Ауысу", ru: "Перейти" })}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">
        {tr({ kz: "Төлем жүйесі әлі қосылмаған — жоспар таныстыру үшін ауыстырылады.", ru: "Оплата пока не подключена — план переключается для демонстрации." })}
      </p>
    </Modal>
  );
}
