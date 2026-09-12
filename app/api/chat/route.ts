/**
 * AI Consultant — streams NDJSON events (see lib/chat-types.ts).
 *
 * OpenAI handles language; every number comes from the deterministic engine through
 * `run_scenario`, every quote from `get_spec_pages`. The LLM never does the math itself.
 * The plan, the AI quota and the model are decided HERE from the caller's verified
 * session (see lib/server/billing.ts) — the request body cannot raise them.
 * Signed-in users only. FREE: 5 queries/day, spec Q&A. PRO: 300/month, gpt-4o, What-If tool.
 * MAX: 6000/month, + .docx letter tool, optional o3-mini deep reasoning.
 */
import { analyzeTender } from "@/lib/engine";
import { fetchTender } from "@/lib/tenders/source";
import { NEUTRAL_SCENARIO, Scenario, type TenderSpec } from "@/lib/types";
import type { ChatEvent, ChatRequest } from "@/lib/chat-types";
import { can, FEATURE_MIN_PLAN, PLAN_RANK, type PlanId } from "@/lib/plans";
import { modelFor } from "@/lib/server/models";
import { codeForStatus, getOpenAIKey, keyMissingBody, redactKeys } from "@/lib/server/openai";
import { getRequestUser } from "@/lib/server/auth";
import { checkQuota, consume, resolvePlan, usageOf, type Subject } from "@/lib/server/billing";

export const dynamic = "force-dynamic";
// Streaming answers with several engine/tool rounds can outlive the default
// serverless timeout on Vercel; 60 s is the Hobby-plan maximum.
export const maxDuration = 60;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_TOOL_ROUNDS = 4;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_scenario",
      description:
        "Recalculate the tender with the deterministic economic engine under a what-if scenario. Use for ANY question about profit, margin, TOS, cash gap, costs or terms. All levers are deltas; omit a lever to keep it at 0.",
      parameters: {
        type: "object",
        properties: {
          fuelDeltaPct: { type: "number", description: "Fuel price change, %. Moves only the fuel share (40%) of freight." },
          transportDeltaPct: { type: "number", description: "Whole transport tariff change, %. 'Transport costs −10%' → -10." },
          supplierDeltaPct: { type: "number", description: "Supplier price change, %." },
          paymentDelayDelta: { type: "number", description: "Extra days the customer pays late." },
          lateDays: { type: "number", description: "Days of late delivery WITHOUT agreement (statutory penalty applies)." },
          deliveryDeltaDays: { type: "number", description: "Delivery term extended BY AGREEMENT, days (no penalty). 'Extend delivery by 15 days' → 15." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_spec_pages",
      description:
        "Return the full text of specific specification pages. Call before quoting or judging any clause. With no pages on a long document it returns a page index with previews instead.",
      parameters: {
        type: "object",
        properties: { pages: { type: "array", items: { type: "integer" }, description: "Page numbers; empty = all pages." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_spec",
      description: "Search the whole specification for a topic or words (e.g. 'неустойка', 'гарантия', 'опыт') and get the matching pages with snippets. Use it when the page is unknown.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_letter",
      description: "Generate the warranty letter (.docx) for this lot from the company profile. The file is produced in the user's browser.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

const NEED: Record<string, PlanId> = {
  run_scenario: FEATURE_MIN_PLAN.scenario,
  generate_letter: FEATURE_MIN_PLAN.letter,
  get_spec_pages: "free",
  search_spec: "free",
};

/** "1–12, 14, 20–31" — compact list of available pages for the prompt. */
function pageRanges(pages: number[]): string {
  const s = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `${s[i]}` : `${s[i]}–${s[j]}`);
    i = j;
  }
  return out.join(", ");
}

const PAGE_CAP = 6_000;

/** Requested pages in full (capped per page); a whole long document → an index, not a token flood. */
function specPages(tender: TenderSpec, wanted: number[]) {
  const all = tender.specPages;
  const missing = wanted.filter((n) => !all.some((p) => p.page === n));
  if (!wanted.length && all.reduce((a, p) => a + p.text.length, 0) > 20_000)
    return { index: all.map((p) => ({ page: p.page, preview: p.text.slice(0, 160) })), note: "Long document: request specific pages or use search_spec.", missingPages: [] };
  const pages = (wanted.length ? all.filter((p) => wanted.includes(p.page)) : all).map((p) => ({ page: p.page, text: p.text.slice(0, PAGE_CAP) }));
  return { pages, missingPages: missing, hiddenRequirementsFlagged: tender.hiddenRequirements };
}

/** Keyword search across every page, best pages first, with a snippet around the first hit. */
function searchSpec(tender: TenderSpec, query: string) {
  const words = query.toLowerCase().split(/[\s,.;:!?«»"']+/).filter((w) => w.length > 2);
  if (!words.length) return { results: [] };
  const results = tender.specPages
    .map((p) => {
      const low = p.text.toLowerCase();
      const score = words.reduce((a, w) => a + (low.split(w).length - 1), 0);
      const at = Math.max(0, Math.min(...words.map((w) => { const k = low.indexOf(w); return k < 0 ? Infinity : k; })));
      return { page: p.page, score, snippet: Number.isFinite(at) ? p.text.slice(Math.max(0, at - 200), at + 300) : "" };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return { results };
}

function summarize(r: ReturnType<typeof analyzeTender>) {
  return {
    tos: r.tos,
    verdict: r.verdict,
    netProfitKzt: Math.round(r.netProfit),
    marginPct: +r.marginPct.toFixed(2),
    cashFlowGap: r.cashFlowGap,
    // Explicit names: the model read a bare "gapDay: 18" as "an 18-day gap".
    cashGapStartsOnDay: r.gapDay,
    daysInDeficit: r.timeline.filter((p) => p.balance < 0).length,
    deepestDeficitKzt: Math.round(r.maxDeficit),
    deliveryDay: r.deliveryDay,
    payDay: r.payDay,
    distanceKm: r.distanceKm,
    trucks: r.trucks,
    costsKzt: Object.fromEntries(Object.entries(r.costs).map(([k, v]) => [k, Math.round(v)])),
    reasons: r.reasons,
  };
}

const isNeutral = (s: Scenario) => (Object.keys(NEUTRAL_SCENARIO) as (keyof Scenario)[]).every((k) => !s[k]);

export async function POST(req: Request) {
  const apiKey = getOpenAIKey();
  if (!apiKey) return Response.json(keyMissingBody, { status: 500 });

  const body = (await req.json()) as ChatRequest;
  const tender =
    body.tenderId.startsWith("upload-") && body.upload?.id === body.tenderId ? body.upload : await fetchTender(body.tenderId);
  if (!tender) return Response.json({ error: "tender-not-found" }, { status: 404 });

  // Plan and quota come from the verified session, never the body. AI needs an account:
  // per-IP limits for guests are trivially bypassed by spoofing X-Forwarded-For.
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "auth" }, { status: 401 });
  const subject: Subject = { kind: "user", user };
  const { plan: tier } = await resolvePlan(subject);
  const quota = checkQuota(tier, await usageOf(subject));
  if (!quota.ok) return Response.json({ error: "quota", plan: tier, period: quota.period, limit: quota.limit }, { status: 429 });
  await consume(subject);

  const company = body.company;
  const baseline = analyzeTender(tender, company);
  const language = body.lang === "kz" ? "Kazakh (қазақ тілі, Cyrillic)" : "Russian";
  const deep = !!body.deep && can(tier, "deepReasoning");
  const model = modelFor(tier, deep);

  const system = `You are "QazaqTenders AI", an economic advisor for a Kazakhstani SME deciding whether to bid on a public tender.
Answer ONLY in ${language}. Be concise: short paragraphs or a tight "- " list. End with one actionable recommendation. You may use **bold**.

HARD RULES
- Never calculate money, margins, TOS or dates yourself. Call run_scenario and cite its numbers.
- Before quoting or assessing any clause, call get_spec_pages. Always cite the page ("бет 12" / "стр. 12").
- If a requested page does not exist, say so plainly — do not invent content.
- Amounts like "14,1 млн ₸". For what-if answers state the change from deltaVsBaseline; under 1 млн ₸ give it in мың ₸.
- cashGapStartsOnDay is the DAY the balance first goes negative; daysInDeficit is how long it stays negative.
- If a tool answers {"locked": true}, say in one sentence which plan unlocks it (availableOn: PRO or MAX), then help as far as you can without it.
- Kazakh procurement norms: bid security 1%, performance security 3%, penalty 0.1%/day capped at 10%.
${
  tier === "max"
    ? "MAX ENTERPRISE MODE: also act as a procurement compliance reviewer. Check the spec for clauses that restrict competition or discriminate between suppliers (brand/article lock-in, regional experience, unrealistic terms), say how to challenge them during the clarification period, and give a bidding strategy (price floor from the engine's costs, guarantees, questions to send to the customer)."
    : ""
}

PLAN: ${tier}. TENDER: ${tender.title} — ${tender.customer}. Contract ${tender.contractAmount} KZT, delivery ${tender.deliveryDays} days, payment ${tender.paymentDelayDays} days after delivery, advance ${tender.advancePercentage}%.
Spec pages available: ${pageRanges(tender.specPages.map((p) => p.page)) || "none"} (${tender.specPages.length} pages). Use search_spec to locate topics, get_spec_pages to read exact pages.
COMPANY: ${company.name}, working capital ${company.workingCapital} KZT, tax regime ${company.taxRegime}.
BASELINE ENGINE RESULT: ${JSON.stringify(summarize(baseline))}`;

  const messages: any[] = [{ role: "system", content: system }, ...(body.messages ?? []).slice(-14)];
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      let applied: Scenario | null = null;
      send({ t: "quota", plan: tier, period: quota.period, limit: quota.limit, remaining: quota.remaining === null ? null : Math.max(0, quota.remaining - 1) });
      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          send({ t: "status", key: round === 0 ? "thinking" : "writing" });
          const res = await fetch(OPENAI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              // Reasoning models take an effort level instead of a temperature.
              ...(deep ? { reasoning_effort: "medium" } : { temperature: 0.3 }),
              stream: true,
              messages,
              tools: TOOLS,
              // Last round: force a text answer so the loop always terminates.
              tool_choice: round === MAX_TOOL_ROUNDS ? "none" : "auto",
            }),
          });
          if (!res.ok || !res.body) {
            const detail = redactKeys((await res.text()).slice(0, 300));
            const code = codeForStatus(res.status);
            console.error(`[openai] chat failed: HTTP ${res.status} ${code} — ${detail}`);
            send({ t: "error", error: code, detail });
            return;
          }

          // SSE: text deltas are forwarded as they arrive, tool calls are assembled.
          const reader = res.body.getReader();
          let buf = "";
          let content = "";
          const calls: { id: string; name: string; args: string }[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "[DONE]") continue;
              const delta = JSON.parse(data).choices?.[0]?.delta;
              if (!delta) continue;
              if (delta.content) {
                content += delta.content;
                send({ t: "delta", text: delta.content });
              }
              for (const tc of delta.tool_calls ?? []) {
                const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
                if (tc.id) c.id = tc.id;
                if (tc.function?.name) c.name += tc.function.name;
                if (tc.function?.arguments) c.args += tc.function.arguments;
              }
            }
          }

          if (!calls.length) {
            send({ t: "done", scenario: applied });
            return;
          }

          messages.push({
            role: "assistant",
            content: content || null,
            tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
          });

          for (const call of calls) {
            let args: any = {};
            try {
              args = JSON.parse(call.args || "{}");
            } catch {}
            let result: unknown;
            const need = NEED[call.name] ?? "free";

            if (PLAN_RANK[tier] < PLAN_RANK[need]) {
              send({ t: "locked", feature: call.name === "generate_letter" ? "letter" : "scenario", need });
              result = { locked: true, availableOn: need };
            } else if (call.name === "run_scenario") {
              send({ t: "status", key: "engine" });
              const scenario: Scenario = { ...NEUTRAL_SCENARIO };
              for (const k of Object.keys(NEUTRAL_SCENARIO) as (keyof Scenario)[]) {
                if (typeof args[k] === "number" && Number.isFinite(args[k])) scenario[k] = args[k];
              }
              const r = analyzeTender(tender, company, scenario);
              // The model often runs the baseline first; only a real what-if becomes a card.
              if (!isNeutral(scenario)) {
                applied = scenario;
                send({
                  t: "card",
                  card: {
                    tenderId: tender.id,
                    scenario,
                    tos: r.tos,
                    baseTos: baseline.tos,
                    netProfit: r.netProfit,
                    baseProfit: baseline.netProfit,
                    marginPct: r.marginPct,
                    gapDay: r.gapDay,
                    deficit: r.maxDeficit,
                    verdict: r.verdict,
                  },
                });
              }
              result = {
                scenario,
                result: summarize(r),
                deltaVsBaseline: { tos: +(r.tos - baseline.tos).toFixed(1), netProfitKzt: Math.round(r.netProfit - baseline.netProfit) },
              };
            } else if (call.name === "get_spec_pages") {
              send({ t: "status", key: "spec" });
              const wanted: number[] = Array.isArray(args.pages) ? args.pages.filter((n: unknown) => Number.isInteger(n)) : [];
              result = specPages(tender, wanted);
            } else if (call.name === "search_spec") {
              send({ t: "status", key: "spec" });
              result = searchSpec(tender, String(args.query ?? ""));
            } else if (call.name === "generate_letter") {
              send({ t: "status", key: "letter" });
              send({ t: "action", action: "letter" });
              result = { ok: true, note: "The .docx is generated in the user's browser from their profile (BIN, name, director)." };
            } else {
              result = { error: "unknown tool" };
            }
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
          }
        }
        send({ t: "error", error: "no-answer" });
      } catch (e) {
        send({ t: "error", error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
