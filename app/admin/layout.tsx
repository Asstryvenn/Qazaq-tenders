import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Admin · Qazaq Tenders",
  robots: { index: false, follow: false },
};

/**
 * Server layout for /admin. Sessions live in the browser (Bearer tokens, no cookies), so the
 * server cannot read them here: every admin endpoint enforces 401/403 itself and the shell
 * renders nothing until /api/admin/me confirms the role — non-admins are sent to "/".
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
