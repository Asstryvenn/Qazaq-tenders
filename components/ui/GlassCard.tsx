"use client";

import { HTMLMotionProps, motion } from "framer-motion";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type GlassCardProps = HTMLMotionProps<"div"> & {
  /** Интерактивная карточка подсвечивает границу при наведении (без масштабирования). */
  interactive?: boolean;
  /** Оставлено для совместимости: свечения в монохромной системе нет. */
  glow?: "none" | "blue" | "emerald" | "crimson";
};

/** Плоская поверхность с резкой 1px-границей — блок bento-сетки. */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { className, interactive = true, glow: _glow, children, ...props },
  ref
) {
  return (
    <motion.div
      ref={ref}
      className={cn("glass relative overflow-hidden p-6", interactive && "hover:border-fg/40", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
});
