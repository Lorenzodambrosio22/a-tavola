import { useState, type FormEvent } from "react";
import { auth } from "../api";
import { ErrorBox } from "../ui";

export function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <section className="login-story" aria-label="Benvenuto in App Cibo">
        <a className="login-brand" href="/"><span className="brand-mark">c.</span> app cibo</a>
        <div><p className="eyebrow">LA SETTIMANA, SERVITA.</p><h1>Meno «cosa<br />mangiamo?».<br /><em>Più tempo<br />a tavola.</em></h1><p>Un menù che conosce la tua famiglia.<br />Una spesa pensata per tutta la settimana.</p></div>
        <div className="login-features"><span>01 · Un menù su misura</span><span>02 · La spesa, già pronta</span><span>03 · Meno sprechi in cucina</span></div>
      </section>
      <div className="card stack">
        <div>
          <p className="eyebrow">BENVENUTO A CASA</p>
          <h2>Facciamo spazio<br />alle cose buone.</h2>
          <p className="muted">Accedi o crea il tuo account con un codice via email.</p>
        </div>
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
              <input id="otp" className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
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
