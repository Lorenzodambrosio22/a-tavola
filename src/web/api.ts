export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || (res.status >= 500 ? "Riprova tra poco" : "Richiesta non riuscita");
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const auth = {
  sendCode: (email: string) => api("POST", "/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" }),
  verify: (email: string, otp: string) => api("POST", "/api/auth/sign-in/email-otp", { email, otp }),
  options: () => api<{ google: boolean }>("GET", "/api/auth-options"),
  /** Avvia l'accesso con Google e torna alla pagina corrente (es. un link di invito). */
  async google() {
    const back = window.location.pathname + window.location.search;
    const res = await api<{ url?: string }>("POST", "/api/auth/sign-in/social", { provider: "google", callbackURL: back, errorCallbackURL: "/?login=errore" });
    if (res.url) window.location.href = res.url;
  },
  signOut: () => api("POST", "/api/auth/sign-out", {}),
};
