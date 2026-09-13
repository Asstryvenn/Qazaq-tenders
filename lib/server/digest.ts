/**
 * Smart Daily Digest — batch job: new lots of the last 24 h → each user's filters → economic
 * engine with the user's own digital twin (+ ATI.SU live road rates) → TOS → Telegram / email.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./auth";
import { fetchAtiLiveRates } from "./ati";
import { logEvent } from "./events";
import { sendEmail } from "./email";
import { pool, TelegramQueue } from "./telegram-queue";
import { fetchTenders } from "../tenders/source";
import { analyzeTender } from "../engine";
import { cityById, type LiveRoadRate } from "../logistics";
import { DEMO_COMPANY } from "../mock-data";
import { fromRow, type CompanyRow } from "../profile-row";
import { NEUTRAL_SCENARIO, type AnalysisResult, type CompanyProfile, type TenderSpec } from "../types";
import { DEFAULT_FILTERS, lotMatches, publishedWithin, type DigestFilters } from "../digest/match";
import { cardModel, digestHeader, packMessages, renderEmail, renderTelegramCard, type DigestLang } from "../digest/format";

export const MAX_CARDS = 10;

interface FilterRow {
  user_id: string;
  keywords: string[] | null;
  min_budget: number | null;
  max_budget: number | null;
  regions: string[] | null;
  send_telegram: boolean | null;
  send_email: boolean | null;
}

export interface UserDigestResult {
  userId: string;
  matched: number;
  telegram: "sent" | "skipped" | "no-chat" | "blocked" | "error";
  email: "sent" | "skipped" | "not-configured" | "error";
  error?: string;
  cards?: string[];
}

export interface DigestSummary {
  status: "ok" | "db-missing" | "no-db";
  windowHours: number;
  lotsInWindow: number;
  users: UserDigestResult[];
  dryRun: boolean;
}

const cityName = (id: string) => cityById(id)?.ru ?? id;

export const toFilters = (r: Partial<FilterRow> | null | undefined): DigestFilters => ({
  keywords: r?.keywords ?? DEFAULT_FILTERS.keywords,
  minBudget: Number(r?.min_budget ?? DEFAULT_FILTERS.minBudget),
  maxBudget: Number(r?.max_budget ?? DEFAULT_FILTERS.maxBudget),
  regions: r?.regions ?? DEFAULT_FILTERS.regions,
});

/** Live ATI.SU road rates for a route, cached for the whole run. */
function ratesCache() {
  const cache = new Map<string, Promise<LiveRoadRate[]>>();
  return (from: string, to: string): Promise<LiveRoadRate[]> => {
    if (from === to || !process.env.ATI_SU_API_KEY) return Promise.resolve([]);
    const key = `${from}:${to}`;
    if (!cache.has(key))
      cache.set(
        key,
        Promise.all([fetchAtiLiveRates(from, to, "truck"), fetchAtiLiveRates(from, to, "gazelle")]).then((rs) =>
          rs.flatMap((r) => (r.status === "live" ? [r.rate] : []))
        )
      );
    return cache.get(key)!;
  };
}

/** Matched lots for one user, analysed with the user's twin and sorted by TOS. */
export async function analyzeForUser(lots: TenderSpec[], filters: DigestFilters, company: CompanyProfile, rates = ratesCache()) {
  const matched = lots.filter((l) => lotMatches(l, filters)).slice(0, 40);
  const analysed: { spec: TenderSpec; result: AnalysisResult }[] = [];
  for (const spec of matched) {
    const liveRoadRates = await rates(company.baseCityId, spec.cityId);
    analysed.push({ spec, result: analyzeTender(spec, company, { ...NEUTRAL_SCENARIO, liveRoadRates }) });
  }
  return { matched: matched.length, top: analysed.sort((a, b) => b.result.tos - a.result.tos).slice(0, MAX_CARDS) };
}

export function renderCards(top: { spec: TenderSpec; result: AnalysisResult }[], company: CompanyProfile, siteUrl: string, lang: DigestLang) {
  const models = top.map(({ spec, result }) => cardModel({ spec, result, baseCityId: company.baseCityId, cityName, siteUrl, lang }));
  return { models, telegram: models.map((m) => renderTelegramCard(m, lang)) };
}

export async function newLots(windowHours: number): Promise<TenderSpec[]> {
  const feed = await fetchTenders();
  return feed.tenders.filter((t) => publishedWithin(t, windowHours));
}

export async function runDailyDigest(opts: { siteUrl: string; windowHours?: number; dryRun?: boolean; onlyUserId?: string; lang?: DigestLang }): Promise<DigestSummary> {
  const windowHours = opts.windowHours ?? 24;
  const dryRun = !!opts.dryRun;
  const lang = opts.lang ?? "ru";
  const admin = adminClient();
  if (!admin) return { status: "no-db", windowHours, lotsInWindow: 0, users: [], dryRun };

  let q = admin.from("digest_filters").select("user_id, keywords, min_budget, max_budget, regions, send_telegram, send_email").eq("enabled", true);
  if (opts.onlyUserId) q = q.eq("user_id", opts.onlyUserId);
  const { data: filterRows, error } = await q;
  if (error) return { status: "db-missing", windowHours, lotsInWindow: 0, users: [], dryRun };

  const lots = await newLots(windowHours);
  const rows = (filterRows ?? []) as FilterRow[];
  if (!rows.length) return { status: "ok", windowHours, lotsInWindow: lots.length, users: [], dryRun };

  const ids = rows.map((r) => r.user_id);
  const [companies, settings, emails] = await Promise.all([
    admin.from("companies").select("*").in("user_id", ids),
    admin.from("notification_settings").select("user_id, telegram_enabled, telegram_chat_id").in("user_id", ids),
    userEmails(admin, ids),
  ]);
  const companyBy = new Map(((companies.data ?? []) as (CompanyRow & { user_id: string })[]).map((c) => [c.user_id, fromRow(c)]));
  const chatBy = new Map(((settings.data ?? []) as { user_id: string; telegram_enabled: boolean; telegram_chat_id: string | null }[]).map((s) => [s.user_id, s]));
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const queue = token ? new TelegramQueue(token) : null;
  const rates = ratesCache();

  const users = await pool(rows, 8, async (row): Promise<UserDigestResult> => {
    const company = companyBy.get(row.user_id) ?? DEMO_COMPANY;
    const { matched, top } = await analyzeForUser(lots, toFilters(row), company, rates);
    const { models, telegram } = renderCards(top, company, opts.siteUrl, lang);
    const res: UserDigestResult = { userId: row.user_id, matched, telegram: "skipped", email: "skipped" };
    if (dryRun) return { ...res, cards: telegram };
    if (!top.length) return res;

    const chat = chatBy.get(row.user_id);
    if (row.send_telegram !== false) {
      if (!queue || !chat?.telegram_enabled || !chat.telegram_chat_id) res.telegram = "no-chat";
      else {
        for (const msg of packMessages([digestHeader(top.length, lang), ...telegram])) {
          const r = await queue.send(chat.telegram_chat_id, msg);
          if (!r.ok) {
            res.telegram = r.blocked ? "blocked" : "error";
            res.error = r.error;
            break;
          }
          res.telegram = "sent";
        }
      }
    }
    const email = emails.get(row.user_id);
    if (row.send_email && email) {
      const { subject, html } = renderEmail(models, lang);
      const r = await sendEmail(email, subject, html);
      res.email = r.ok ? "sent" : "skipped" in r && r.skipped ? "not-configured" : "error";
    }
    if (res.telegram === "sent" || res.email === "sent") {
      await admin.from("digest_filters").update({ last_sent_at: new Date().toISOString() }).eq("user_id", row.user_id);
      await logEvent("digest_sent", { userId: row.user_id, meta: { lots: top.length, telegram: res.telegram, email: res.email } });
    }
    return res;
  });

  return { status: "ok", windowHours, lotsInWindow: lots.length, users, dryRun };
}

async function userEmails(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data.user?.email && data.user.email_confirmed_at) out.set(id, data.user.email);
    })
  );
  return out;
}
