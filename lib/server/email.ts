/**
 * Transactional email via Resend (https://resend.com). Configure RESEND_API_KEY and a verified
 * sender DIGEST_FROM_EMAIL (e.g. "Qazaq Tenders <digest@qazaqtenders.kz>"). Without them email
 * is skipped — Telegram delivery is unaffected. Resend allows ~2 requests/second by default.
 */
let nextAt = 0;

export type EmailResult = { ok: true } | { ok: false; skipped?: boolean; error: string };

export async function sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.DIGEST_FROM_EMAIL?.trim();
  if (!key || !from) return { ok: false, skipped: true, error: "email-not-configured" };
  const wait = nextAt - Date.now();
  nextAt = Math.max(Date.now(), nextAt) + 550;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    const d = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: d.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).name };
  }
}
