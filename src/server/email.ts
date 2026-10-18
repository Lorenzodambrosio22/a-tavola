import type { Env } from "./env";

/**
 * Codici inviati in sviluppo (senza RESEND_API_KEY). Usato anche dai test.
 * In produzione resta vuoto.
 */
export const devOutbox = new Map<string, string>();

/** Altre email inviate in sviluppo e nei test (approvazioni, avvisi). In produzione resta vuoto. */
export const devMails: { to: string; subject: string; text: string }[] = [];

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function devMode(env: Env): boolean {
  return env.APP_ENV === "development" || env.APP_ENV === "test";
}

/** Invia con Resend; senza chiave (solo sviluppo e test) la registra in `devMails`. */
async function send(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (!devMode(env)) throw new Error("RESEND_API_KEY non configurato");
    devMails.push({ to: mail.to, subject: mail.subject, text: mail.text });
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "A Tavola <onboarding@resend.dev>",
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Invio email fallito", res.status, body);
    throw new Error("Invio email non riuscito");
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export async function sendLoginCode(env: Env, email: string, otp: string): Promise<void> {
  if (!env.RESEND_API_KEY && devMode(env)) {
    devOutbox.set(email.toLowerCase(), otp);
    console.log(`[A Tavola] Codice di accesso per ${email}: ${otp}`);
    return;
  }
  await send(env, {
    to: email,
    subject: `Il tuo codice A Tavola: ${otp}`,
    text: `Ciao!\n\nIl tuo codice di accesso è ${otp}.\nScade tra 10 minuti.\n\nSe non hai richiesto tu l'accesso, ignora questa email.`,
    html: `<p>Ciao!</p><p>Il tuo codice di accesso è <strong style="font-size:22px;letter-spacing:4px">${otp}</strong>.</p><p>Scade tra 10 minuti. Se non hai richiesto tu l'accesso, ignora questa email.</p>`,
  });
}

/** All'admin: una nuova persona chiede di entrare. */
export async function sendAccessRequest(env: Env, adminEmail: string, who: { name: string; email: string }, link: string): Promise<void> {
  const name = who.name.trim() || "(nome non indicato)";
  await send(env, {
    to: adminEmail,
    subject: `Nuova richiesta di accesso: ${who.email}`,
    text: `${name} <${who.email}> ha chiesto di usare A Tavola.\n\nApprova o rifiuta qui: ${link}`,
    html: `<p><strong>${esc(name)}</strong> &lt;${esc(who.email)}&gt; ha chiesto di usare A Tavola.</p><p><a href="${esc(link)}">Approva o rifiuta la richiesta</a></p>`,
  });
}

/** All'utente approvato. */
export async function sendAccessGranted(env: Env, email: string, appUrl: string): Promise<void> {
  await send(env, {
    to: email,
    subject: "Il tuo accesso ad A Tavola è attivo",
    text: `Ciao!\n\nIl tuo accesso ad A Tavola è attivo: entra da ${appUrl} con la stessa email.\n\nBuon appetito!`,
    html: `<p>Ciao!</p><p>Il tuo accesso ad A Tavola è attivo: <a href="${esc(appUrl)}">entra</a> con la stessa email.</p><p>Buon appetito!</p>`,
  });
}

/** All'admin: raggiunto il tetto giornaliero di operazioni AI per tutta l'app. */
export async function sendGlobalCapReached(env: Env, adminEmail: string, day: string, limit: number): Promise<void> {
  await send(env, {
    to: adminEmail,
    subject: `A Tavola: raggiunto il tetto AI di oggi (${limit})`,
    text: `Oggi (${day}) A Tavola ha raggiunto ${limit} operazioni AI. Le funzioni AI restano in pausa per tutti fino a mezzanotte (ora italiana); tu come admin puoi continuare.\n\nPer cambiare il tetto: variabile AI_LIMIT_GLOBAL_DAY in wrangler.jsonc.`,
    html: `<p>Oggi (${esc(day)}) A Tavola ha raggiunto <strong>${limit}</strong> operazioni AI.</p><p>Le funzioni AI restano in pausa per tutti fino a mezzanotte (ora italiana); tu come admin puoi continuare.</p><p>Per cambiare il tetto: variabile <code>AI_LIMIT_GLOBAL_DAY</code> in wrangler.jsonc.</p>`,
  });
}
