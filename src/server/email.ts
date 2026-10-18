import type { Env } from "./env";

/**
 * Codici inviati in sviluppo (senza RESEND_API_KEY). Usato anche dai test.
 * In produzione resta vuoto.
 */
export const devOutbox = new Map<string, string>();

/** Altre email inviate in sviluppo e nei test (approvazioni, avvisi). In produzione resta vuoto. */
export const devMails: { to: string; subject: string; text: string; html: string }[] = [];

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const DEFAULT_URL = "https://atavola.lorenzodambrosio.com";

function devMode(env: Env): boolean {
  return env.APP_ENV === "development" || env.APP_ENV === "test";
}

/** Invia con Resend; senza chiave (solo sviluppo e test) la registra in `devMails`. */
async function send(env: Env, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (!devMode(env)) throw new Error("RESEND_API_KEY non configurato");
    devMails.push({ ...mail });
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

// Colori e caratteri dell'app (styles.css), in linea perché i client email ignorano i fogli di stile.
const C = { bg: "#f7faf6", surface: "#ffffff", soft: "#e7f2e9", ink: "#213e30", ink2: "#647466", line: "#e0e9dc", accent: "#286548" };
const SERIF = `'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif`;
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;

/** Corpo dell'email nello stile di A Tavola. `body` è HTML già escapato. */
function layout(o: { base: string; preheader: string; eyebrow: string; title: string; body: string; cta?: { label: string; href: string }; note?: string }): string {
  const base = o.base.replace(/\/+$/, "");
  const cta = o.cta
    ? `<tr><td style="padding:8px 0 26px"><a href="${esc(o.cta.href)}" style="display:inline-block;background:${C.accent};color:#ffffff;font:600 16px ${SANS};text-decoration:none;padding:14px 26px;border-radius:999px">${esc(o.cta.label)}</a></td></tr>`
    : "";
  const note = o.note ? `<tr><td style="padding-top:22px;border-top:1px solid ${C.line};font:13px/1.6 ${SANS};color:${C.ink2}">${o.note}</td></tr>` : "";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>A Tavola</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 22px"><a href="${esc(base)}" style="text-decoration:none;color:${C.ink};font:700 18px ${SANS}"><img src="${esc(base)}/icon-96.png" width="30" height="30" alt="" style="vertical-align:middle;border-radius:8px;margin-right:10px">A Tavola</a></td></tr>
<tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:26px;padding:34px 30px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font:700 11px ${SANS};letter-spacing:.14em;color:${C.accent};padding-bottom:14px">${esc(o.eyebrow)}</td></tr>
<tr><td style="font:500 30px/1.12 ${SERIF};letter-spacing:-.02em;color:${C.ink};padding-bottom:16px">${o.title}</td></tr>
<tr><td style="font:16px/1.6 ${SANS};color:${C.ink};padding-bottom:18px">${o.body}</td></tr>
${cta}${note}
</table></td></tr>
<tr><td style="padding:22px 4px 0;font:12px/1.6 ${SANS};color:${C.ink2}">A Tavola · La settimana, servita.<br><a href="${esc(base)}/privacy" style="color:${C.ink2}">Privacy</a> · <a href="${esc(base)}/terms" style="color:${C.ink2}">Termini</a></td></tr>
</table></td></tr></table></body></html>`;
}

function baseOf(env: Env, base?: string): string {
  return base || env.BETTER_AUTH_URL || DEFAULT_URL;
}

export async function sendLoginCode(env: Env, email: string, otp: string, base?: string): Promise<void> {
  if (!env.RESEND_API_KEY && devMode(env)) {
    devOutbox.set(email.toLowerCase(), otp);
    console.log(`[A Tavola] Codice di accesso per ${email}: ${otp}`);
    return;
  }
  await send(env, {
    to: email,
    subject: `${otp} è il tuo codice A Tavola`,
    text: `Ciao!\n\nIl tuo codice di accesso è ${otp}.\nScade tra 10 minuti.\n\nSe non hai richiesto tu l'accesso, ignora questa email.\n\nA Tavola · La settimana, servita.`,
    html: layout({
      base: baseOf(env, base),
      preheader: `Il tuo codice è ${otp}. Scade tra 10 minuti.`,
      eyebrow: "IL TUO CODICE",
      title: "Eccolo,<br>appena servito.",
      body: `Inseriscilo nell'app per entrare:<div style="margin:20px 0 6px;padding:18px;background:${C.soft};border-radius:18px;text-align:center;font:600 34px ${SANS};letter-spacing:10px;color:${C.accent}">${esc(otp)}</div><span style="font-size:14px;color:${C.ink2}">Scade tra 10 minuti.</span>`,
      note: "Se non hai richiesto tu l'accesso, ignora questa email: nessuno può entrare senza questo codice.",
    }),
  });
}

/** All'admin: una nuova persona chiede di entrare. */
export async function sendAccessRequest(env: Env, adminEmail: string, who: { name: string; email: string }, link: string): Promise<void> {
  const name = who.name.trim() || "(nome non indicato)";
  await send(env, {
    to: adminEmail,
    subject: `Nuova richiesta di accesso: ${who.email}`,
    text: `${name} <${who.email}> ha chiesto di usare A Tavola.\n\nApprova o rifiuta qui: ${link}`,
    html: layout({
      base: new URL(link).origin,
      preheader: `${name} ha chiesto di usare A Tavola.`,
      eyebrow: "NUOVA RICHIESTA",
      title: "Qualcuno chiede<br>un posto a tavola.",
      body: `<div style="padding:16px 18px;background:${C.soft};border-radius:18px"><strong>${esc(name)}</strong><br><span style="color:${C.ink2}">${esc(who.email)}</span></div>`,
      cta: { label: "Approva o rifiuta", href: link },
      note: "Finché non approvi, questa persona vede solo la pagina di attesa e non può usare l'AI.",
    }),
  });
}

/** All'utente approvato. */
export async function sendAccessGranted(env: Env, email: string, appUrl: string): Promise<void> {
  await send(env, {
    to: email,
    subject: "Il tuo accesso ad A Tavola è attivo",
    text: `Ciao!\n\nIl tuo accesso ad A Tavola è attivo: entra da ${appUrl} con la stessa email.\n\nBuon appetito!`,
    html: layout({
      base: appUrl,
      preheader: "La tavola è apparecchiata: puoi entrare.",
      eyebrow: "ACCESSO ATTIVO",
      title: "La tavola<br>è apparecchiata.",
      body: "Il tuo accesso è attivo. Entra con la stessa email o lo stesso account Google che hai usato per la richiesta, e prepara il primo menù della settimana.",
      cta: { label: "Entra in A Tavola", href: appUrl },
      note: "Buon appetito!",
    }),
  });
}

/** All'admin: raggiunto il tetto giornaliero di operazioni AI per tutta l'app. */
export async function sendGlobalCapReached(env: Env, adminEmail: string, day: string, limit: number): Promise<void> {
  const base = baseOf(env);
  await send(env, {
    to: adminEmail,
    subject: `A Tavola: raggiunto il tetto AI di oggi (${limit})`,
    text: `Oggi (${day}) A Tavola ha raggiunto ${limit} operazioni AI. Le funzioni AI restano in pausa per tutti fino a mezzanotte (ora italiana); tu come admin puoi continuare.\n\nPer cambiare il tetto: variabile AI_LIMIT_GLOBAL_DAY in wrangler.jsonc.`,
    html: layout({
      base,
      preheader: `Raggiunte ${limit} operazioni AI oggi.`,
      eyebrow: "AVVISO CONSUMO AI",
      title: "Per oggi la cucina<br>AI chiude.",
      body: `Oggi (${esc(day)}) A Tavola ha raggiunto <strong>${limit}</strong> operazioni AI. Le funzioni AI restano in pausa per tutti fino a mezzanotte (ora italiana); tu come admin puoi continuare.`,
      cta: { label: "Vedi il consumo", href: `${base}/admin/accessi` },
      note: "Per cambiare il tetto: variabile <code>AI_LIMIT_GLOBAL_DAY</code> in wrangler.jsonc.",
    }),
  });
}
