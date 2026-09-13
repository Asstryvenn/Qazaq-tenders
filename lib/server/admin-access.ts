/**
 * Admin access rule. Kept dependency-free so it can be unit-tested with `node --test`.
 *
 * - `app_metadata.role === "admin"` grants access. Only the server (service key / SQL) can
 *   write app_metadata, so users cannot grant it to themselves.
 * - `user_metadata` is editable by the user and is deliberately ignored.
 * - An email listed in ADMIN_EMAILS grants access only once that email is confirmed.
 */
export interface AdminCandidate {
  email?: string | null;
  emailConfirmed: boolean;
  appRole?: unknown;
}

export function parseAdminEmails(csv: string | undefined | null): string[] {
  return (csv ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function adminRoleSource(user: AdminCandidate | null | undefined, adminEmailsCsv?: string | null): "app_metadata" | "env" | null {
  if (!user) return null;
  if (user.appRole === "admin") return "app_metadata";
  const email = (user.email ?? "").trim().toLowerCase();
  if (email && user.emailConfirmed && parseAdminEmails(adminEmailsCsv).includes(email)) return "env";
  return null;
}

export const isAdmin = (user: AdminCandidate | null | undefined, adminEmailsCsv?: string | null): boolean =>
  adminRoleSource(user, adminEmailsCsv) !== null;
