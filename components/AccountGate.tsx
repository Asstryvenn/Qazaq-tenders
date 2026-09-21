"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "@/lib/profile";

/** App screens that only exist after registration. */
// /analyze is open to guests: the PDF is read locally and analysis resumes after sign-in.
const PROTECTED = ["/dashboard", "/tender", "/ai-studio", "/profile"];

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

  // Registered users skip the landing page and land on «Тендер нарығы» immediately.
  useEffect(() => {
    if (!loading && hasAccount && pathname === "/") router.replace("/dashboard");
  }, [loading, hasAccount, pathname, router]);

  useEffect(() => {
    if (!blocked) return;
    router.replace("/");
    openModal("register");
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
