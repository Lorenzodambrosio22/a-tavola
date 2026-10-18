import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { api } from "../api";
import { ErrorBox, Loading, useLoad, useMe } from "../ui";

interface AdminUser { id: string; name: string; email: string; access: "pending" | "approved" | "rejected"; createdAt: string }
interface UsageRow { user_id: string; email: string; name: string; calls: number; input_tokens: number; output_tokens: number }
interface Usage { day: string; limits: { user: number; global: number }; total: number; users: UsageRow[] }

const LABEL = { pending: "IN ATTESA", approved: "ATTIVO", rejected: "RIFIUTATO" };

export function Access() {
  const { me } = useMe();
  const [params] = useSearchParams();
  const focus = params.get("utente");
  const users = useLoad<{ users: AdminUser[] }>(me.isAdmin ? "/api/admin/users" : null);
  const usage = useLoad<Usage>(me.isAdmin ? "/api/admin/usage" : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!me.isAdmin) return <Navigate to="/" replace />;

  async function decide(u: AdminUser, decision: "approve" | "reject") {
    setBusy(u.id); setError(null); setNotice(null);
    try {
      const res = await api<{ email_sent: boolean }>("POST", `/api/admin/users/${encodeURIComponent(u.id)}/${decision}`);
      if (decision === "approve") setNotice(res.email_sent ? `${u.email} è attivo: gli abbiamo scritto.` : `${u.email} è attivo, ma l'email non è partita: avvisalo tu.`);
      await users.reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  const list = users.data?.users ?? [];
  const pending = list.filter((u) => u.access === "pending");
  const others = list.filter((u) => u.access !== "pending");
  const row = (u: AdminUser) => (
    <li key={u.id} className={`row between access-row${u.id === focus ? " highlight" : ""}`}>
      <div className="grow">
        <strong>{u.name || u.email}</strong> <span className={`badge-access ${u.access}`}>{LABEL[u.access]}</span>
        <small className="block">{u.email} · dal {new Date(u.createdAt).toLocaleDateString("it-IT")}</small>
      </div>
      <div className="row">
        {u.access !== "approved" && <button className="btn-small btn-primary" disabled={busy === u.id} onClick={() => void decide(u, "approve")}>Approva</button>}
        {u.access !== "rejected" && u.email.toLowerCase() !== me.user.email.toLowerCase() && <button className="btn-small" disabled={busy === u.id} onClick={() => void decide(u, "reject")}>{u.access === "approved" ? "Blocca" : "Rifiuta"}</button>}
      </div>
    </li>
  );

  const u = usage.data;
  return <>
    <div className="page-head"><div><p className="eyebrow">AMMINISTRAZIONE</p><h1>Accessi e consumo AI</h1><p className="muted">Chi entra nell'app e quante operazioni AI si usano oggi.</p></div></div>
    <ErrorBox error={error ?? users.error ?? usage.error} />
    {notice && <p className="card">{notice}</p>}
    {users.loading && !users.data && <Loading />}
    {users.data && <>
      <section className="section"><h2>Richieste in attesa</h2>
        {pending.length ? <div className="card"><ul className="list">{pending.map(row)}</ul></div> : <p className="muted">Nessuna richiesta da approvare.</p>}
      </section>
      <section className="section"><h2>Tutti gli account</h2><div className="card"><ul className="list">{others.map(row)}</ul></div></section>
    </>}
    {u && <section className="section"><h2>Consumo AI di oggi</h2><div className="card">
      <p><strong>{u.total}</strong> operazioni su un tetto di {u.limits.global} · {u.limits.user} a testa al giorno (tu non hai limiti).</p>
      {u.users.length ? <ul className="list">{u.users.map((r) => <li key={r.user_id} className="row between"><span className="grow">{r.name || r.email}</span><small>{r.calls} op · {Math.round((r.input_tokens + r.output_tokens) / 1000)}k token</small></li>)}</ul> : <p className="muted">Ancora nessuna operazione oggi.</p>}
    </div></section>}
  </>;
}
