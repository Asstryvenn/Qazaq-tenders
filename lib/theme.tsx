"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "qt-theme";

interface ThemeValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeValue | null>(null);

/** Applies the theme as a class on <html> (Tailwind darkMode: "class"). One source of truth. */
function apply(t: Theme) {
  const d = document.documentElement;
  d.classList.toggle("light", t === "light");
  d.classList.toggle("dark", t === "dark");
  d.style.colorScheme = t;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  // The inline script in layout.tsx already applied the saved theme before paint; sync state.
  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  const setTheme = useCallback((t: Theme) => {
    apply(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  return <Ctx.Provider value={{ theme, setTheme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used inside <ThemeProvider>");
  return v;
}
