import { NextResponse } from "next/server";
import { fetchTenders } from "@/lib/tenders/source";

export async function GET() {
  return NextResponse.json(await fetchTenders());
}
