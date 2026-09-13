"use client";

import { useCallback, useEffect, useState } from "react";
import { useProfile } from "./profile";

/** GET an admin endpoint with the session token; re-runs when the path changes. */
export function useAdminApi<T>(path: string) {
  const { session } = useProfile();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const token = session?.access_token;

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || d.error || `HTTP ${res.status}`);
      setData(d as T);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path, token]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, token };
}

export async function adminPost(path: string, body: unknown, token?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: d.detail || d.error || `HTTP ${res.status}` };
}

export const fmtKzt = (v: number) => `${Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ")} ₸`;
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
