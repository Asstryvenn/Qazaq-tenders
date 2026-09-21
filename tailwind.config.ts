import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // «Морская волна» — Enterprise/FinTech palette.
        // Theme tokens are CSS variables (app/globals.css) so light and dark both work.
        "deep-water": "rgb(var(--c-deep-water) / <alpha-value>)", // tinted fills
        ocean: "rgb(var(--c-ocean) / <alpha-value>)", // hover states, secondary
        wave: "rgb(var(--c-wave) / <alpha-value>)", // primary accent
        "sea-foam": "rgb(var(--c-sea-foam) / <alpha-value>)", // highlights, borders
        "app-bg": "rgb(var(--c-app-bg) / <alpha-value>)", // page background
        surface: "rgb(var(--c-surface) / <alpha-value>)", // cards
        ink: { DEFAULT: "rgb(var(--c-app-bg) / <alpha-value>)", 900: "rgb(var(--c-app-bg) / <alpha-value>)", 800: "rgb(var(--c-surface) / <alpha-value>)", 700: "rgb(var(--c-surface-2) / <alpha-value>)" },
        accent: { blue: "rgb(var(--c-wave) / <alpha-value>)", emerald: "#10b981", crimson: "#f43f5e", amber: "#f59e0b" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 32px -12px rgba(102,165,173,0.35)",
        "glow-emerald": "0 0 40px -8px rgba(16,185,129,0.5)",
        "glow-crimson": "0 0 40px -8px rgba(244,63,94,0.5)",
        card: "0 24px 60px -24px rgba(0,0,0,0.85)",
      },
      keyframes: {
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-14px)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-ring": {
          "0%": { opacity: "0.7", transform: "scale(0.9)" },
          "70%,100%": { opacity: "0", transform: "scale(1.6)" },
        },
      },
      animation: {
        float: "float 7s ease-in-out infinite",
        shimmer: "shimmer 2.2s infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.24,0.8,0.32,1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
