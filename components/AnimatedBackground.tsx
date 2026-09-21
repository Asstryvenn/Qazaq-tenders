/**
 * Page background. Light: Premium Beige (#F4F1EA), flat. Dark: Deep Sea (#0B1319) with a
 * soft emerald FinTech glow from the top-right. Static — no motion, no grid.
 */
export function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden bg-[#F4F1EA] dark:bg-[#0B1319]">
      <div className="absolute inset-0 hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-[#10B981]/15 via-transparent to-transparent dark:block" />
    </div>
  );
}
