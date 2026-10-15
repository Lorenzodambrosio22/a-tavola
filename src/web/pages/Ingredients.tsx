import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { api } from "../api";
import { ErrorBox, Loading, Sheet, useLoad, useMe } from "../ui";
import { AISLE_ORDER } from "../../domain/shopping";

interface IngredientRef { name: string; kcal_100g: number | null; shelf_days: number; aisle: string; freezer_ok: boolean | number }

export function Ingredients() {
  const { me } = useMe();
  const { data, loading, error, reload } = useLoad<{ ingredients: IngredientRef[] }>(me.isAdmin ? "/api/ingredients" : null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<IngredientRef | null>(null);
  if (!me.isAdmin) return <Navigate to="/" replace />;
  return <><div className="page-head"><div><p className="eyebrow">AMMINISTRAZIONE</p><h1>Ingredienti di riferimento</h1><p className="muted">Calorie, reparti e durate usati per spesa e dispensa.</p></div></div>
    <label className="field">Cerca ingrediente<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Es. salmone" /></label>
    <ErrorBox error={error} />{loading && !data && <Loading />}
    {data && <div className="card section"><ul className="list">{data.ingredients.filter((i) => i.name.includes(search.toLowerCase().trim())).map((i) => <li key={i.name} className="row between"><div className="grow"><strong>{i.name}</strong><small className="block">{i.kcal_100g ?? "?"} kcal/100 g · {i.shelf_days} giorni · {i.aisle}</small></div><button className="btn-small" onClick={() => setEditing(i)}>Modifica</button></li>)}</ul></div>}
    {editing && <EditIngredient item={editing} onClose={() => setEditing(null)} onDone={async () => { await reload(); setEditing(null); }} />}
  </>;
}

function EditIngredient({ item, onDone, onClose }: { item: IngredientRef; onDone: () => Promise<void>; onClose: () => void }) {
  const [kcal, setKcal] = useState(item.kcal_100g === null ? "" : String(item.kcal_100g));
  const [days, setDays] = useState(String(item.shelf_days));
  const [aisle, setAisle] = useState(item.aisle);
  const [freezer, setFreezer] = useState(!!item.freezer_ok);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("PATCH", `/api/admin/ingredients/${encodeURIComponent(item.name)}`, { kcal_100g: kcal === "" ? null : Number(kcal), shelf_days: Number(days), aisle, freezer_ok: freezer }); await onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Sheet title={item.name} onClose={onClose}><form className="stack" onSubmit={save}>
    <label className="field">Calorie per 100 g (vuoto se sconosciute)<input type="number" min="0" max="1000" step="0.1" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
    <label className="field">Durata stimata in giorni<input type="number" required min="0" max="3650" value={days} onChange={(e) => setDays(e.target.value)} /></label>
    <label className="field">Reparto<select value={aisle} onChange={(e) => setAisle(e.target.value)}>{AISLE_ORDER.map((a) => <option key={a}>{a}</option>)}</select></label>
    <label className="check"><input type="checkbox" checked={freezer} onChange={(e) => setFreezer(e.target.checked)} />Si può congelare</label>
    <ErrorBox error={error} /><button disabled={busy} className="btn-primary">{busy ? "Salvataggio…" : "Salva riferimento"}</button>
  </form></Sheet>;
}
