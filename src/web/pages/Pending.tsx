import type { MeResponse } from "../../shared/types";
import { auth } from "../api";
import { Brand } from "../Brand";
import { LegalLinks } from "./Login";

/** Account registrato ma non ancora approvato (o non accolto). */
export function Pending({ me, onRefresh }: { me: MeResponse; onRefresh: () => Promise<void> }) {
  const rejected = me.access === "rejected";
  async function logout() {
    await auth.signOut().catch(() => {});
    location.href = "/";
  }
  return (
    <div className="login">
      <section className="login-story" aria-label="A Tavola">
        <a className="login-brand" href="/"><Brand /></a>
        <div><p className="eyebrow">LA SETTIMANA, SERVITA.</p><h1>Ancora un<br />momento,<br /><em>la tavola<br />si sta apparecchiando.</em></h1></div>
        <div className="login-features"><span>Accesso su richiesta</span><span>Ti avvisiamo via email</span></div>
      </section>
      <div className="card stack">
        <div className="login-mobile-brand"><Brand /></div>
        {rejected ? (
          <div>
            <p className="eyebrow">RICHIESTA NON ACCOLTA</p>
            <h2>Per ora non<br />c'è posto.</h2>
            <p className="muted">La richiesta per <strong>{me.user.email}</strong> non è stata accolta. Se pensi sia un errore, scrivici.</p>
          </div>
        ) : (
          <div>
            <p className="eyebrow">RICHIESTA INVIATA</p>
            <h2>Ti scriviamo<br />quando è attiva.</h2>
            <p className="muted">Abbiamo ricevuto la richiesta per <strong>{me.user.email}</strong>. Appena viene approvata ti arriva un'email e potrai entrare con lo stesso account.</p>
          </div>
        )}
        {!rejected && <button className="btn-primary btn-block" onClick={() => void onRefresh()}>Ho ricevuto l'email, entra</button>}
        <button className="btn-ghost btn-block" onClick={() => void logout()}>Esci</button>
        <LegalLinks />
      </div>
    </div>
  );
}
