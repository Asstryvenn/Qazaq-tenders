/**
 * Rate-limited Telegram sender for batch jobs.
 * Telegram allows ~30 messages/second overall and ~1 message/second per chat; we stay below
 * (25/s global, 1.1 s per chat), honour 429 `retry_after`, and report blocked chats (403).
 */
export interface SendResult {
  ok: boolean;
  blocked?: boolean;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TelegramQueue {
  private nextGlobal = 0;
  private nextByChat = new Map<string, number>();

  constructor(
    private readonly token: string,
    private readonly opts = { perSecond: 25, perChatMs: 1100, maxRetries: 3, fetchImpl: fetch as typeof fetch }
  ) {}

  /** Reserve the next allowed slot for this chat (global and per-chat spacing). */
  private async slot(chatId: string): Promise<void> {
    const now = Date.now();
    const globalAt = Math.max(now, this.nextGlobal);
    const chatAt = Math.max(now, this.nextByChat.get(chatId) ?? 0);
    const at = Math.max(globalAt, chatAt);
    this.nextGlobal = at + 1000 / this.opts.perSecond;
    this.nextByChat.set(chatId, at + this.opts.perChatMs);
    if (at > now) await sleep(at - now);
  }

  async send(chatId: string | number, text: string): Promise<SendResult> {
    const id = String(chatId);
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      await this.slot(id);
      try {
        const res = await this.opts.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
          signal: AbortSignal.timeout(10_000),
        });
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } };
        if (d.ok) return { ok: true };
        if (res.status === 429) {
          await sleep(((d.parameters?.retry_after ?? 1) + 0.2) * 1000);
          continue;
        }
        if (res.status === 403) return { ok: false, blocked: true, error: d.description };
        return { ok: false, error: d.description ?? `HTTP ${res.status}` };
      } catch (e) {
        if (attempt === this.opts.maxRetries) return { ok: false, error: (e as Error).name };
        await sleep(500 * (attempt + 1));
      }
    }
    return { ok: false, error: "rate-limited" };
  }
}

/** Runs async jobs with bounded concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
