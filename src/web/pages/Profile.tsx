import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { FoodConstraint, MeResponse, RecurringAbsence, Slot } from "../../shared/types";
import { LEVEL_LABEL, SLOT_LABEL } from "../../shared/types";
import { api, auth } from "../api";
import { DAY_SHORT, ErrorBox, useLoad, useMe } from "../ui";
import { ConstraintEditor } from "./ConstraintEditor";

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function Profile() {
  const { me, setMe } = useMe();
  const [name, setName] = useState(me.user.name);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { name?: string; breakfast?: boolean }) {
    try {
      setMe(await api<MeResponse>("PATCH", "/api/me", patch));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function logout() {
    await auth.signOut().catch(() => {});
    location.href = "/";
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profilo</h1>
          <p className="muted">{me.user.email}</p>
        </div>
        <Link to="/famiglia" className="btn btn-small">
          Famiglia
        </Link>
      </div>

      <div className="card stack">
        <div className="field">
          <label htmlFor="pname">Nome</label>
          <div className="row">
            <input id="pname" className="grow" value={name} onChange={(e) => setName(e.target.value)} />
            <button disabled={!name.trim() || name === me.user.name} onClick={() => void save({ name: name.trim() })}>
              Salva
            </button>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={me.user.breakfast} onChange={(e) => void save({ breakfast: e.target.checked })} />
          Faccio colazione (compare nel menù)
        </label>
        <ErrorBox error={error} />
      </div>

      <section className="section">
        <h2>I miei vincoli</h2>
        <div className="card">
          <ConstraintEditor />
        </div>
      </section>

      <Learned />

      <RecurringAbsences breakfast={me.user.breakfast} />

      <section className="section stack">
        {me.isAdmin && (
          <Link to="/admin/ingredienti" className="btn btn-block">Ingredienti di riferimento</Link>
        )}
        {me.isAdmin && (
          <Link to="/admin/confronto" className="btn btn-block">
            Confronto provider AI
          </Link>
        )}
        <button className="btn-ghost btn-block" onClick={() => void logout()}>
          Esci
        </button>
      </section>
    </>
  );
}

function Learned() {
  const { data, reload } = useLoad<{ learned: FoodConstraint[]; blocked: { dish_family: string }[] }>("/api/learned");
  if (!data || (data.learned.length === 0 && data.blocked.length === 0)) return null;

  async function del(c: FoodConstraint) {
    await api("DELETE", `/api/constraints/${c.id}`);
    await reload();
  }
  async function promote(c: FoodConstraint) {
    await api("PATCH", `/api/constraints/${c.id}`, { level: "never" });
    await reload();
  }
  async function unblock(f: string) {
    await api("DELETE", `/api/blocked/${encodeURIComponent(f)}`);
    await reload();
  }

  return (
    <section className="section">
      <h2>Cose che ho imparato su di te</h2>
      <div className="card">
        <ul className="list">
          {data.learned.map((c) => (
            <li key={c.id} className="row between">
              <span>
                {c.ingredient} <small className="muted">· {LEVEL_LABEL[c.level]}</small>
              </span>
              <span className="row">
                {c.level === "dislike" && (
                  <button className="btn-small" onClick={() => void promote(c)}>
                    Mai
                  </button>
                )}
                <button className="btn-small btn-ghost" onClick={() => void del(c)} aria-label={`Dimentica ${c.ingredient}`}>
                  Dimentica
                </button>
              </span>
            </li>
          ))}
          {data.blocked.map((b) => (
            <li key={b.dish_family} className="row between">
              <span>
                Niente «{b.dish_family}» <small className="muted">· piatto bloccato</small>
              </span>
              <button className="btn-small btn-ghost" onClick={() => void unblock(b.dish_family)}>
                Sblocca
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RecurringAbsences({ breakfast }: { breakfast: boolean }) {
  const { data } = useLoad<{ absences: RecurringAbsence[] }>("/api/absences/recurring");
  const [set, setSet] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) setSet(new Set(data.absences.map((a) => `${a.weekday}:${a.slot}`)));
  }, [data]);
  const slots: Slot[] = breakfast ? ["breakfast", "lunch", "dinner"] : ["lunch", "dinner"];

  function toggle(k: string) {
    const n = new Set(set);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSet(n);
    setSaved(false);
  }

  async function save() {
    const absences = [...set].map((k) => {
      const [w, s] = k.split(":");
      return { weekday: Number(w), slot: s as Slot };
    });
    await api("PUT", "/api/absences/recurring", { absences });
    setSaved(true);
  }

  return (
    <section className="section">
      <h2>Assenze ricorrenti</h2>
      <div className="card stack">
        <p className="muted">Segna i pasti in cui di solito non ci sei (es. pranzo al lavoro). Valgono alla creazione di ogni settimana.</p>
        <table className="compare">
          <thead>
            <tr>
              <th />
              {WEEK_ORDER.map((d) => (
                <th key={d}>{DAY_SHORT[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s}>
                <td>{SLOT_LABEL[s]}</td>
                {WEEK_ORDER.map((d) => {
                  const k = `${d}:${s}`;
                  return (
                    <td key={k}>
                      <input type="checkbox" checked={set.has(k)} onChange={() => toggle(k)} aria-label={`Assente ${DAY_SHORT[d]} ${SLOT_LABEL[s]}`} style={{ width: 22, height: 22, minHeight: 0 }} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => void save()}>{saved ? "Salvato ✓" : "Salva assenze"}</button>
      </div>
    </section>
  );
}
