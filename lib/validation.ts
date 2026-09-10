/** Input validation shared by the registration wizard, onboarding and the register API. */

/**
 * БИН / ИИН check digit (Kazakhstan): weights 1..11 mod 11; if the result is 10,
 * repeat with weights 3..11,1,2; if still 10 the number is invalid.
 */
export function isValidBin(value: string): boolean {
  const d = value.trim();
  if (!/^\d{12}$/.test(d)) return false;
  const digits = d.split("").map(Number);
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  let c = w1.reduce((s, w, i) => s + w * digits[i], 0) % 11;
  if (c === 10) {
    c = w2.reduce((s, w, i) => s + w * digits[i], 0) % 11;
    if (c === 10) return false;
  }
  return c === digits[11];
}

export type BinState = "empty" | "partial" | "invalid" | "valid";

export function binState(value: string): BinState {
  const d = value.trim();
  if (!d) return "empty";
  if (d.length < 12) return "partial";
  return isValidBin(d) ? "valid" : "invalid";
}

/** Normalises KZ mobile numbers to +7XXXXXXXXXX; null if it can't be one. */
export function normalizePhone(value: string): string | null {
  let d = value.replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "8" || d[0] === "7")) d = d.slice(1);
  if (d.length !== 10 || d[0] !== "7") return null;
  return `+7${d}`;
}

/** Pretty +7 (7XX) XXX-XX-XX for display while typing. */
export function formatPhone(value: string): string {
  let d = value.replace(/\D/g, "");
  if (d[0] === "8" || d[0] === "7") d = d.slice(1);
  d = d.slice(0, 10);
  const p = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)];
  let out = "+7";
  if (p[0]) out += ` (${p[0]}${p[0].length === 3 ? ")" : ""}`;
  if (p[1]) out += ` ${p[1]}`;
  if (p[2]) out += `-${p[2]}`;
  if (p[3]) out += `-${p[3]}`;
  return out;
}

export const isValidTelegram = (v: string) => /^@?[A-Za-z0-9_]{5,32}$/.test(v.trim());
export const normalizeTelegram = (v: string) => (v.trim() ? `@${v.trim().replace(/^@/, "")}` : "");

export const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
