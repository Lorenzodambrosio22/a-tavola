import { useState } from "react";
import type { MeResponse } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, useMe } from "../ui";
import { ConstraintEditor } from "./ConstraintEditor";
import { TastePicker } from "../TastePicker";

export function Onboarding() {
  const { me, setMe } = useMe();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(me.user.name);
  const [breakfast, setBreakfast] = useState(me.user.breakfast);
  const [tastes, setTastes] = useState(me.user.taste_dishes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(tasteDishes = tastes) {
    setBusy(true);
    setError(null);
    try {
      setMe(await api<MeResponse>("PATCH", "/api/me", { name: name.trim(), breakfast, taste_dishes: tasteDishes }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <div className="page-head">
        <div>
          <h1>Benvenuto!</h1>
          <p className="muted">{step === 1 ? "Facciamo conoscenza" : step === 2 ? "Le tue esigenze a tavola" : "I tuoi gusti"}</p>
        </div>
      </div>
      {step === 1 ? (
        <div className="card stack">
          <div className="field">
            <label htmlFor="name">Come ti chiami?</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
          </div>
          <label className="check" htmlFor="breakfast">
            <input id="breakfast" type="checkbox" checked={breakfast} onChange={(e) => setBreakfast(e.target.checked)} aria-describedby="breakfast-help" />
            Voglio anche la colazione nel menù
          </label>
          <p className="muted" id="breakfast-help">Puoi cambiare questa scelta in qualsiasi momento dal profilo.</p>
          <button className="btn-primary btn-block" disabled={!name.trim()} onClick={() => setStep(2)}>
            Avanti
          </button>
        </div>
      ) : step === 2 ? (
        <div className="card stack">
          <h2>Allergie e cose che non mangi</h2>
          <p className="muted">
            Le allergie valgono per tutti i pasti a cui sei presente: nessun piatto proposto le conterrà. Potrai aggiungere preferenze più avanti dal profilo.
          </p>
          <ConstraintEditor levels={["allergy", "never"]} />
          <div className="row between">
            <button className="btn-ghost" onClick={() => setStep(1)}>
              Indietro
            </button>
            <button className="btn-primary" onClick={() => setStep(3)}>
              Avanti
            </button>
          </div>
        </div>
      ) : (
        <div className="card stack">
          <div className="row between">
            <div><p className="eyebrow">UN ASSAGGIO DI TE · FACOLTATIVO</p><h2>Che piatti ti piacciono?</h2></div>
            <button className="btn-ghost" disabled={busy} onClick={() => void finish([])}>Salta per ora</button>
          </div>
          <TastePicker selected={tastes} onChange={setTastes} disabled={busy} />
          <ErrorBox error={error} />
          <div className="taste-actions row between">
            <button className="btn-ghost" disabled={busy} onClick={() => setStep(2)}>Indietro</button>
            <button className="btn-primary" disabled={busy} onClick={() => void finish()}>{busy ? "Salvataggio…" : "Inizia"}</button>
          </div>
        </div>
      )}
    </main>
  );
}
