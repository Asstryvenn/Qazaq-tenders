"use client";

import { useEffect, useState } from "react";
import { useProfile } from "./profile";

/**
 * Whether to show admin entry points. UI only — every /api/admin/* route enforces the role
 * on the server. `app_metadata.role` comes from the session token; for admins granted via
 * ADMIN_EMAILS the server is asked once per session (the answer is cached per user id).
 */
export function useIsAdmin(): boolean {
  const { session } = useProfile();
  const userId = session?.user.id;
  const fromMetadata = session?.user.app_metadata?.role === "admin";
  const [fromServer, setFromServer] = useState(false);

  useEffect(() => {
    setFromServer(false);
    if (!session || fromMetadata) return;
    const key = `qt-admin:${session.user.id}`;
    try {
      const cached = sessionStorage.getItem(key);
      if (cached !== null) {
        setFromServer(cached === "1");
        return;
      }
    } catch {
      // storage blocked — just ask the server
    }
    let cancelled = false;
    fetch("/api/admin/me", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" })
      .then((r) => {
        if (cancelled) return;
        setFromServer(r.ok);
        try {
          sessionStorage.setItem(key, r.ok ? "1" : "0");
        } catch {}
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, fromMetadata]);

  return !!session && (fromMetadata || fromServer);
}
