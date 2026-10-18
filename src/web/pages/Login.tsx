import { useEffect, useState, type FormEvent } from "react";
import { auth } from "../api";
import { ErrorBox } from "../ui";
import { Brand } from "../Brand";

export function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    new URLSearchParams(window.location.search).has("login") ? "Accesso con Google non riuscito. Riprova." : null,
  );
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    auth.options().then((o) => setGoogle(o.google), () => {});
  }, []);

  async function withGoogle() {
    setBusy(true);
    setError(null);
    try {
      await auth.google();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.sendCode(email.trim());
      setStep("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.verify(email.trim(), otp.trim());
      await onDone();
    } catch {
      setError("Codice non valido o scaduto. Controlla e riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-story" aria-label="Benvenuto in A Tavola">
        <a className="login-brand" href="/"><Brand /></a>
        <div><p className="eyebrow">LA SETTIMANA, SERVITA.</p><h1>Meno «cosa<br />mangiamo?».<br /><em>Più tempo<br />a tavola.</em></h1><p>Un menù che conosce la tua famiglia.<br />Una spesa pensata per tutta la settimana.</p></div>
        <div className="login-features"><span>Un menù su misura</span><span>La spesa, già pronta</span><span>Meno sprechi in cucina</span></div>
      </section>
      <div className="card stack">
        <div className="login-mobile-brand"><Brand /></div>
        <div>
          <p className="eyebrow">BENVENUTO A CASA</p>
          <h2>Facciamo spazio<br />alle cose buone.</h2>
          <p className="muted">{google ? "Accedi o crea il tuo account con Google, oppure con un codice via email." : "Accedi o crea il tuo account con un codice via email."}</p>
        </div>
        {google && step === "email" && (
          <>
            <button type="button" className="btn-google btn-block" disabled={busy} onClick={() => void withGoogle()}>
              <GoogleLogo />
              Continua con Google
            </button>
            <p className="login-divider">oppure</p>
          </>
        )}
        {step === "email" ? (
          <form onSubmit={send} className="stack">
            <div className="field">
              <label htmlFor="email">La tua email</label>
              <input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@esempio.it" />
            </div>
            <ErrorBox error={error} />
            <button className="btn-primary btn-block" disabled={busy || !email}>
              {busy ? "Invio…" : "Ricevi il codice"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="stack">
            <p>
              Abbiamo inviato un codice a <strong>{email}</strong>.
            </p>
            <div className="field">
              <label htmlFor="otp">Codice di 6 cifre</label>
              <input id="otp" className="otp" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
            </div>
            <ErrorBox error={error} />
            <button className="btn-primary btn-block" disabled={busy || otp.length < 6}>
              {busy ? "Verifica…" : "Entra"}
            </button>
            <button type="button" className="btn-ghost btn-block" onClick={() => setStep("email")}>
              Cambia email o richiedi un nuovo codice
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Logo "G" a colori, come chiedono le linee guida di Google per il pulsante di accesso. */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
