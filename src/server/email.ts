import type { Env } from "./env";

/**
 * Codici inviati in sviluppo (senza RESEND_API_KEY). Usato anche dai test.
 * In produzione resta vuoto.
 */
export const devOutbox = new Map<string, string>();

export async function sendLoginCode(env: Env, email: string, otp: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
      throw new Error("RESEND_API_KEY non configurato");
    }
    devOutbox.set(email.toLowerCase(), otp);
    console.log(`[App Cibo] Codice di accesso per ${email}: ${otp}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "App Cibo <onboarding@resend.dev>",
      to: [email],
      subject: `Il tuo codice App Cibo: ${otp}`,
      text: `Ciao!\n\nIl tuo codice di accesso è ${otp}.\nScade tra 10 minuti.\n\nSe non hai richiesto tu l'accesso, ignora questa email.`,
      html: `<p>Ciao!</p><p>Il tuo codice di accesso è <strong style="font-size:22px;letter-spacing:4px">${otp}</strong>.</p><p>Scade tra 10 minuti. Se non hai richiesto tu l'accesso, ignora questa email.</p>`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Invio email fallito", res.status, body);
    throw new Error("Invio email non riuscito");
  }
}
