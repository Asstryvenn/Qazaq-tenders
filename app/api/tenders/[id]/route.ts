import { NextResponse } from "next/server";
import { fetchTender } from "@/lib/tenders/source";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const tender = await fetchTender(decodeURIComponent(params.id));
  if (!tender) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ tender });
}
