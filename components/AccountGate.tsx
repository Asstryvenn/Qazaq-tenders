"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "@/lib/profile";

/** App screens that only exist after registration. */
// «Тендер нарығы» (/dashboard) and /analyze are open to guests — deep screens are not.
const PROTECTED = ["/tender", "/ai-studio", "/profile"];

const isProtected = (path: string) => PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Guests who open an app screen directly are sent to the landing page with the
 * registration wizard open. Waits for the session check so signed-in users never flash out.
 */
export function AccountGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { hasAccount, loading, openModal } = useProfile();
  const guarded = isProtected(pathname);
  const blocked = guarded && !loading && !hasAccount;

  useEffect(() => {
    if (!blocked) return;
    router.replace("/dashboard");
    openModal("gate");
  }, [blocked, router, openModal]);

  // No loading screen: the page renders at once and guests are redirected once the session check ends.
  if (blocked) return null;
  return <>{children}</>;
}

/** Landing CTA: registered users go to the dashboard, guests get the registration wizard. */
export function StartCta({ children, className }: { children: React.ReactNode; className?: string }) {
  const { hasAccount, openModal } = useProfile();
  if (hasAccount)
    return (
      <Link href="/dashboard" className={className}>
        {children}
      </Link>
    );
  return (
    <div className={className} onClick={() => openModal("register")}>
      {children}
    </div>
  );
}
