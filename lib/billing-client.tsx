"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useProfile } from "./profile";
import type { ChatEvent } from "./chat-types";
import type { PlanId } from "./plans";

export interface BillingStatus {
  plan: PlanId;
  until: string | null;
  period: "day" | "month";
  limit: number | null;
  used: number;
  remaining: number | null;
  paymentsMode: "cloudpayments" | "test" | "off";
  signedIn: boolean;
}

interface BillingValue {
  status: BillingStatus | null;
  plan: PlanId;
  refresh: () => Promise<BillingStatus | null>;
  /** Update the counter from a streamed `quota` event without refetching. */
  applyQuota: (q: Extract<ChatEvent, { t: "quota" }>) => void;
  /** Authorization header for API calls that the server gates by plan. */
  headers: () => Record<string, string>;
  checkoutPlan: PlanId | null;
  openCheckout: (plan?: PlanId) => void;
  closeCheckout: () => void;
}

const Ctx = createContext<BillingValue | null>(null);

/** Server-backed plan & quota. Nothing here can grant access — it only mirrors the server. */
export function BillingProvider({ children }: { children: React.ReactNode }) {
  const { session } = useProfile();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);

  const headers = useCallback((): Record<string, string> => (session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), [session]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/billing/status", { headers: headers(), cache: "no-store" });
      const d = (await r.json()) as BillingStatus;
      setStatus(d);
      return d;
    } catch {
      return null;
    }
  }, [headers]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const applyQuota = useCallback(
    (q: Extract<ChatEvent, { t: "quota" }>) =>
      setStatus((s) => (s ? { ...s, plan: q.plan, period: q.period, limit: q.limit, remaining: q.remaining, used: q.limit !== null && q.remaining !== null ? q.limit - q.remaining : s.used } : s)),
    []
  );

  return (
    <Ctx.Provider
      value={{
        status,
        plan: status?.plan ?? "free",
        refresh,
        applyQuota,
        headers,
        checkoutPlan,
        openCheckout: (p) => setCheckoutPlan(p ?? "pro"),
        closeCheckout: () => setCheckoutPlan(null),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useBilling() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBilling must be used inside <BillingProvider>");
  return v;
}
