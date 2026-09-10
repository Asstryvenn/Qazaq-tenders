"use client";

import { HTMLMotionProps, motion } from "framer-motion";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type GlassCardProps = HTMLMotionProps<"div"> & {
  /** Disable the hover-scale interaction (e.g. for static panels). */
  interactive?: boolean;
  glow?: "none" | "blue" | "emerald" | "crimson";
};

const glowMap = {
  none: "",
  blue: "hover:shadow-glow",
  emerald: "hover:shadow-glow-emerald",
  crimson: "hover:shadow-glow-crimson",
} as const;

/** Glassmorphism surface with a lit top hairline and hover-scale. */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { className, interactive = true, glow = "none", children, ...props },
  ref
) {
  return (
    <motion.div
      ref={ref}
      whileHover={interactive ? { scale: 1.02, y: -2 } : undefined}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className={cn(
        "hairline glass relative overflow-hidden p-6 shadow-card transition-shadow duration-300",
        glowMap[glow],
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
});
