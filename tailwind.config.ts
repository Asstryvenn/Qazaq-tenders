import type { Config } from "tailwindcss";

/**
 * Монохромная дизайн-система «Terminal»: чёрный #09090b, белый #fff, шкала zinc для границ
 * и второстепенного текста. Цвета остаются только смысловыми: зелёный — прибыль/«участвовать»,
 * красный — риск/кассовый разрыв, янтарный — осторожно.
 *
 * Синие, голубые, фиолетовые и сине-серые (slate) палитры намеренно переназначены на нейтральную
 * шкалу zinc — так старые классы вроде text-blue-300 или bg-sky-500 автоматически становятся
 * монохромными, без «AI-градиентов».
 */
const zinc = {
  50: "#fafafa",
  100: "#f4f4f5",
  200: "#e4e4e7",
  300: "#d4d4d8",
  400: "#a1a1aa",
  500: "#71717a",
  600: "#52525b",
  700: "#3f3f46",
  800: "#27272a",
  900: "#18181b",
  950: "#09090b",
};

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Токены темы — CSS-переменные (app/globals.css), чтобы светлая и тёмная темы работали одинаково.
        fg: "rgb(var(--c-fg) / <alpha-value>)", // основной текст и «инверсные» кнопки
        muted: "rgb(var(--c-muted) / <alpha-value>)", // второстепенный текст
        line: "rgb(var(--c-line) / <alpha-value>)", // границы
        "app-bg": "rgb(var(--c-app-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        // Старые имена «морской» палитры теперь указывают на монохромные токены.
        "deep-water": "rgb(var(--c-deep-water) / <alpha-value>)",
        ocean: "rgb(var(--c-ocean) / <alpha-value>)",
        wave: "rgb(var(--c-fg) / <alpha-value>)",
        "sea-foam": "rgb(var(--c-sea-foam) / <alpha-value>)",
        ink: { DEFAULT: "rgb(var(--c-app-bg) / <alpha-value>)", 900: "rgb(var(--c-app-bg) / <alpha-value>)", 800: "rgb(var(--c-surface) / <alpha-value>)", 700: "rgb(var(--c-surface-2) / <alpha-value>)" },
        accent: { blue: "rgb(var(--c-fg) / <alpha-value>)", emerald: "#10b981", crimson: "#f43f5e", amber: "#f59e0b" },
        slate: zinc,
        gray: zinc,
        blue: zinc,
        sky: zinc,
        indigo: zinc,
        violet: zinc,
        purple: zinc,
        cyan: zinc,
        teal: zinc,
        pink: zinc,
        fuchsia: zinc,
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Резкие формы: никаких «пузырей».
      borderRadius: {
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "4px",
        xl: "6px",
        "2xl": "6px",
        "3xl": "8px",
      },
      // Тени и свечения убраны: глубина — только границами.
      boxShadow: {
        glow: "none",
        "glow-emerald": "none",
        "glow-crimson": "none",
        card: "none",
        sm: "none",
        md: "none",
        lg: "none",
      },
      keyframes: {
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-ring": { "0%": { opacity: "0.6" }, "100%": { opacity: "0" } },
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        blink: { "0%,49%": { opacity: "1" }, "50%,100%": { opacity: "0" } },
      },
      animation: {
        float: "float 7s ease-in-out infinite",
        shimmer: "shimmer 2.2s infinite",
        "pulse-ring": "pulse-ring 2.4s ease-out infinite",
        marquee: "marquee 60s linear infinite",
        blink: "blink 1s steps(1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
