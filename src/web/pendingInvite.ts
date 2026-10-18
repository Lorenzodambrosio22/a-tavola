const KEY = "a-tavola:invito";

/** Salva il token se l'URL è un link d'invito: serve a non perderlo durante login, approvazione e onboarding. */
export function rememberInvite(): void {
  try {
    const m = location.pathname.match(/^\/invito\/([^/]+)/);
    if (m) localStorage.setItem(KEY, m[1]);
  } catch {
    // niente storage: l'invito andrà riaperto a mano
  }
}

export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // niente storage: nulla da dimenticare
  }
}
