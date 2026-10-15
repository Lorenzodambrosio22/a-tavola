import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { MeResponse } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, Loading, useLoad, useMe } from "../ui";

export function Invite() {
  const { token = "" } = useParams();
  const { me, setMe } = useMe();
  const nav = useNavigate();
  const { data, error } = useLoad<{ household_name: string; valid: boolean }>(`/api/household/invites/${encodeURIComponent(token)}`);
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    try {
      setMe(await api<MeResponse>("POST", "/api/household/join", { token }));
      nav("/famiglia");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="card stack">
      <h1>Invito</h1>
      {data.valid ? (
        <>
          <p>
            Sei stato invitato in <strong>{data.household_name}</strong>.
          </p>
          {me.members.length > 1 && <p className="muted">Lascerai il nucleo «{me.household.name}».</p>}
          <p className="muted">Le tue preferenze restano tue; le ricette del tuo nucleo personale verranno portate nel nuovo.</p>
          <button className="btn-primary btn-block" onClick={() => void accept()}>
            Accetta e unisciti
          </button>
        </>
      ) : (
        <p>Questo invito è scaduto o è già stato usato. Chiedine uno nuovo.</p>
      )}
      <ErrorBox error={err} />
    </div>
  );
}
