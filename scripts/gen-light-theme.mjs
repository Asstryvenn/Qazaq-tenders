/**
 * Generates app/theme-light.css — light-mode overrides for the dark-first utility classes
 * used across the app (text-white, bg-white/5, border-white/10, bg-ink-800, …).
 * Run after adding new colour classes:  npm run theme:gen
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "components", "lib"];
const PAL = {
  // Warm stone (espresso/taupe) for the Premium Beige light theme
  slate: { 100: "#f5f5f4", 200: "#e7e5e4", 300: "#d6d3d1", 400: "#a8a29e", 500: "#78716c", 600: "#57534e", 700: "#44403c", 800: "#292524", 900: "#1c1917" },
  emerald: { 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46" },
  rose: { 100: "#ffe4e6", 200: "#fecdd3", 300: "#fda4af", 400: "#fb7185", 500: "#f43f5e", 600: "#e11d48", 700: "#be123c", 800: "#9f1239" },
  amber: { 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e" },
  sky: { 100: "#e0f2fe", 200: "#bae6fd", 300: "#7dd3fc", 400: "#38bdf8", 500: "#0ea5e9", 600: "#0284c7", 700: "#0369a1", 800: "#075985" },
  blue: { 100: "#dbeafe", 200: "#bfdbfe", 300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6", 600: "#2563eb", 700: "#1d4ed8", 800: "#1e40af" },
  violet: { 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9", 800: "#5b21b6" },
  pink: { 100: "#fce7f3", 200: "#fbcfe8", 300: "#f9a8d4", 400: "#f472b6", 500: "#ec4899", 600: "#db2777", 700: "#be185d", 800: "#9d174d" },
  indigo: { 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca" },
};
const INK = { "": "#F4F1EA", 900: "#FAF8F4", 800: "#ffffff", 700: "#FAF8F4" };
const DARK = [41, 37, 36]; // #292524 espresso

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
  }
};
ROOTS.forEach(walk);

const RE = /(?<![\w-])((?:hover|group-hover|focus-within|focus):)?(text|bg|border|ring|from|via|to)-(white|black|ink(?:-\d{3})?|[a-z]+-\d{2,3})(?:\/(\d{1,3}|\[[\d.]+\]))?(?![\w-])/g;
const found = new Map();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(RE)) found.set(m[0], m);

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const alphaOf = (a) => (a == null ? 1 : a.startsWith("[") ? parseFloat(a.slice(1, -1)) : parseInt(a, 10) / 100);
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
const esc = (s) => s.replace(/([:/[\].])/g, "\\$1");
const darker = (fam, shade) => {
  const s = Number(shade);
  const t = s <= 300 ? 700 : s <= 500 ? 600 : s;
  return PAL[fam]?.[t] ?? PAL[fam]?.[700];
};

// White text stays white on filled/gradient controls.
const KEEP_WHITE = ':not([class*="bg-accent"], [class*="bg-gradient"], [class*="bg-rose-5"], [class*="bg-blue-5"], .keep-white, [class*="bg-accent"] *, [class*="bg-gradient"] *, .keep-white *)';

const rules = [];
for (const [token, m] of found) {
  const [, variant, prop, color, alphaRaw] = m;
  const a = alphaOf(alphaRaw);
  const [fam, shade] = color.includes("-") && !color.startsWith("ink") ? color.split("-") : [color, ""];
  let decl = null;
  let extra = "";

  if (prop === "text") {
    if (color === "white") (decl = `color: ${rgba(DARK, a)}`), (extra = KEEP_WHITE);
    else if (fam === "slate") decl = `color: ${PAL.slate[{ 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 500 }[shade] ?? 700]}`;
    else if (PAL[fam] && Number(shade) <= 400) decl = `color: ${darker(fam, shade)}`;
  } else if (prop === "bg") {
    if (color === "white" && alphaRaw) decl = `background-color: ${rgba(DARK, Math.min(0.12, a * 0.7))}`;
    else if (color === "black" && alphaRaw) decl = `background-color: ${rgba(DARK, a * 0.15)}`;
    else if (color.startsWith("ink")) {
      const hex = INK[color.split("-")[1] ?? ""];
      if (hex) decl = `background-color: ${rgba(hexRgb(hex), a)}`;
    }
  } else if (prop === "border" || prop === "ring") {
    const cssProp = prop === "border" ? "border-color" : "--tw-ring-color";
    if (color === "white" && alphaRaw) decl = `${cssProp}: ${rgba(DARK, Math.min(0.2, Math.max(0.06, a * 1.2)))}`;
  } else if (["from", "via", "to"].includes(prop) && PAL[fam] && Number(shade) <= 400) {
    // Pastel gradient text is unreadable on white — deepen it, only for bg-clip-text headings.
    const c = darker(fam, shade);
    const [r, g, b] = hexRgb(c);
    const clear = `rgb(${r} ${g} ${b} / 0)`;
    decl =
      prop === "from"
        ? `--tw-gradient-from: ${c} var(--tw-gradient-from-position); --tw-gradient-to: ${clear} var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to)`
        : prop === "via"
          ? `--tw-gradient-to: ${clear} var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), ${c} var(--tw-gradient-via-position), var(--tw-gradient-to)`
          : `--tw-gradient-to: ${c} var(--tw-gradient-to-position)`;
    extra = ".bg-clip-text";
  }
  if (!decl) continue;

  const cls = "." + esc(token);
  const sel =
    variant === "hover:" ? `html.light ${cls}${extra}:hover`
    : variant === "focus:" ? `html.light ${cls}${extra}:focus`
    : variant === "focus-within:" ? `html.light ${cls}${extra}:focus-within`
    : variant === "group-hover:" ? `html.light .group:hover ${cls}${extra}`
    : `html.light ${cls}${extra}`;
  rules.push(`${sel} { ${decl}; }`);
}

rules.sort();
writeFileSync(
  "app/theme-light.css",
  `/* AUTO-GENERATED by scripts/gen-light-theme.mjs — do not edit by hand. */\n${rules.join("\n")}\n`
);
console.log(`theme-light.css: ${rules.length} rules from ${found.size} colour classes in ${files.length} files`);
