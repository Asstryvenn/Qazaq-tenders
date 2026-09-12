import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand: navy #032147 background, sky #00B2FE accent, white text.
        ink: { DEFAULT: "#032147", 900: "#021a38", 800: "#08295a", 700: "#0d3470" },
        accent: { blue: "#00B2FE", emerald: "#10b981", crimson: "#f43f5e", amber: "#f59e0b" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(0,178,254,0.55)",
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
