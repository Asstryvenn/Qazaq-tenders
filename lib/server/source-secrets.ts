/**
 * Шифрование учётных данных источников (URL фида с токеном, логин/пароль 1С, токен REST).
 * AES-256-GCM, ключ — SUPPLIER_SOURCES_ENC_KEY (32 байта в base64 или hex, только сервер,
 * без префикса NEXT_PUBLIC_). ID источника — дополнительные данные (AAD): шифротекст
 * нельзя переставить в чужой источник. Без ключа автоматические источники не создаются.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SourceError } from "../supplier-catalog/errors.ts";

export interface SourceSecret {
  url: string;
  auth: { type: "none" } | { type: "basic"; username: string; password: string } | { type: "bearer"; token: string };
}

export function encryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.SUPPLIER_SOURCES_ENC_KEY?.trim();
  if (!raw) throw new SourceError("secrets_key_missing");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new SourceError("secrets_key_missing", "key must be 32 bytes");
  return key;
}

export function encryptSecret(secret: SourceSecret, sourceId: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(sourceId, "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

export function decryptSecret(payload: string, sourceId: string, key: Buffer = encryptionKey()): SourceSecret {
  if (!payload.startsWith("v1:")) throw new SourceError("config", "secret version");
  const buf = Buffer.from(payload.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(sourceId, "utf8"));
  decipher.setAuthTag(buf.subarray(12, 28));
  try {
    return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8")) as SourceSecret;
  } catch {
    throw new SourceError("config", "secret cannot be decrypted");
  }
}

export function authHeaders(auth: SourceSecret["auth"]): Record<string, string> {
  if (auth.type === "basic") return { Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64")}` };
  if (auth.type === "bearer") return { Authorization: `Bearer ${auth.token}` };
  return {};
}

/** URL для показа владельцу: без параметров запроса (там часто токен) и без userinfo. */
export function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`.slice(0, 300) + (u.search ? "?…" : "");
  } catch {
    return "";
  }
}

/** Учётные данные из запроса. Пароль администратора, ЭЦП и банковские данные не запрашиваются вовсе. */
export function parseCredentials(input: unknown): SourceSecret["auth"] {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  if (a.type === "basic") {
    const username = str(a.username, 200).trim();
    const password = str(a.password, 500);
    if (!username || !password || /[:\r\n]/.test(username)) throw new SourceError("config", "basic credentials");
    return { type: "basic", username, password };
  }
  if (a.type === "bearer") {
    const token = str(a.token, 4000).trim();
    if (!token || /\s/.test(token)) throw new SourceError("config", "token");
    return { type: "bearer", token };
  }
  return { type: "none" };
}
