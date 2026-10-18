import type { Env } from "./env";
import { sendAccessRequest } from "./email";

export type Access = "pending" | "approved" | "rejected";

export function adminEmails(env: Env): string[] {
  return (env.ADMIN_EMAIL ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
}

export function isAdmin(env: Env, email: string): boolean {
  return adminEmails(env).includes(email.toLowerCase());
}

/** L'admin è sempre dentro; gli altri solo dopo l'approvazione. */
export function effectiveAccess(env: Env, email: string, stored: string | null | undefined): Access {
  if (isAdmin(env, email)) return "approved";
  return stored === "approved" || stored === "rejected" ? stored : "pending";
}

/** Avvisa ogni admin di una nuova richiesta. Un errore di invio non blocca la registrazione. */
export async function notifyAccessRequest(env: Env, baseURL: string, user: { id: string; name: string; email: string }): Promise<void> {
  const link = `${baseURL}/admin/accessi?utente=${encodeURIComponent(user.id)}`;
  for (const admin of adminEmails(env)) {
    await sendAccessRequest(env, admin, user, link).catch((e) => console.error("Avviso richiesta di accesso non inviato", (e as Error).message));
  }
}
