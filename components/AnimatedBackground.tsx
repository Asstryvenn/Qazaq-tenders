/**
 * Page background: lifted teal-slate ground with one very subtle, blurred radial mesh of
 * #07575B from the top — no motion, no grid. Uses theme tokens, so light mode is slate-50.
 */
export function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden bg-app-bg">
      <div className="absolute inset-x-0 -top-40 h-[40rem] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-ocean/15 via-transparent to-transparent blur-3xl" />
    </div>
  );
}
