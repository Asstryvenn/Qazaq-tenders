"use client";

import type { CompanyProfile } from "./types";

/** Asks the server for the .docx (MAX plan enforced there) and saves it. */
export async function downloadLetter(tenderId: string, company: CompanyProfile, lang: "kz" | "ru", headers: Record<string, string>) {
  const res = await fetch("/api/documents/letter", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ tenderId, lang, company }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    return { ok: false as const, error: (d.error as string) || `HTTP ${res.status}`, status: res.status };
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] || "letter.docx");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true as const };
}
