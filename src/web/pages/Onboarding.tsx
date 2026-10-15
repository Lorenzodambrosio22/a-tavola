import { useState } from "react";
import type { MeResponse } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, useMe } from "../ui";
import { ConstraintEditor } from "./ConstraintEditor";

export function Onboarding() {
  const { me, setMe } = useMe();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(me.user.name);
  const [breakfast, setBreakfast] = useState(me.user.breakfast);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    try {
      setMe(await api<MeResponse>("PATCH", "/api/me", { name: name.trim(), breakfast }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="app">
      <div className="page-head">
        <div>
          <h1>Benvenuto!</h1>
          <p className="muted">Passo {step} di 2</p>
        </div>
      </div>
      {step === 1 ? (
        <div className="card stack">
          <div className="field">
            <label htmlFor="name">Come ti chiami?</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
          </div>
          <label className="check">
            <input type="checkbox" checked={breakfast} onChange={(e) => setBreakfast(e.target.checked)} />
            Voglio anche la colazione nel menù
          </label>
          <button className="btn-primary btn-block" disabled={!name.trim()} onClick={() => setStep(2)}>
            Avanti
          </button>
        </div>
      ) : (
        <div className="card stack">
          <h2>Allergie e cose che non mangi</h2>
          <p className="muted">
            Le allergie valgono per tutti i pasti a cui sei presente: nessun piatto proposto le conterrà. Potrai aggiungere preferenze più avanti dal profilo.
          </p>
          <ConstraintEditor levels={["allergy", "never"]} />
          <ErrorBox error={error} />
          <div className="row between">
            <button className="btn-ghost" onClick={() => setStep(1)}>
              Indietro
            </button>
            <button className="btn-primary" onClick={() => void finish()}>
              Inizia
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
