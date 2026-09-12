/** POST /api/documents/letter { tenderId, lang, company } → .docx. MAX plan only (enforced here). */
import { Packer } from "docx";
import { getRequestUser } from "@/lib/server/auth";
import { resolvePlan } from "@/lib/server/billing";
import { buildWarrantyLetter } from "@/lib/letter";
import { fetchTender } from "@/lib/tenders/source";
import { can } from "@/lib/plans";
import { isValidBin } from "@/lib/validation";
import type { CompanyProfile, TenderSpec } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return Response.json({ error: "auth" }, { status: 401 });
  const { plan } = await resolvePlan({ kind: "user", user });
  if (!can(plan, "letter")) return Response.json({ error: "plan", need: "max" }, { status: 402 });

  const { tenderId, lang, company, upload } = (await req.json()) as { tenderId: string; lang: "kz" | "ru"; company: CompanyProfile; upload?: TenderSpec };
  if (!company?.name || !isValidBin(company.bin || "")) return Response.json({ error: "invalid-company" }, { status: 400 });
  const tender = tenderId.startsWith("upload-") && upload?.id === tenderId ? upload : await fetchTender(tenderId);
  if (!tender) return Response.json({ error: "tender-not-found" }, { status: 404 });

  const buf = await Packer.toBuffer(buildWarrantyLetter(tender, company, lang === "kz" ? "kz" : "ru"));
  const name = `${lang === "kz" ? "Kepildik-hat" : "Garantiynoe-pismo"}-${tender.externalId}.docx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="letter.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
