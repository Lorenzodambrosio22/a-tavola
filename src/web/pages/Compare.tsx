import { useState } from "react";
import { Navigate } from "react-router";
import { api } from "../api";
import { ErrorBox, todayISO, useMe } from "../ui";
import { SLOT_LABEL, type Slot } from "../../shared/types";

interface Result {
  provider: string; error: string | null; latency_ms: number; violations: number; missing: number;
  usage: { calls: number; input_tokens: number; output_tokens: number } | null;
  meals: { date: string; slot: Slot; title: string; minutes: number; violation_count: number }[];
}
export function Compare() {
  const { me } = useMe();
  const [date, setDate] = useState(todayISO());
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me.isAdmin) return <Navigate to="/" replace />;
  async function compare() {
    setBusy(true); setError(null);
    try { setResults((await api<{ results: Result[] }>("POST", "/api/admin/compare", { start_date: date })).results); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><div className="page-head"><div><p className="eyebrow">AMMINISTRAZIONE</p><h1>Due AI, lo stesso menù</h1><p className="muted">Confronta le proposte sugli stessi vincoli, senza modificare la settimana.</p></div></div>
    <div className="card stack"><label className="field">Inizio settimana<input type="date" value={date} required onChange={(e) => setDate(e.target.value)} /></label><ErrorBox error={error} /><button className="btn-primary" disabled={busy || !date} onClick={() => void compare()}>{busy ? "Confronto in corso…" : "Confronta Claude e Workers AI"}</button><small className="muted">Il confronto esegue chiamate reali ai provider configurati.</small></div>
    <div className="compare-grid section">{results.map((r) => <section className="card" key={r.provider}><h2>{r.provider === "claude" ? "Claude" : "Workers AI"}</h2>{r.error ? <ErrorBox error={r.error} /> : <>
      <div className="stats-strip"><div><strong>{(r.latency_ms / 1000).toFixed(1)} s</strong><span>latenza</span></div><div><strong>{r.violations}</strong><span>violazioni</span></div><div><strong>{r.missing}</strong><span>pasti mancanti</span></div></div>
      {r.usage && <p className="muted">{r.usage.input_tokens.toLocaleString("it-IT")} token in · {r.usage.output_tokens.toLocaleString("it-IT")} token out · {r.usage.calls} chiamate</p>}
      <ul className="list">{r.meals.map((m, i) => <li key={i}><small className="muted">{m.date} · {SLOT_LABEL[m.slot]}</small><strong className="block">{m.title}</strong><small>{m.minutes} min{m.violation_count > 0 && <span className="badge-warn">{m.violation_count} violazioni</span>}</small></li>)}</ul>
    </>}</section>)}</div>
  </>;
}
