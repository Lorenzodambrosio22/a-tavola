import { useEffect, useState } from "react";
import type { MeResponse } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, useMe } from "../ui";

export function Family() {
  const { me, setMe, refresh } = useMe();
  const [invite, setInvite] = useState<{ url: string; expires_at: string; max_uses: number } | null>(null);
  const [people, setPeople] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const owner = me.household.role === "owner";

  // Chi ha appena accettato un invito deve comparire senza ricaricare l'app
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createInvite() {
    setError(null);
    setCopied(false);
    try {
      setInvite(await api("POST", "/api/household/invites", { max_uses: people }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function share() {
    if (!invite) return;
    const text = `Unisciti alla nostra famiglia su A Tavola: ${invite.url}`;
    if (navigator.share) {
      await navigator.share({ title: "Invito A Tavola", text, url: invite.url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    }
  }

  async function leave() {
    if (!confirm("Vuoi uscire da questo nucleo? Tornerai in un nucleo personale.")) return;
    try {
      setMe(await api<MeResponse>("POST", "/api/household/leave"));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Famiglia</h1>
          <p className="muted">{me.household.name}</p>
        </div>
      </div>
      <div className="card">
        <ul className="list">
          {me.members.map((m) => (
            <li key={m.id} className="row between">
              <div>
                <strong>{m.name || m.email}</strong>
                {m.id === me.user.id && <small className="muted"> (tu)</small>}
                <br />
                <small className="muted">
                  {m.role === "owner" ? "Proprietario" : "Membro"} · {m.breakfast ? "fa colazione" : "niente colazione"}
                </small>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {owner && (
        <div className="card stack">
          <h2>Invita qualcuno</h2>
          <p className="muted">Il link vale 7 giorni per il numero di persone che scegli. Chi accetta lascia il proprio nucleo e porta con sé le sue ricette.</p>
          <div className="field">
            <label htmlFor="invite-people">Quante persone vuoi invitare?</label>
            <select id="invite-people" value={people} onChange={(e) => {
              setPeople(Number(e.target.value));
              setInvite(null);
            }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 persona" : `${n} persone`}
                </option>
              ))}
            </select>
          </div>
          {invite ? (
            <>
              <p className="muted">
                Questo link vale per {invite.max_uses === 1 ? "1 persona" : `${invite.max_uses} persone`}.
              </p>
              <input readOnly value={invite.url} onFocus={(e) => e.target.select()} aria-label="Link di invito" />
              <button className="btn-primary btn-block" onClick={() => void share()}>
                {copied ? "Copiato!" : "Condividi il link"}
              </button>
              <button className="btn-ghost btn-block" onClick={() => void createInvite()}>
                Crea un altro link
              </button>
            </>
          ) : (
            <button className="btn-primary btn-block" onClick={() => void createInvite()}>
              Crea link di invito
            </button>
          )}
        </div>
      )}

      {me.members.length > 1 && (
        <div className="section">
          <button className="btn-ghost btn-danger" onClick={() => void leave()}>
            Esci dal nucleo
          </button>
        </div>
      )}
      <ErrorBox error={error} />
    </>
  );
}
