"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "qt-theme";

/** Dark is the default; the choice is remembered and applied before paint by layout.tsx. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  const setTheme = useCallback((t: Theme) => {
    const d = document.documentElement;
    d.classList.toggle("light", t === "light");
    d.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    setThemeState(t);
  }, []);

  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
