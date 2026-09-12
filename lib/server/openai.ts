/**
 * OpenAI access for API routes: one place that reads the key, logs whether it exists
 * (first 5 characters only — never the key) and turns OpenAI failures into stable codes
 * the UI can translate. Server-only.
 */

export type OpenAIErrorCode = "OPENAI_KEY_MISSING" | "OPENAI_INVALID_KEY" | "OPENAI_QUOTA" | "OPENAI_UPSTREAM" | "OPENAI_BAD_REQUEST";

export class OpenAIError extends Error {
  constructor(
    public code: OpenAIErrorCode,
    public status: number,
    detail?: string
  ) {
    super(detail ?? code);
  }
}

let logged = false;

/** Trimmed key or null. Read at request time, so a changed env shows up on the next deploy/restart. */
export function getOpenAIKey(): string | null {
  const key = process.env.OPENAI_API_KEY?.trim() || null;
  if (!logged) {
    logged = true;
    console.log(key ? `[openai] OPENAI_API_KEY present: ${key.slice(0, 5)}… (length ${key.length})` : "[openai] OPENAI_API_KEY is MISSING at runtime");
  }
  return key;
}

/** OpenAI echoes a masked key (first 8 + last 4 chars) in errors — strip it before logging or returning. */
export const redactKeys = (s: string) => s.replace(/sk-[A-Za-z0-9_\-*]{4,}/g, "sk-…");

/** HTTP status → stable code. 401/403 = bad key, 429 = rate limit or no balance. */
export function codeForStatus(status: number): OpenAIErrorCode {
  if (status === 401 || status === 403) return "OPENAI_INVALID_KEY";
  if (status === 429) return "OPENAI_QUOTA";
  if (status >= 500) return "OPENAI_UPSTREAM";
  return "OPENAI_BAD_REQUEST";
}

/** Status our route should answer with for a given code. */
export const httpStatusFor = (code: OpenAIErrorCode) =>
  code === "OPENAI_KEY_MISSING" ? 500 : code === "OPENAI_INVALID_KEY" ? 502 : code === "OPENAI_QUOTA" ? 429 : code === "OPENAI_UPSTREAM" ? 503 : 502;

/** Throws OpenAIError with a code for any non-2xx response; logs the OpenAI message (no key). */
export async function assertOpenAIOk(res: Response, where: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 300);
  try {
    message = JSON.parse(text)?.error?.message ?? message;
  } catch {}
  message = redactKeys(message);
  const code = codeForStatus(res.status);
  console.error(`[openai] ${where} failed: HTTP ${res.status} ${code} — ${message}`);
  throw new OpenAIError(code, res.status, message);
}

/** Chat completion returning the parsed JSON content (for json_schema responses). */
export async function openaiJson(apiKey: string, body: Record<string, unknown>, where: string) {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`[openai] ${where} network error: ${(e as Error).message}`);
    throw new OpenAIError("OPENAI_UPSTREAM", 503, (e as Error).message);
  }
  await assertOpenAIOk(res, where);
  const content = (await res.json()).choices?.[0]?.message?.content;
  return JSON.parse(content ?? "{}");
}

/** Standard JSON body for a missing key. */
export const keyMissingBody = { success: false, error: "OPENAI_KEY_MISSING" as const };
