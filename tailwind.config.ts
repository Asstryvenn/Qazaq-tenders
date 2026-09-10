import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#030712", 900: "#050810", 800: "#090d16", 700: "#0e1424" },
        accent: { blue: "#3b82f6", emerald: "#10b981", crimson: "#f43f5e", amber: "#f59e0b" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(59,130,246,0.45)",
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
