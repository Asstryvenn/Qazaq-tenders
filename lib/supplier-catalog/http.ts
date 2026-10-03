/**
 * Абстракция HTTP для адаптеров. В продакшене — safeFetch (SSRF-защита, лимиты),
 * в тестах — подставной транспорт. Адаптеры не знают про сеть и секреты напрямую.
 */
import { SYNC_LIMITS } from "./limits.ts";
import { SourceError, errorFromStatus } from "./errors.ts";

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  url: string;
}

export interface HttpRequest {
  headers?: Record<string, string>;
  maxBytes: number;
  timeoutMs?: number;
}

export type HttpGet = (url: string, request: HttpRequest) => Promise<HttpResponse>;

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxRetryAfterMs?: number;
  sleep?: Sleep;
  /** Абсолютный дедлайн запуска (Date.now()). */
  deadline?: number;
  onRetry?: (attempt: number, error: SourceError, waitMs: number) => void;
}

/**
 * Повтор временных ошибок с экспоненциальной задержкой и учётом Retry-After.
 * 401/403/404/неверный формат не повторяются. Слишком долгий Retry-After прерывает запуск.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? SYNC_LIMITS.retryAttempts;
  const base = options.baseMs ?? SYNC_LIMITS.retryBaseMs;
  const maxRetryAfter = options.maxRetryAfterMs ?? SYNC_LIMITS.maxRetryAfterMs;
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = e instanceof SourceError ? e : new SourceError("unavailable", (e as Error)?.message ?? "");
      if (!err.transient || attempt >= attempts) throw err;
      let wait = base * 2 ** (attempt - 1);
      if (err.retryAfterMs != null) {
        if (err.retryAfterMs > maxRetryAfter) throw err;
        wait = Math.max(wait, err.retryAfterMs);
      }
      if (options.deadline && Date.now() + wait > options.deadline) throw new SourceError("budget_exceeded", err.code);
      options.onRetry?.(attempt, err, wait);
      await sleep(wait);
    }
  }
}

/** GET + проверка статуса + JSON. */
export async function getJson(get: HttpGet, url: string, request: HttpRequest): Promise<unknown> {
  const res = await get(url, { ...request, headers: { Accept: "application/json", ...request.headers } });
  if (res.status < 200 || res.status >= 300) throw errorFromStatus(res.status, res.headers["retry-after"]);
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(res.body).replace(/^﻿/, ""));
  } catch {
    throw new SourceError("invalid_format", "invalid JSON");
  }
}

export async function getText(get: HttpGet, url: string, request: HttpRequest): Promise<{ text: string; headers: Record<string, string> }> {
  const res = await get(url, request);
  if (res.status < 200 || res.status >= 300) throw errorFromStatus(res.status, res.headers["retry-after"]);
  const ct = res.headers["content-type"] ?? "";
  const charset = ct.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase();
  let text: string;
  try {
    text = new TextDecoder(charset === "windows-1251" || charset === "cp1251" ? "windows-1251" : "utf-8").decode(res.body);
  } catch {
    text = new TextDecoder("utf-8").decode(res.body);
  }
  // XML с объявлением encoding="windows-1251", но без charset в заголовке.
  if (!charset && /^\s*<\?xml[^>]*encoding=["']windows-1251["']/i.test(text.slice(0, 200))) text = new TextDecoder("windows-1251").decode(res.body);
  return { text, headers: res.headers };
}
