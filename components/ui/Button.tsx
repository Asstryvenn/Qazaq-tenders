"use client";

import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent-blue font-semibold text-ink shadow-glow hover:bg-[#33c1fe] border border-sky-300/50",
  outline: "border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 backdrop-blur",
  ghost: "text-slate-300 hover:text-white hover:bg-white/5",
};

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: HTMLMotionProps<"button"> & { variant?: Variant }) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
