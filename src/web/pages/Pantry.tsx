import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { PantryItem } from "../../shared/types";
import { formatQuantity } from "../../domain/shopping";
import { api } from "../api";
import { ErrorBox, formatDay, Loading, Sheet, useLoad } from "../ui";

interface PantryView { items: PantryItem[]; today: string; expiring: PantryItem[]; expired: PantryItem[] }

export function ExpiringSoon() {
  const { data } = useLoad<PantryView>("/api/pantry");
  if (!data?.expiring.length) return null;
  return <Link className="expiring-banner" to="/dispensa"><span>Da usare presto</span><strong>{data.expiring.slice(0, 3).map((i) => i.ingredient).join(", ")}</strong><span>Apri la dispensa →</span></Link>;
}

export function Pantry() {
  const { data, loading, error: loadError, reload } = useLoad<PantryView>("/api/pantry");
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function update(id: string, patch: { grams?: number; status?: string }) {
    setBusy(true); setError(null);
    try { await api("PATCH", `/api/pantry/${id}`, patch); await reload(); setEditing(null); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (loading && !data) return <Loading />;
  return <>
    <div className="page-head"><div><p className="eyebrow">MENO SPRECHI, PIÙ IDEE</p><h1>La dispensa</h1><p className="muted">Si riempie con la spesa, si aggiorna con i pasti.</p></div><Link className="btn btn-small" to="/spesa">Vai alla spesa</Link></div>
    <ErrorBox error={loadError || error} />
    {data && !data.items.length && <div className="empty-state"><h2>Qui c’è spazio per la tua prossima spesa.</h2><p className="muted">Spunta gli acquisti e conferma “Spesa fatta”: li ritroverai qui con una scadenza stimata.</p><Link className="btn btn-primary" to="/spesa">Apri la lista</Link></div>}
    {data && data.items.length > 0 && <>
      <div className="stats-strip"><div><strong>{data.items.length}</strong><span>ingredienti</span></div><div><strong>{data.expiring.length}</strong><span>da usare presto</span></div><div><strong>{data.expired.length}</strong><span>oltre la stima</span></div></div>
      <p className="muted">Le scadenze sono stime: controlla sempre la confezione. I pasti del giorno vengono scalati durante la notte.</p>
      {[{ label: "Da controllare", items: data.expired, warning: true }, { label: "Scade presto", items: data.expiring, warning: true }, { label: "In dispensa", items: data.items.filter((i) => !data.expired.some((e) => e.id === i.id) && !data.expiring.some((e) => e.id === i.id)), warning: false }].filter((g) => g.items.length).map((g) => <section className="section" key={g.label}><h2>{g.label}</h2><div className="card"><ul className="list">{g.items.map((i) => <li key={i.id}><div className="row between"><div><strong className="ingredient-name">{i.ingredient}</strong><p className="muted">{formatQuantity(i.ingredient, i.grams)} · <span className={g.warning ? "expiry-warning" : ""}>Scadenza stimata: {formatDay(i.expires_at)}</span></p></div><button className="btn-small" disabled={busy} onClick={() => setEditing(i)}>Correggi</button></div></li>)}</ul></div></section>)}
    </>}
    {editing && <PantryEdit item={editing} busy={busy} error={error} onClose={() => setEditing(null)} onUpdate={(patch) => update(editing.id, patch)} />}
  </>;
}

function PantryEdit({ item, busy, error, onClose, onUpdate }: { item: PantryItem; busy: boolean; error: string | null; onClose: () => void; onUpdate: (patch: { grams?: number; status?: string }) => Promise<void> }) {
  const [grams, setGrams] = useState(String(item.grams));
  function submit(e: FormEvent) { e.preventDefault(); void onUpdate({ grams: Number(grams) }); }
  return <Sheet title={item.ingredient} onClose={onClose}><form className="stack" onSubmit={submit}><label className="field">Ne ho ancora (grammi)<input type="number" min="0" max="100000" step="0.1" required value={grams} onChange={(e) => setGrams(e.target.value)} /></label><ErrorBox error={error} /><button className="btn-primary" disabled={busy}>Aggiorna quantità</button><div className="row"><button type="button" className="grow" disabled={busy} onClick={() => void onUpdate({ status: "used" })}>È finito</button><button type="button" className="grow" disabled={busy} onClick={() => void onUpdate({ status: "trashed" })}>L’ho buttato</button></div></form></Sheet>;
}
