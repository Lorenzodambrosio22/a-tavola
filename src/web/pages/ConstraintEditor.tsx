import { useState, type FormEvent } from "react";
import type { ConstraintLevel, FoodConstraint } from "../../shared/types";
import { LEVEL_LABEL } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, useLoad } from "../ui";

export const COMMON_ALLERGENS = [
  "glutine",
  "latte",
  "uova",
  "frutta a guscio",
  "arachidi",
  "pesce",
  "crostacei",
  "molluschi",
  "soia",
  "sedano",
  "senape",
  "sesamo",
  "solfiti",
  "lupini",
];

const LEVEL_HELP: Record<ConstraintLevel, string> = {
  allergy: "mai nei pasti a cui sei presente",
  never: "non lo mangi mai",
  little: "va bene, ma poco",
  dislike: "meglio evitarlo",
};

export function ConstraintEditor({ levels = ["allergy", "never", "little", "dislike"] as ConstraintLevel[] }) {
  const { data, reload, error } = useLoad<{ constraints: FoodConstraint[] }>("/api/constraints");
  const [ingredient, setIngredient] = useState("");
  const [level, setLevel] = useState<ConstraintLevel>(levels[0]);
  const [err, setErr] = useState<string | null>(null);

  async function add(name: string, lv: ConstraintLevel) {
    setErr(null);
    try {
      await api("POST", "/api/constraints", { ingredient: name, level: lv });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ingredient.trim()) return;
    await add(ingredient, level);
    setIngredient("");
  }

  async function remove(id: string) {
    await api("DELETE", `/api/constraints/${id}`);
    await reload();
  }

  const list = data?.constraints ?? [];
  const has = new Set(list.map((c) => c.ingredient));

  return (
    <div className="stack">
      {levels.map((lv) => {
        const items = list.filter((c) => c.level === lv);
        return (
          <div key={lv}>
            <h3>
              {LEVEL_LABEL[lv]} <small className="muted">— {LEVEL_HELP[lv]}</small>
            </h3>
            {items.length === 0 ? (
              <p className="muted">Nessuno.</p>
            ) : (
              <div className="row">
                {items.map((c) => (
                  <span key={c.id} className={`chip ${c.level}`}>
                    {c.ingredient}
                    {c.source === "learned" && <small>(imparato)</small>}
                    <button onClick={() => void remove(c.id)} aria-label={`Rimuovi ${c.ingredient}`}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {levels.includes("allergy") && (
        <div>
          <label>Allergeni comuni</label>
          <div className="row">
            {COMMON_ALLERGENS.filter((a) => !has.has(a)).map((a) => (
              <button key={a} type="button" className="btn-small" onClick={() => void add(a, "allergy")}>
                + {a}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="row">
        <input className="grow" placeholder="Ingrediente (es. funghi)" value={ingredient} onChange={(e) => setIngredient(e.target.value)} aria-label="Ingrediente" style={{ flexBasis: 180 }} />
        <select value={level} onChange={(e) => setLevel(e.target.value as ConstraintLevel)} aria-label="Livello" style={{ width: "auto" }}>
          {levels.map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
        <button className="btn-primary" disabled={!ingredient.trim()}>
          Aggiungi
        </button>
      </form>
      <ErrorBox error={err || error} />
    </div>
  );
}
