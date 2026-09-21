/**
 * Page background: a near-black teal ground with a soft, heavily blurred mesh of
 * #003B46 — present but never competing with the numbers. Static: no motion, no grid.
 */
export function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-app-bg">
      <div className="absolute -left-40 -top-40 h-[40rem] w-[40rem] rounded-full bg-deep-water opacity-10 blur-3xl" />
      <div className="absolute right-[-10rem] top-1/4 h-[34rem] w-[34rem] rounded-full bg-ocean opacity-10 blur-3xl" />
      <div className="absolute bottom-[-16rem] left-1/3 h-[42rem] w-[42rem] rounded-full bg-deep-water opacity-10 blur-3xl" />
      <div className="bg-vignette absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_45%,rgba(2,10,12,0.9)_100%)]" />
    </div>
  );
}
