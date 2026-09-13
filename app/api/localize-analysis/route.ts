/**
 * One-time migration for analyses saved before bilingual extraction existed.
 * It translates only already-extracted text; it does not reinterpret figures or clauses.
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/auth";
import { resolvePlan } from "@/lib/server/billing";
import { modelFor } from "@/lib/server/models";
import { getOpenAIKey, httpStatusFor, keyMissingBody, OpenAIError, openaiJson } from "@/lib/server/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const localizedRequirement = {
  type: "object",
  additionalProperties: false,
  required: ["textKz", "textRu", "proofKz", "proofRu"],
  properties: {
    textKz: { type: "string" },
    textRu: { type: "string" },
    proofKz: { type: "string" },
    proofRu: { type: "string" },
  },
};

const localizedRisk = {
  type: "object",
  additionalProperties: false,
  required: ["titleKz", "titleRu", "clauseKz", "clauseRu", "whyKz", "whyRu"],
  properties: {
    titleKz: { type: "string" },
    titleRu: { type: "string" },
    clauseKz: { type: "string" },
    clauseRu: { type: "string" },
    whyKz: { type: "string" },
    whyRu: { type: "string" },
  },
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["titleKz", "titleRu", "requirements", "risks"],
  properties: {
    titleKz: { type: "string" },
    titleRu: { type: "string" },
    requirements: { type: "array", items: localizedRequirement },
    risks: { type: "array", items: localizedRisk },
  },
};

interface LegacyBody {
  title?: string;
  requirements?: Array<{ text?: string; proof?: string }>;
  risks?: Array<{ title?: string; clause?: string; why?: string }>;
}

export async function POST(req: Request) {
  const apiKey = getOpenAIKey();
  if (!apiKey) return NextResponse.json(keyMissingBody, { status: 500 });
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = (await req.json()) as LegacyBody;
  const payload = {
    title: String(body.title || "").slice(0, 500),
    requirements: (body.requirements ?? []).slice(0, 60).map((r) => ({
      text: String(r.text || "").slice(0, 1_500),
      proof: String(r.proof || "").slice(0, 1_000),
    })),
    risks: (body.risks ?? []).slice(0, 12).map((r) => ({
      title: String(r.title || "").slice(0, 500),
      clause: String(r.clause || "").slice(0, 1_500),
      why: String(r.why || "").slice(0, 1_000),
    })),
  };
  const chars = JSON.stringify(payload).length;
  if (!chars || chars > 60_000) return NextResponse.json({ error: "invalid-payload" }, { status: 422 });

  try {
    const { plan } = await resolvePlan({ kind: "user", user });
    const out = await openaiJson(apiKey, {
      model: modelFor(plan, false),
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "bilingual_tender_copy", strict: true, schema } },
      messages: [
        {
          role: "system",
          content: `Translate already-extracted Kazakhstan tender text into both Kazakh (Cyrillic) and Russian.
Return arrays in exactly the same order and with exactly the same number of elements as the input.
Preserve all figures, units, dates, model names, standards, legal meaning and negations. Do not summarize, add or remove requirements.
proofKz/proofRu must clearly say what evidence the bidder should attach. Never use English except official product, company or standard names.`,
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }, "localize-analysis");
    if (out.requirements?.length !== payload.requirements.length || out.risks?.length !== payload.risks.length) {
      return NextResponse.json({ error: "LOCALIZATION_COUNT_MISMATCH" }, { status: 502 });
    }
    return NextResponse.json({ success: true, ...out });
  } catch (e) {
    if (e instanceof OpenAIError) return NextResponse.json({ error: e.code, detail: e.message }, { status: httpStatusFor(e.code) });
    return NextResponse.json({ error: "LOCALIZATION_FAILED", detail: (e as Error).message }, { status: 502 });
  }
}
