/**
 * POST /api/analyze — PDF specification analysis.
 *
 * Two-layer rule preserved:
 *   1. LLM extracts facts from the page-tagged text into a strict JSON schema (no maths).
 *   2. The deterministic engine computes TOS, profit, cash gap — the client re-runs it live.
 *   3. A second, short LLM call writes the executive summary from the engine's numbers only.
 *
 * The browser extracts the text (pdf.js), so 50 MB PDFs never hit the serverless body limit.
 * Signed-in users only; one analysis counts as one AI query.
 */
import { NextResponse } from "next/server";
import { analyzeTender } from "@/lib/engine";
import { CITIES } from "@/lib/logistics";
import { modelFor } from "@/lib/server/models";
import { getOpenAIKey, httpStatusFor, keyMissingBody, OpenAIError, openaiJson } from "@/lib/server/openai";
import { getRequestUser } from "@/lib/server/auth";
import { checkQuota, consume, resolvePlan, usageOf, type Subject } from "@/lib/server/billing";
import type { CompanyProfile, TenderSpec } from "@/lib/types";
import type { AnalyzeResponse, ExtractedFacts, ExtractedRequirement, ExtractedRisk } from "@/lib/upload-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ~50–70k tokens of Cyrillic text — leaves room for the answer and keeps latency sane. */
const MAX_CHARS = 150_000;
const DEFAULT_COST_SHARE = 0.78;
const CATEGORY_DEFAULTS: Record<string, { costShare: number }> = {
  electronics: { costShare: 0.8 }, furniture: { costShare: 0.72 }, construction: { costShare: 0.78 },
  medical: { costShare: 0.76 }, office: { costShare: 0.7 }, services: { costShare: 0.55 }, other: { costShare: DEFAULT_COST_SHARE },
};

const n = { type: ["number", "null"] };
const i = { type: ["integer", "null"] };
const s = { type: ["string", "null"] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "customer", "city", "budgetKzt", "deliveryDays", "paymentDelayDays", "advancePct", "penaltyRatePctPerDay",
    "penaltyCapPct", "bidSecurityPct", "performanceSecurityPct", "bidDeadline", "cargoTonnes", "requiredExperienceYears",
    "requiredCertificates", "requirements", "risks", "factPages",
    "category", "items", "smartDefaults",
  ],
  properties: {
    title: s,
    customer: s,
    city: s,
    budgetKzt: n,
    deliveryDays: i,
    paymentDelayDays: i,
    advancePct: n,
    penaltyRatePctPerDay: n,
    penaltyCapPct: n,
    bidSecurityPct: n,
    performanceSecurityPct: n,
    bidDeadline: s,
    cargoTonnes: n,
    category: { type: "string", enum: Object.keys(CATEGORY_DEFAULTS) },
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "quantity", "unit", "estimatedUnitWeightKg"],
        properties: { name: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" }, estimatedUnitWeightKg: n },
      },
    },
    smartDefaults: {
      type: "object", additionalProperties: false, required: ["purchaseCostKzt", "cargoTonnes"],
      properties: {
        purchaseCostKzt: {
          type: "object", additionalProperties: false, required: ["value", "isSmartDefault", "confidence", "evidence"],
          properties: { value: { type: "number" }, isSmartDefault: { type: "boolean" }, confidence: { type: "number" }, evidence: { type: "string" } },
        },
        cargoTonnes: {
          type: "object", additionalProperties: false, required: ["value", "isSmartDefault", "confidence", "evidence"],
          properties: { value: { type: "number" }, isSmartDefault: { type: "boolean" }, confidence: { type: "number" }, evidence: { type: "string" } },
        },
      },
    },
    requiredExperienceYears: i,
    requiredCertificates: { type: "array", items: { type: "string" } },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "page", "kind", "proof", "isBase"],
        properties: {
          text: { type: "string" },
          page: i,
          kind: { type: "string", enum: ["certificate", "license", "experience", "staff", "equipment", "technical", "sample", "warranty", "delivery", "financial", "other"] },
          proof: { type: "string" },
          isBase: { type: "boolean" },
        },
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "clause", "page", "severity", "why"],
        properties: {
          title: { type: "string" },
          clause: { type: "string" },
          page: i,
          severity: { type: "string", enum: ["low", "medium", "high"] },
          why: { type: "string" },
        },
      },
    },
    factPages: {
      type: "object",
      additionalProperties: false,
      required: ["budget", "delivery", "payment", "penalty", "guarantee"],
      properties: { budget: i, delivery: i, payment: i, penalty: i, guarantee: i },
    },
  },
};

const KEYWORDS = /сумм|бюджет|стоимост|срок|мерзім|оплат|төлем|неустойк|пен[яи]|штраф|өсімпұл|гарант|обеспечен|кепіл|требован|талап|сертификат|лиценз|опыт|тәжірибе|аванс|приёмк|приемк|поставк|жеткіз|персонал|специалист|біліктілік|оборудован|жабдық|склад|қойма|транспорт|көлік|образ[ео]ц|үлгі|испытан|сынақ|авторизац|сервис/i;

/** Page-tagged document text within the budget: key pages in full, the rest shortened. */
function buildDocument(pages: { page: number; text: string }[]) {
  const total = pages.reduce((a, p) => a + p.text.length, 0);
  if (total <= MAX_CHARS) return { text: pages.map((p) => `=== стр. ${p.page} ===\n${p.text}`).join("\n\n"), truncated: [] as number[] };

  const priority = new Set<number>(pages.slice(0, 3).map((p) => p.page));
  pages.forEach((p) => KEYWORDS.test(p.text) && priority.add(p.page));
  let budget = MAX_CHARS;
  const full = new Set<number>();
  for (const p of pages) if (priority.has(p.page) && p.text.length <= budget) (full.add(p.page), (budget -= p.text.length));
  const truncated: number[] = [];
  const parts = pages.map((p) => {
    if (full.has(p.page)) return `=== стр. ${p.page} ===\n${p.text}`;
    truncated.push(p.page);
    const lines = p.text.split("\n").filter((l) => KEYWORDS.test(l)).join("\n").slice(0, 600);
    return `=== стр. ${p.page} (сокращено) ===\n${lines || p.text.slice(0, 300)}`;
  });
  return { text: parts.join("\n\n"), truncated };
}


function matchCity(name: string | null): string | null {
  if (!name) return null;
  const q = name.toLowerCase();
  return CITIES.find((c) => q.includes(c.ru.toLowerCase()) || q.includes(c.kz.toLowerCase()) || q.includes(c.id))?.id ?? null;
}

const pct = (v: number | null) => (v == null || !Number.isFinite(v) || v < 0 ? null : v);

export async function POST(req: Request) {
  const apiKey = getOpenAIKey();
  if (!apiKey) return NextResponse.json(keyMissingBody, { status: 500 });

  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = (await req.json()) as { fileName: string; pages: { page: number; text: string }[]; company: CompanyProfile; lang: "kz" | "ru" };
  const pages = (body.pages ?? []).filter((p) => Number.isInteger(p.page) && typeof p.text === "string");
  const chars = pages.reduce((a, p) => a + p.text.length, 0);
  if (!pages.length || chars < 200) return NextResponse.json({ error: "no-text" }, { status: 422 });

  const subject: Subject = { kind: "user", user };
  const { plan } = await resolvePlan(subject);
  const quota = checkQuota(plan, await usageOf(subject));
  if (!quota.ok) return NextResponse.json({ error: "quota", plan, period: quota.period, limit: quota.limit }, { status: 429 });
  await consume(subject);

  const lang = body.lang === "ru" ? "ru" : "kz";
  const language = lang === "kz" ? "Kazakh (Cyrillic)" : "Russian";
  const model = modelFor(plan, false);
  const doc = buildDocument(pages);

  // ---- Layer 1: extraction only
  let x: ExtractedFacts & { requirements: ExtractedRequirement[]; risks: ExtractedRisk[] };
  try {
    x = await openaiJson(apiKey, {
      model,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "tender_extraction", strict: true, schema: SCHEMA } },
      messages: [
        {
          role: "system",
          content: `You extract facts from a Kazakhstani public-procurement technical specification. Pages are marked "=== стр. N ===".
RULES
- For fact fields, extract ONLY what the document states and use null when absent. Estimates are allowed only in items.estimatedUnitWeightKg and smartDefaults, under the explicit rules below.
- budgetKzt: total lot/contract amount in tenge (number, no spaces). penaltyRatePctPerDay: e.g. "0,1% за каждый день" → 0.1. Percent fields are plain percents (1% → 1).
- deliveryDays / paymentDelayDays: calendar days as stated ("в течение 30 дней после приёмки" → 30).
- bidDeadline: ISO date YYYY-MM-DD if a submission deadline is stated.
- page fields: the page number where the fact appears, from the markers.
- category: electronics, furniture, construction, medical, office, services or other.
- items: up to 20 principal nomenclature lines with quantity/unit. estimatedUnitWeightKg may be a conservative category estimate; never invent quantity.
- smartDefaults.purchaseCostKzt: when there is no supplier quote, budget × category share: electronics .80, furniture .72, construction .78, medical .76, office .70, services .55, other .78. Mark isSmartDefault=true, confidence .70-.80 and explain evidence.
- smartDefaults.cargoTonnes: use document weight with isSmartDefault=false/.98; otherwise sum quantity × estimatedUnitWeightKg or make a conservative category estimate, mark true and explain it.
- risks: clauses that are dangerous for a small supplier — harsh or uncapped penalties, long payment deferral, no advance with large purchases, unrealistic deadlines, brand/article lock-in, regional or excessive experience demands, own-equipment demands, extra guarantees, one-sided termination. clause = short verbatim quote (≤ 200 chars). title and why in ${language}. Up to 8, most severe first.
- requirements: extract EVERY requirement imposed on the potential supplier in this exact specification: certificates/licences,
  analogous experience, named specialists and qualifications, owned or leased equipment/warehouse/transport, product parameters,
  samples/test reports, manufacturer authorisation, warranty/service centre, delivery schedule, financial security and other attachments.
  Preserve concrete thresholds, quantities, standards, brands and deadlines. text is a concise faithful requirement in ${language};
  page is the source page; proof says what document/evidence the bidder should attach. Set isBase=true only for universal portal
  boilerplate (application form, tax-debt statement, legal-entity registration, standard bid security). Lot-specific requirements,
  even if common in the industry, must be isBase=false. Do not invent requirements absent from the document.`,
        },
        { role: "user", content: doc.text },
      ],
    }, "extract");
  } catch (e) {
    if (e instanceof OpenAIError) return NextResponse.json({ success: false, error: e.code, detail: e.message }, { status: httpStatusFor(e.code) });
    console.error("[analyze] extraction failed:", (e as Error).message);
    return NextResponse.json({ success: false, error: "EXTRACT_FAILED", detail: (e as Error).message }, { status: 502 });
  }

  // ---- Engine input, with explicit assumptions where the document is silent
  const budget = pct(x.budgetKzt) ?? 0;
  const cityId = matchCity(x.city);
  const deadlineFallback = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const deadline = x.bidDeadline && /^\d{4}-\d{2}-\d{2}$/.test(x.bidDeadline) ? x.bidDeadline : deadlineFallback;
  const id = `upload-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const risks = (x.risks ?? []).slice(0, 8);
  const raw = x as typeof x & {
    category?: string;
    items?: Array<{ name: string; quantity: number; unit: string; estimatedUnitWeightKg: number | null }>;
    smartDefaults?: { purchaseCostKzt?: { value: number; confidence: number; evidence: string }; cargoTonnes?: { value: number; confidence: number; evidence: string } };
  };
  const category = raw.category && CATEGORY_DEFAULTS[raw.category] ? raw.category : "other";
  const smartPurchase = raw.smartDefaults?.purchaseCostKzt;
  const smartCargo = raw.smartDefaults?.cargoTonnes;
  const purchaseCandidate = Number(smartPurchase?.value);
  const purchaseCost = Number.isFinite(purchaseCandidate) && purchaseCandidate >= budget * 0.3 && purchaseCandidate <= budget * 0.98
    ? purchaseCandidate
    : budget * CATEGORY_DEFAULTS[category].costShare;
  const cargoCandidate = Number(smartCargo?.value);
  const cargoTonnes = pct(x.cargoTonnes) ?? (Number.isFinite(cargoCandidate) && cargoCandidate > 0 ? cargoCandidate : Math.max(1, Math.round(budget / 5_000_000)));
  const provenance = (found: boolean, confidence: number | undefined, evidence: string, source: "category_default" | "fallback" = "fallback") => ({
    source: found ? "document" as const : source,
    isSmartDefault: !found,
    confidence: found ? 0.98 : Math.min(0.8, Math.max(0.5, Number(confidence) || 0.65)),
    evidence: found ? "Извлечено из ТЗ" : evidence,
  });

  const spec: Omit<TenderSpec, "specPages"> = {
    id,
    externalId: body.fileName.replace(/\.pdf$/i, "").slice(0, 60),
    source: "upload",
    sourceUrl: "",
    isDemo: false,
    estimated: true,
    title: x.title || body.fileName,
    titleKz: x.title || body.fileName,
    customer: x.customer || "—",
    contractAmount: budget,
    advancePercentage: pct(x.advancePct) ?? 0,
    deliveryDays: x.deliveryDays && x.deliveryDays > 0 ? x.deliveryDays : 30,
    paymentDelayDays: x.paymentDelayDays != null && x.paymentDelayDays >= 0 ? x.paymentDelayDays : 30,
    penaltyRate: (pct(x.penaltyRatePctPerDay) ?? 0.1) / 100,
    purchaseCost,
    cityId: cityId ?? body.company.baseCityId,
    cargoTonnes,
    requiredExperienceYears: x.requiredExperienceYears ?? 0,
    requiredCertificates: x.requiredCertificates ?? [],
    hiddenRequirements: risks
      .filter((r) => r.severity !== "low" && r.page != null)
      .map((r) => ({ clause: r.clause, page: r.page as number, severity: r.severity, reason: r.why })),
    qualificationRequirements: (x.requirements ?? []).filter((requirement) => !requirement.isBase),
    deadline,
    ...(pct(x.bidSecurityPct) != null && { bidSecurityRate: (x.bidSecurityPct as number) / 100 }),
    ...(pct(x.performanceSecurityPct) != null && { performanceSecurityRate: (x.performanceSecurityPct as number) / 100 }),
    category,
    items: (raw.items ?? []).slice(0, 20).filter((item) => item.name && item.quantity > 0),
    fieldSources: {
      purchase_cost: provenance(false, smartPurchase?.confidence, smartPurchase?.evidence || `Категория ${category}`, "category_default"),
      cargo_tonnes: provenance(x.cargoTonnes != null, smartCargo?.confidence, smartCargo?.evidence || `Оценка веса категории ${category}`, "category_default"),
      delivery_days: provenance(Boolean(x.deliveryDays && x.deliveryDays > 0), undefined, "Fallback 30 дней"),
      payment_delay_days: provenance(x.paymentDelayDays != null, undefined, "Fallback 30 дней"),
      advance_percentage: provenance(x.advancePct != null, undefined, "Fallback: аванса нет"),
      city_id: provenance(Boolean(cityId), undefined, "Fallback: город компании"),
    },
  };

  const assumed = {
    budget: !budget,
    purchaseCost: true,
    deliveryDays: !(x.deliveryDays && x.deliveryDays > 0),
    paymentDelayDays: x.paymentDelayDays == null,
    city: !cityId,
    cargo: pct(x.cargoTonnes) == null,
    deadline: deadline === deadlineFallback,
  };

  // ---- Executive summary, written from the engine's numbers only
  let summary: string[] = [];
  let recommendation: AnalyzeResponse["recommendation"] = null;
  if (budget > 0) {
    const r = analyzeTender({ ...spec, specPages: [] }, body.company);
    try {
      const out = await openaiJson(apiKey, {
        model,
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "summary",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["bullets", "recommendation"],
              properties: {
                bullets: { type: "array", items: { type: "string" } },
                recommendation: { type: "string", enum: ["participate", "caution", "avoid"] },
              },
            },
          },
        },
        messages: [
          {
            role: "system",
            content: `Write an executive summary in ${language} for an SME owner: 4–6 short bullets, plain words, no jargon. Use ONLY the numbers given — never compute new ones. Write amounts the Kazakh way: "46,5 млн ₸", "840 мың ₸" (ru: "840 тыс ₸"), never raw digits or "KZT". Say clearly whether to participate, be careful or avoid, and why. Mention the most dangerous clauses with their page ("бет N" / "стр. N"). Note that prime cost is an assumption (${Math.round(DEFAULT_COST_SHARE * 100)}% of budget) the user can edit.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              engine: {
                tos: r.tos,
                verdict: r.verdict,
                netProfitKzt: Math.round(r.netProfit),
                marginPct: +r.marginPct.toFixed(1),
                cashGapStartsOnDay: r.gapDay,
                deepestDeficitKzt: Math.round(r.maxDeficit),
                payDay: r.payDay,
                bankGuaranteeFeeKzt: Math.round(r.costs.guarantee),
                taxesKzt: Math.round(r.costs.tax),
              },
              facts: { budgetKzt: budget, deliveryDays: spec.deliveryDays, paymentDelayDays: spec.paymentDelayDays, penaltyPctPerDay: spec.penaltyRate * 100 },
              risks: risks.map((k) => ({ title: k.title, page: k.page, severity: k.severity })),
              assumptions: assumed,
            }),
          },
        ],
      }, "summary");
      summary = Array.isArray(out.bullets) ? out.bullets.slice(0, 6) : [];
      recommendation = out.recommendation ?? null;
    } catch (e) {
      // The dashboard falls back to the deterministic plain-language summary.
      console.warn("[analyze] summary skipped:", (e as Error).message);
    }
  }

  const facts: ExtractedFacts = {
    title: x.title,
    customer: x.customer,
    city: x.city,
    budgetKzt: x.budgetKzt,
    deliveryDays: x.deliveryDays,
    paymentDelayDays: x.paymentDelayDays,
    advancePct: x.advancePct,
    penaltyRatePctPerDay: x.penaltyRatePctPerDay,
    penaltyCapPct: x.penaltyCapPct,
    bidSecurityPct: x.bidSecurityPct,
    performanceSecurityPct: x.performanceSecurityPct,
    bidDeadline: x.bidDeadline,
    cargoTonnes: x.cargoTonnes,
    requiredExperienceYears: x.requiredExperienceYears,
    requiredCertificates: x.requiredCertificates ?? [],
    factPages: x.factPages,
  };

  const response: AnalyzeResponse = {
    id,
    spec,
    costShare: DEFAULT_COST_SHARE,
    facts,
    assumed,
    risks,
    requirements: x.requirements ?? [],
    summary,
    recommendation,
    summaryLang: lang,
    truncatedPages: doc.truncated,
  };
  return NextResponse.json({ success: true, ...response });
}
