"use client";

import { Lock } from "lucide-react";
import { useBilling } from "@/lib/billing-client";
import { useI18n } from "@/lib/i18n";
import { TIERS } from "@/lib/chat-client";
import { can, FEATURE_MIN_PLAN, type Feature } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";

/**
 * Blurs a section with an upgrade prompt when the plan doesn't include `feature`.
 * Presentation only — the engine runs in the browser; server-side limits live in the APIs.
 */
export function PlanGate({ feature, children, className }: { feature: Feature; children: React.ReactNode; className?: string }) {
  const { plan, openCheckout } = useBilling();
  const { tr } = useI18n();
  if (can(plan, feature)) return <div className={className}>{children}</div>;
  const need = FEATURE_MIN_PLAN[feature];
  const m = TIERS[need];
  return (
    <div className={cn("relative", className)}>
      <div aria-hidden className="pointer-events-none h-full select-none opacity-50 blur-[6px]">
        {children}
      </div>
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="max-w-xs rounded-2xl border bg-ink-800/95 p-5 text-center shadow-card" style={{ borderColor: `${m.color}66` }}>
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl" style={{ background: `${m.color}22`, color: m.color }}>
            <Lock className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-white">
            {m.icon} {need === "pro" ? "PRO/MAX" : m.name} {tr({ kz: "керек", ru: "нужен" })}
          </p>
          <p className="mt-1 text-xs text-slate-400">{tr(m.features[0])}</p>
          <Button className="mt-4 w-full px-3 py-2 text-xs" onClick={() => openCheckout(need)}>
            {tr({ kz: "Тарифті жаңарту", ru: "Улучшить тариф" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
