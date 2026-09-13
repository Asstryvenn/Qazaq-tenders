/** Fire-and-forget product analytics from the browser (see /api/events). */

export function track(type: "tender_analyzed" | "logistics_choice", meta: Record<string, unknown>, token?: string | null): void {
  try {
    void fetch("/api/events", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ type, meta }),
    }).catch(() => undefined);
  } catch {
    // analytics must never break the UI
  }
}

/** Same event at most once per key per browser session (e.g. one «tender analysed» per lot). */
export function trackOnce(key: string, type: "tender_analyzed" | "logistics_choice", meta: Record<string, unknown>, token?: string | null): void {
  try {
    const k = `qt-track:${key}`;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, "1");
  } catch {
    // storage blocked — still report once per page load
  }
  track(type, meta, token);
}
