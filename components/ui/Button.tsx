"use client";

import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline";

const variants: Record<Variant, string> = {
  primary:
    "bg-wave font-semibold text-app-bg hover:bg-sea-foam border border-sea-foam/30 transition-all duration-300",
  outline: "border border-sea-foam/20 bg-deep-water/20 text-slate-100 hover:bg-ocean/40 hover:border-wave/60 backdrop-blur transition-all duration-300",
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
        "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
