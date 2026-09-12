"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useProfile } from "./profile";
import type { ChatEvent } from "./chat-types";
import { isPlan, PLAN_RANK, PLANS, type PlanId } from "./plans";

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
  /** Apply a plan the server just activated (test checkout) without waiting for a refetch. */
  grant: (plan: PlanId, until: string) => void;
  checkoutPlan: PlanId | null;
  openCheckout: (plan?: PlanId) => void;
  closeCheckout: () => void;
}

const Ctx = createContext<BillingValue | null>(null);

/**
 * Demo/test checkout: the plan the user "bought" is also remembered in this browser, tied to
 * their user id, so the UI never falls back to FREE while payments are in test mode. Only
 * affects display — the APIs still read the plan from the database.
 */
const GRANT_KEY = "qt-test-plan";
type Grant = { uid: string; plan: PlanId; until: string };

function readGrant(uid: string | undefined): Grant | null {
  if (!uid) return null;
  try {
    const g = JSON.parse(localStorage.getItem(GRANT_KEY) || "null") as Grant | null;
    return g && g.uid === uid && isPlan(g.plan) && new Date(g.until).getTime() > Date.now() ? g : null;
  } catch {
    return null;
  }
}

/** Server-backed plan & quota. Nothing here can grant access — it only mirrors the server. */
export function BillingProvider({ children }: { children: React.ReactNode }) {
  const { session, loading } = useProfile();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);
  const [grantTick, setGrantTick] = useState(0);
  // Only the latest request may update the state: an anonymous response that arrives after
  // the signed-in one must not reset the plan to FREE.
  const seq = useRef(0);

  const headers = useCallback((): Record<string, string> => (session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), [session]);

  const refresh = useCallback(async () => {
    const id = ++seq.current;
    try {
      const r = await fetch("/api/billing/status", { headers: headers(), cache: "no-store" });
      const d = (await r.json()) as BillingStatus;
      if (id === seq.current) setStatus(d);
      return d;
    } catch {
      return null;
    }
  }, [headers]);

  // Wait until the profile knows whether there is a session — no anonymous round-trip first.
  useEffect(() => {
    if (!loading) refresh();
  }, [refresh, loading]);

  const grant = useCallback(
    (plan: PlanId, until: string) => {
      const uid = session?.user.id;
      if (uid) {
        try {
          localStorage.setItem(GRANT_KEY, JSON.stringify({ uid, plan, until } satisfies Grant));
        } catch {}
      }
      setGrantTick((t) => t + 1);
    },
    [session]
  );

  // Effective status: the server's, raised to a still-valid test purchase if that is higher.
  void grantTick;
  const g = status?.paymentsMode === "test" ? readGrant(session?.user.id) : null;
  const effective: BillingStatus | null =
    status && g && PLAN_RANK[g.plan] > PLAN_RANK[status.plan]
      ? { ...status, plan: g.plan, until: g.until, period: "month", limit: PLANS[g.plan].monthly, remaining: PLANS[g.plan].monthly }
      : status;

  const applyQuota = useCallback(
    (q: Extract<ChatEvent, { t: "quota" }>) =>
      setStatus((s) => (s ? { ...s, plan: q.plan, period: q.period, limit: q.limit, remaining: q.remaining, used: q.limit !== null && q.remaining !== null ? q.limit - q.remaining : s.used } : s)),
    []
  );

  return (
    <Ctx.Provider
      value={{
        status: effective,
        plan: effective?.plan ?? "free",
        refresh,
        applyQuota,
        headers,
        grant,
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
