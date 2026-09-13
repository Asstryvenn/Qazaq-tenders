/**
 * Product event log (table `events`, migration 0006) — feeds the admin dashboard.
 * Writes go through the service key only; users cannot read or write the table.
 * Logging never breaks the request: without the key or the table it is a no-op.
 */
import { adminClient } from "./auth";

export type EventType =
  | "bin_lookup"
  | "tender_analyzed"
  | "pdf_analysis"
  | "logistics_choice"
  | "integration_error"
  | "admin_action";

/** Types the browser may report through /api/events. */
export const CLIENT_EVENT_TYPES: ReadonlySet<string> = new Set(["tender_analyzed", "logistics_choice"]);

let warned = false;

export async function logEvent(type: EventType, opts: { userId?: string | null; meta?: Record<string, unknown> } = {}): Promise<void> {
  const admin = adminClient();
  if (!admin) return;
  try {
    const { error } = await admin.from("events").insert({ type, user_id: opts.userId ?? null, meta: opts.meta ?? {} });
    if (error && !warned) {
      warned = true;
      console.warn(`[events] not logged (${error.message}) — apply supabase/migrations/0006_events.sql`);
    }
  } catch {
    // analytics must never fail the request
  }
}

/** Integration failure (not "no key" — that is a configuration state, not an error). */
export async function logIntegrationError(source: string, status: string, detail = ""): Promise<void> {
  await logEvent("integration_error", { meta: { source, status, detail: detail.slice(0, 300) } });
}
