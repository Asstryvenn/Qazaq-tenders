"use client";

import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline";

// Монохром: основная кнопка — инверсия темы (белая в тёмной, чёрная в светлой).
const variants: Record<Variant, string> = {
  primary: "border border-fg bg-fg font-semibold text-app-bg hover:bg-fg/85",
  outline: "border border-line bg-transparent text-fg hover:border-fg/60 hover:bg-fg/[0.04]",
  ghost: "border border-transparent text-zinc-400 hover:bg-fg/[0.05] hover:text-fg",
};

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: HTMLMotionProps<"button"> & { variant?: Variant }) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.08 }}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-fg disabled:cursor-not-allowed",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
