import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { ShoppingView, ShoppingItem, WeekView } from "../../shared/types";
import { AISLE_ORDER } from "../../domain/shopping";
import { api } from "../api";
import { ErrorBox, formatDay, Loading, Sheet, useLoad } from "../ui";

export function Shopping() {
  const current = useLoad<{ week: WeekView | null }>("/api/weeks/current");
  const history = useLoad<{ weeks: { id: string; start_date: string }[] }>("/api/weeks");
  const [selected, setSelected] = useState("");
  const id = selected || current.data?.week?.id;
  const { data, setData, loading, error: loadError, reload } = useLoad<ShoppingView>(id ? `/api/shopping/${id}` : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!id || busy) return;
    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const fresh = await api<ShoppingView>("GET", `/api/shopping/${id}`);
        if (active) { setData(fresh); setError(null); }
      } catch { if (active) setError("Sincronizzazione interrotta. Riprovo automaticamente."); }
      finally { inFlight = false; }
    };
    const timer = setInterval(() => void poll(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id, busy, setData]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function toggle(item: ShoppingItem) {
    if (!data || busy) return;
    const previous = data;
    setData({ ...data, items: data.items.map((i) => i.id === item.id ? { ...i, checked: !i.checked } : i) });
    setBusy(true); setError(null);
    try { await api("PATCH", `/api/shopping/${id}/items/${item.id}`, { checked: !item.checked }); }
    catch (e) { setData(previous); setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (current.loading || (loading && !data) || (id && data?.week_id !== id && !loadError)) return <Loading />;
  const checked = data?.items.filter((i) => i.checked).length ?? 0;
  const now = data?.items.filter((i) => i.buy_on <= data.start_date) ?? [];
  const later = data?.items.filter((i) => i.buy_on > data.start_date) ?? [];
  const grouped = (items: ShoppingItem[]) => [...new Set(items.map((i) => i.aisle))].sort((a, b) => {
    const rank = (aisle: string) => AISLE_ORDER.includes(aisle) ? AISLE_ORDER.indexOf(aisle) : 99;
    return rank(a) - rank(b);
  }).map((aisle) => <section className="section" key={aisle}><h2>{aisle}</h2><div className="card">
    {items.filter((i) => i.aisle === aisle).map((i) => <div key={i.id} className={`shop-item ${i.checked ? "checked" : ""}`}>
      <label className="row grow">
        <input type="checkbox" checked={i.checked} disabled={busy || (data?.status === "shopped" && i.checked)} onChange={() => void toggle(i)} />
        <span><span className="name">{i.ingredient}</span><span className="qty"> · {i.unit_label}</span>
          {i.frozen_hint && <small className="shopping-hint">Oppure surgelato</small>}
          {i.manual && <small className="shopping-hint">Aggiunto da te</small>}
        </span>
      </label>
      {i.manual && data?.status === "draft" && <button className="btn-ghost btn-small" disabled={busy} aria-label={`Rimuovi ${i.ingredient}`} onClick={() => void act(() => api("DELETE", `/api/shopping/${id}/items/${i.id}`))}>✕</button>}
    </div>)}
  </div></section>);
  return <>
    <div className="page-head"><div><p className="eyebrow">DAL MENÙ AL CARRELLO</p><h1>La spesa</h1><p className="muted">Tutto quello che serve, nelle giuste quantità.</p></div>
      {data?.status === "draft" && <button className="btn-small" onClick={() => setAdding(true)}>+ Aggiungi</button>}</div>
    {!!history.data?.weeks.length && <label className="field">Settimana della spesa<select value={id ?? ""} onChange={(e) => setSelected(e.target.value)}>{history.data.weeks.map((w) => <option key={w.id} value={w.id}>Da {formatDay(w.start_date)}</option>)}</select></label>}
    <ErrorBox error={error || loadError || current.error} />
    {!data && !current.error && <div className="empty-state"><h2>La lista nasce dal tuo menù.</h2><p className="muted">Prepara la settimana: accorperemo gli ingredienti e le porzioni per tutta la famiglia.</p><Link className="btn btn-primary" to="/">Prepara il menù</Link></div>}
    {data && <>
      <div className="shopping-progress card"><div className="row between"><strong>{checked} di {data.items.length} nel carrello</strong><span className="pill">{data.status === "shopped" ? "Spesa registrata" : "Lista condivisa"}</span></div><progress value={checked} max={data.items.length || 1} aria-label="Avanzamento della spesa" /></div>
      {data.status === "shopped" && <p className="notice">Lista confermata. Gli acquisti sono in dispensa. Puoi spuntare anche ciò che compri nei prossimi giorni.</p>}
      {!data.items.length && <p className="empty-state muted">Nessun ingrediente: aggiungi un piatto al menù o una voce alla lista.</p>}
      {grouped(now)}
      {later.length > 0 && <section className="later-section"><p className="eyebrow">PER AVERLI PIÙ FRESCHI</p><h2>Da comprare dopo</h2><p className="muted">Questi ingredienti non durerebbero fino al giorno del pasto.</p>
        {[...new Set(later.map((i) => i.buy_on))].map((day) => <div key={day}><h3 className="buy-date">{formatDay(day)}</h3>{grouped(later.filter((i) => i.buy_on === day))}</div>)}
      </section>}
      {data.status === "draft" && data.items.length > 0 && <button className="btn-primary btn-block" disabled={busy || !checked} onClick={() => setConfirm(true)}>Spesa fatta · {checked} acquisti</button>}
    </>}
    {adding && id && <AddItem weekId={id} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await reload(); }} />}
    {confirm && <Sheet title="La spesa è fatta?" onClose={() => setConfirm(false)}><p>Salviamo i {checked} ingredienti spuntati in dispensa. La lista conserverà queste quantità anche se cambierai il menù.</p><ErrorBox error={error} /><button className="btn-primary btn-block" disabled={busy} onClick={() => void act(async () => { await api("POST", `/api/shopping/${id}/complete`); setConfirm(false); })}>{busy ? "Salvataggio…" : "Conferma gli acquisti"}</button></Sheet>}
  </>;
}

function AddItem({ weekId, onDone, onClose }: { weekId: string; onDone: () => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(""); const [grams, setGrams] = useState("100"); const [aisle, setAisle] = useState("Altro");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("POST", `/api/shopping/${weekId}/items`, { ingredient: name, grams: Number(grams), aisle }); await onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Sheet title="Aggiungi alla spesa" onClose={onClose}><form onSubmit={submit} className="stack">
    <label className="field">Ingrediente<input required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. caffè" /></label>
    <label className="field">Quantità in grammi<input required type="number" min="1" max="100000" step="0.1" value={grams} onChange={(e) => setGrams(e.target.value)} /></label>
    <label className="field">Reparto<select value={aisle} onChange={(e) => setAisle(e.target.value)}>{AISLE_ORDER.map((a) => <option key={a}>{a}</option>)}</select></label>
    <ErrorBox error={error} /><button className="btn-primary" disabled={busy}>{busy ? "Aggiungo…" : "Aggiungi alla lista"}</button>
  </form></Sheet>;
}
