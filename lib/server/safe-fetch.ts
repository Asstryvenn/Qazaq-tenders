/**
 * HTTP-клиент для источников поставщиков (XML-фиды, 1С) с защитой от SSRF.
 *
 * - только https, без логина/пароля в URL, порт 443 или ≥ 1024;
 * - запрет localhost / *.local / *.internal / однословных имён и metadata-хостов;
 * - DNS разрешается заранее, КАЖДЫЙ адрес проверяется (IPv4 и IPv6, включая
 *   IPv4-mapped, 6to4, NAT64), а соединение открывается именно на проверенный адрес —
 *   повторного DNS-запроса нет, поэтому DNS rebinding не срабатывает;
 * - редиректы: с учётными данными запрещены; без них — не больше SYNC_LIMITS.maxRedirects,
 *   каждый адрес проверяется заново, Authorization на другой origin не передаётся;
 * - лимит скачанных и распакованных байт (gzip/deflate/br), общий тайм-аут.
 *
 * Модуль не импортирует "server-only", чтобы его можно было проверить `node --test`;
 * он использует node:https и в браузерный бандл не попадает.
 */
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import { SourceError } from "../supplier-catalog/errors.ts";
import { SYNC_LIMITS } from "../supplier-catalog/limits.ts";
import type { HttpGet, HttpRequest, HttpResponse } from "../supplier-catalog/http.ts";

/* ------------------------------ Проверка адресов ------------------------------ */

const ipv4ToInt = (ip: string) => ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function v4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

/** IPv6 → 16 байт. Поддерживает «::» и хвост в виде IPv4. */
export function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tailV4: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = s.slice(lastColon + 1);
    if (net.isIPv4(v4) === false) return null;
    tailV4 = v4.split(".").map(Number);
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = groups.flatMap((g) => {
    const v = parseInt(g, 16);
    return [v >> 8, v & 0xff];
  });
  if (tailV4.length) bytes.splice(12, 4, ...tailV4);
  return bytes;
}

function prefixEq(bytes: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3;
    const bit = 7 - (i & 7);
    if (((bytes[byte] >> bit) & 1) !== (((prefix[byte] ?? 0) >> bit) & 1)) return false;
  }
  return true;
}

function v6Blocked(ip: string): boolean {
  const b = parseIPv6(ip);
  if (!b) return true;
  const v4 = (o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
  // ::ffff:a.b.c.d (IPv4-mapped) — решает встроенный IPv4.
  if (prefixEq(b, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) return v4Blocked(v4(12));
  // 2002::/16 (6to4) — встроенный IPv4 в байтах 2–5.
  if (prefixEq(b, [0x20, 0x02], 16)) return v4Blocked(v4(2));
  // Разрешён только глобальный unicast 2000::/3 …
  if (!prefixEq(b, [0x20], 3)) return true;
  // … кроме служебных диапазонов внутри него.
  const blocked: [number[], number][] = [
    [[0x20, 0x01, 0x00, 0x00], 23], // IETF: Teredo, ORCHID, бенчмарки
    [[0x20, 0x01, 0x0d, 0xb8], 32], // документация
    [[0x3f, 0xff], 20], // документация (RFC 9637)
  ];
  return blocked.some(([p, bits]) => prefixEq(b, p, bits));
}

/** true — адрес приватный, служебный, loopback, link-local, multicast или зарезервирован. */
export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind === 6) return v6Blocked(ip);
  return true;
}

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)$/i;
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "instance-data", "metadata.azure.com"]);

/** Проверка URL до любых сетевых обращений. */
export function checkSourceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SourceError("blocked_url", "invalid url");
  }
  if (url.protocol !== "https:") throw new SourceError("blocked_url", "https only");
  if (url.username || url.password) throw new SourceError("blocked_url", "credentials in url");
  const port = url.port ? Number(url.port) : 443;
  if (port !== 443 && port < 1024) throw new SourceError("blocked_url", "port");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) throw new SourceError("blocked_url", "host");
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new SourceError("blocked_url", "private address");
    return url;
  }
  if (METADATA_HOSTS.has(host) || BLOCKED_HOSTS.test(host) || !host.includes(".")) throw new SourceError("blocked_url", "internal host");
  return url;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export const systemResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Разрешает имя и требует, чтобы ВСЕ адреса были публичными. Возвращает адрес для подключения. */
export async function resolvePublic(url: URL, resolver: Resolver = systemResolver): Promise<{ address: string; family: number }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return { address: host, family: net.isIP(host) };
  let addresses: { address: string; family: number }[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new SourceError("unavailable", "dns");
  }
  if (!addresses.length) throw new SourceError("unavailable", "dns");
  if (addresses.some((a) => isBlockedAddress(a.address))) throw new SourceError("blocked_url", "resolves to private address");
  return addresses[0];
}

/* ------------------------------ Транспорт ------------------------------ */

export interface TransportRequest {
  url: URL;
  address: { address: string; family: number };
  headers: Record<string, string>;
  maxBytes: number;
  timeoutMs: number;
}
export type Transport = (req: TransportRequest) => Promise<HttpResponse>;

/** https.request с «закреплённым» адресом: TLS и Host — по имени, TCP — на проверенный IP. */
export const httpsTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    const pinned = (_host: string, options: { all?: boolean } | number, cb: (...args: unknown[]) => void) => {
      if (typeof options === "object" && options?.all) cb(null, [{ address: req.address.address, family: req.address.family }]);
      else cb(null, req.address.address, req.address.family);
    };
    const r = https.request(
      {
        protocol: "https:",
        hostname: req.url.hostname.replace(/^\[|\]$/g, ""),
        port: req.url.port || 443,
        path: `${req.url.pathname}${req.url.search}`,
        method: "GET",
        headers: { "User-Agent": "QazaqTendersCatalogSync/1.0", "Accept-Encoding": "gzip, deflate, br", ...req.headers },
        lookup: pinned as never,
        agent: false,
        timeout: req.timeoutMs,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v != null) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers, body: new Uint8Array(), url: req.url.toString() });
        }
        const declared = Number(headers["content-length"]);
        if (Number.isFinite(declared) && declared > req.maxBytes) {
          res.destroy();
          return reject(new SourceError("too_large", "content-length"));
        }
        const enc = (headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          enc === "gzip" || enc === "x-gzip" ? res.pipe(zlib.createGunzip()) :
          enc === "deflate" ? res.pipe(zlib.createInflate()) :
          enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks: Buffer[] = [];
        let raw = 0;
        let size = 0;
        res.on("data", (c: Buffer) => {
          raw += c.length;
          if (raw > req.maxBytes) {
            res.destroy();
            reject(new SourceError("too_large", "download"));
          }
        });
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > req.maxBytes) {
            res.destroy();
            (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
            return reject(new SourceError("too_large", "decompressed"));
          }
          chunks.push(c);
        });
        stream.on("end", () => {
          if (res.complete === false) return reject(new SourceError("incomplete", "connection closed"));
          resolve({ status, headers, body: new Uint8Array(Buffer.concat(chunks)), url: req.url.toString() });
        });
        stream.on("error", () => reject(new SourceError("invalid_format", "decompression")));
        res.on("aborted", () => reject(new SourceError("incomplete", "aborted")));
      }
    );
    const deadline = setTimeout(() => r.destroy(new Error("deadline")), req.timeoutMs);
    r.on("timeout", () => r.destroy(new Error("deadline")));
    r.on("close", () => clearTimeout(deadline));
    r.on("error", (e: NodeJS.ErrnoException) => {
      if (e.message === "deadline") return reject(new SourceError("timeout"));
      if (/CERT|SSL|TLS|self.signed|unable to verify/i.test(`${e.code} ${e.message}`)) return reject(new SourceError("tls", e.code ?? "tls"));
      reject(new SourceError("unavailable", e.code ?? "network"));
    });
    r.end();
  });

export interface SafeFetchDeps {
  resolver?: Resolver;
  transport?: Transport;
}

/** GET с SSRF-защитой. Совместим с HttpGet адаптеров. */
export async function safeFetch(rawUrl: string, request: HttpRequest, deps: SafeFetchDeps = {}): Promise<HttpResponse> {
  const resolver = deps.resolver ?? systemResolver;
  const transport = deps.transport ?? httpsTransport;
  const hasCredentials = Object.keys(request.headers ?? {}).some((h) => h.toLowerCase() === "authorization");
  let url = checkSourceUrl(rawUrl);
  const origin = url.origin;
  let headers = { ...(request.headers ?? {}) };
  for (let hop = 0; ; hop++) {
    const address = await resolvePublic(url, resolver);
    const res = await transport({ url, address, headers, maxBytes: request.maxBytes, timeoutMs: request.timeoutMs ?? SYNC_LIMITS.requestTimeoutMs });
    if (res.status < 300 || res.status >= 400) return res;
    if (hasCredentials) throw new SourceError("redirect_blocked", "redirect with credentials");
    if (hop >= SYNC_LIMITS.maxRedirects) throw new SourceError("redirect_blocked", "too many redirects");
    const location = res.headers["location"];
    if (!location) throw new SourceError("invalid_format", "redirect without location");
    url = checkSourceUrl(new URL(location, url).toString());
    if (url.origin !== origin) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|cookie)$/i.test(k)));
  }
}

export const safeHttpGet: HttpGet = (url, request) => safeFetch(url, request);
