/** Minimal server-side Telegram Bot API client. Never import from client components. */

export class TelegramError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** Read per request, so editing .env.local is picked up without code changes. */
export function botToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/** "@qazaqtendersbot" and "qazaqtendersbot" both work. */
export const cleanUsername = (v: string | undefined | null) => (v ?? "").trim().replace(/^@+/, "");

export function botUsernameFromEnv(): string {
  return cleanUsername(process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME);
}

export async function tg<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = botToken();
  if (!token) throw new TelegramError("no-bot-token", 503);
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const json = await res.json();
  if (!json.ok) throw new TelegramError(json.description || "telegram-error", res.status === 200 ? 502 : res.status);
  return json.result as T;
}

/** Escape text for parse_mode "HTML" (far fewer pitfalls than MarkdownV2). */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram rejects inline-button URLs pointing at localhost. */
export function isPublicUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol.startsWith("http") && !["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname) && !hostname.endsWith(".local");
  } catch {
    return false;
  }
}

/**
 * Base URL for links inside Telegram messages. NEXT_PUBLIC_APP_URL wins only if it is a
 * public address — a copied "http://localhost:3077" must not disable buttons in production.
 * Otherwise the request's own origin (on Vercel that is the real domain).
 */
export function publicBaseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (env && isPublicUrl(env)) return env;
  const host = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/** A chat id is an integer (negative for groups). */
export const isChatId = (v: unknown): v is string | number => /^-?\d{3,20}$/.test(String(v ?? ""));
