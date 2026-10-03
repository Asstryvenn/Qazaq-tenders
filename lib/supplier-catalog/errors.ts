/**
 * Ошибки источников каталога. Код — для UI и журнала, detail — только безопасные подробности
 * (никаких URL с параметрами, логинов, токенов).
 */
export type SourceErrorCode =
  | "auth"
  | "forbidden"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "too_large"
  | "not_found"
  | "invalid_format"
  | "malformed_xml"
  | "xml_dtd_forbidden"
  | "unsupported_feed"
  | "blocked_url"
  | "redirect_blocked"
  | "tls"
  | "secrets_key_missing"
  | "service_unavailable"
  | "incomplete"
  | "budget_exceeded"
  | "config"
  | "busy"
  | "empty_snapshot";

/** Временные ошибки — повторяем с backoff; остальные — сразу останавливаемся. */
const TRANSIENT: SourceErrorCode[] = ["unavailable", "timeout", "rate_limited"];

export class SourceError extends Error {
  code: SourceErrorCode;
  detail: string;
  retryAfterMs: number | null;
  httpStatus: number | null;
  constructor(code: SourceErrorCode, detail = "", extra: { retryAfterMs?: number | null; httpStatus?: number | null } = {}) {
    super(code);
    this.name = "SourceError";
    this.code = code;
    this.detail = redactSecrets(detail).slice(0, 300);
    this.retryAfterMs = extra.retryAfterMs ?? null;
    this.httpStatus = extra.httpStatus ?? null;
  }
  get transient(): boolean {
    return TRANSIENT.includes(this.code);
  }
}

/** HTTP-статус источника → ошибка. 401/403 останавливают синхронизацию до исправления доступа. */
export function errorFromStatus(status: number, retryAfterHeader?: string | null): SourceError {
  if (status === 401) return new SourceError("auth", "HTTP 401", { httpStatus: status });
  if (status === 403) return new SourceError("forbidden", "HTTP 403", { httpStatus: status });
  if (status === 404 || status === 410) return new SourceError("not_found", `HTTP ${status}`, { httpStatus: status });
  if (status === 429) return new SourceError("rate_limited", "HTTP 429", { httpStatus: status, retryAfterMs: parseRetryAfter(retryAfterHeader) });
  if (status === 408 || status >= 500) return new SourceError("unavailable", `HTTP ${status}`, { httpStatus: status, retryAfterMs: parseRetryAfter(retryAfterHeader) });
  return new SourceError("invalid_format", `HTTP ${status}`, { httpStatus: status });
}

/** Retry-After: секунды или HTTP-дата. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/**
 * Удаляет из текста всё, что может быть секретом: параметры и userinfo URL,
 * заголовки Authorization, Basic/Bearer-токены, пары password=…/token=….
 */
export function redactSecrets(text: string): string {
  return String(text)
    .replace(/(https?:\/\/)([^\s/@]+@)/gi, "$1***@")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1?***")
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*[^\s,;]+(\s+[^\s,;]+)?/gi, "$1: ***")
    .replace(/\b(basic|bearer)\s+[a-z0-9._~+/=-]{6,}/gi, "$1 ***")
    .replace(/\b(password|passwd|pwd|token|api[_-]?key|secret|key)\s*[=:]\s*[^\s&,;]+/gi, "$1=***");
}
