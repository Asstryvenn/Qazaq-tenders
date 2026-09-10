/**
 * AI Consultant. OpenAI handles language; every number comes from the deterministic
 * engine through the `run_scenario` tool, and every quote from `get_spec_pages`.
 * This keeps the two-layer rule: the LLM never does the financial math itself.
 */
import { NextResponse } from "next/server";
import { analyzeTender } from "@/lib/engine";
import { fetchTender } from "@/lib/tenders/source";
import { CompanyProfile, NEUTRAL_SCENARIO, Scenario } from "@/lib/types";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_TOOL_ROUNDS = 4;

type ChatMsg = { role: "user" | "assistant"; content: string };

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_scenario",
      description:
        "Recalculate the tender with the deterministic economic engine under a what-if scenario. Use for ANY question about profit, margin, TOS, cash gap or costs. All levers are deltas; omit a lever to keep it at 0.",
      parameters: {
        type: "object",
        properties: {
          fuelDeltaPct: { type: "number", description: "Fuel price change, %. Moves only the fuel share (40%) of freight." },
          transportDeltaPct: { type: "number", description: "Whole transport tariff change, %. 'Transport costs −10%' → -10." },
          supplierDeltaPct: { type: "number", description: "Supplier price change, %." },
          paymentDelayDelta: { type: "number", description: "Extra days the customer pays late." },
          lateDays: { type: "number", description: "Days of late delivery (statutory penalty applies)." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_spec_pages",
      description: "Return the text of technical-specification pages. Call before quoting or judging any clause.",
      parameters: {
        type: "object",
        properties: {
          pages: { type: "array", items: { type: "integer" }, description: "Page numbers; empty = all pages." },
        },
        additionalProperties: false,
      },
    },
  },
];

/** Compact engine output — what the model is allowed to cite. */
function summarize(r: ReturnType<typeof analyzeTender>) {
  return {
    tos: r.tos,
    verdict: r.verdict,
    netProfitKzt: Math.round(r.netProfit),
    marginPct: +r.marginPct.toFixed(2),
    cashFlowGap: r.cashFlowGap,
    gapDay: r.gapDay,
    maxDeficitKzt: Math.round(r.maxDeficit),
    deliveryDay: r.deliveryDay,
    payDay: r.payDay,
    distanceKm: r.distanceKm,
    trucks: r.trucks,
    costsKzt: Object.fromEntries(Object.entries(r.costs).map(([k, v]) => [k, Math.round(v)])),
    reasons: r.reasons,
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no-openai-key" }, { status: 503 });

  const body = (await req.json()) as {
    tenderId: string;
    company: CompanyProfile;
    scenario?: Scenario;
    lang: "kz" | "ru";
    messages: ChatMsg[];
  };

  const tender = await fetchTender(body.tenderId);
  if (!tender) return NextResponse.json({ error: "tender-not-found" }, { status: 404 });

  const company = body.company;
  const baseline = analyzeTender(tender, company);
  let appliedScenario: Scenario | null = null;

  const language = body.lang === "kz" ? "Kazakh (қазақ тілі, Cyrillic)" : "Russian";
  const system = `You are "AI Консультант", an economic advisor for a Kazakhstani SME deciding whether to bid on a public tender.
Answer ONLY in ${language}. Be concise: 2–6 short sentences or a tight list. Give an actionable recommendation.

HARD RULES
- Never calculate money, margins, TOS or dates yourself. Call run_scenario and cite its numbers.
- Before quoting or assessing any clause, call get_spec_pages. Always cite the page ("бет 12" / "стр. 12").
- If a requested page does not exist, say so plainly — do not invent content.
- Amounts: format as "14,1 млн ₸" style. Explain jargon in plain words.
- Kazakh procurement norms: bid security 1%, performance security 3%, penalty 0.1%/day capped at 10%.

TENDER: ${tender.title} — ${tender.customer}. Contract ${tender.contractAmount} KZT, delivery ${tender.deliveryDays} days, payment ${tender.paymentDelayDays} days after delivery.
Spec pages available: ${tender.specPages.map((p) => p.page).join(", ") || "none"}.
COMPANY: ${company.name}, working capital ${company.workingCapital} KZT, tax regime ${company.taxRegime}.
BASELINE ENGINE RESULT: ${JSON.stringify(summarize(baseline))}`;

  const messages: any[] = [{ role: "system", content: system }, ...body.messages.slice(-12)];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        messages,
        tools: TOOLS,
        // Last round: force a text answer so the loop always terminates.
        tool_choice: round === MAX_TOOL_ROUNDS ? "none" : "auto",
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: "openai-error", detail: detail.slice(0, 300) }, { status: 502 });
    }
    const msg = (await res.json()).choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return NextResponse.json({ reply: msg.content ?? "", scenario: appliedScenario });
    }

    for (const call of msg.tool_calls) {
      let args: any = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      let result: unknown;
      if (call.function.name === "run_scenario") {
        const scenario: Scenario = { ...NEUTRAL_SCENARIO };
        for (const k of Object.keys(NEUTRAL_SCENARIO) as (keyof Scenario)[]) {
          if (typeof args[k] === "number" && Number.isFinite(args[k])) scenario[k] = args[k];
        }
        appliedScenario = scenario;
        const r = summarize(analyzeTender(tender, company, scenario));
        result = { scenario, result: r, deltaVsBaseline: { tos: +(r.tos - baseline.tos).toFixed(1), netProfitKzt: Math.round(r.netProfitKzt - baseline.netProfit) } };
      } else if (call.function.name === "get_spec_pages") {
        const wanted: number[] = Array.isArray(args.pages) ? args.pages : [];
        const pages = wanted.length ? tender.specPages.filter((p) => wanted.includes(p.page)) : tender.specPages;
        const missing = wanted.filter((n) => !tender.specPages.some((p) => p.page === n));
        result = { pages, missingPages: missing, hiddenRequirementsFlagged: tender.hiddenRequirements };
      } else {
        result = { error: "unknown tool" };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return NextResponse.json({ error: "no-answer" }, { status: 500 });
}
