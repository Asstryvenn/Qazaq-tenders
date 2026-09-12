"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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

  useEffect(() => {
    if (!blocked) return;
    router.replace("/");
    openModal("register");
  }, [blocked, router, openModal]);

  if (guarded && (loading || !hasAccount))
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
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
