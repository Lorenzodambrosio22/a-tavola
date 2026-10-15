import { useState } from "react";
import { Link } from "react-router";
import type { Ingredient, Recipe } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, Loading, Sheet, useLoad } from "../ui";

type Mode = "own" | "own_ai" | "own_known";

const MODE_LABEL: Record<Mode, { title: string; help: string }> = {
  own: { title: "La scrivo io", help: "Ingredienti e procedimento tuoi." },
  own_ai: { title: "Trova tu", help: "Dai il nome: ingredienti, procedimento e link li trova l'AI." },
  own_known: { title: "La so io", help: "Solo il nome: l'AI stima gli ingredienti per la spesa (li puoi correggere)." },
};

const KIND_LABEL: Record<string, string> = { own: "scritta da te", own_ai: "trovata dall'AI", own_known: "la sai tu" };

export function Recipes() {
  const { data, loading, error, reload } = useLoad<{ recipes: Recipe[]; favorites: { id: string; title: string; minutes: number }[] }>("/api/recipes");
  const [adding, setAdding] = useState<Mode | null>(null);
  const [editing, setEditing] = useState<Recipe | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Le mie ricette</h1>
          <p className="muted">Entrano nel menù almeno due volte a settimana.</p>
        </div>
      </div>

      <div className="row">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button key={m} className={m === "own" ? "btn-primary" : ""} onClick={() => setAdding(m)}>
            + {MODE_LABEL[m].title}
          </button>
        ))}
      </div>

      {loading && !data && <Loading />}
      <ErrorBox error={error} />

      {data && (
        <section className="section">
          {data.recipes.length === 0 ? (
            <p className="muted">Ancora nessuna ricetta tua.</p>
          ) : (
            <div className="stack">
              {data.recipes.map((r) => (
                <article key={r.id} className="card">
                  <div className="row between">
                    <Link to={`/ricetta/${r.id}`} className="title" style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: "1.1rem", color: "var(--ink)", textDecoration: "none" }}>
                      {r.favorite && <span className="star">★ </span>}
                      {r.title}
                    </Link>
                    <button className="btn-small" onClick={() => setEditing(r)}>
                      Modifica
                    </button>
                  </div>
                  <small className="muted">
                    {KIND_LABEL[r.kind]} · {r.minutes} min · {r.servings} porz.{r.kcal != null && ` · ${r.kcal} kcal/porz.`}
                  </small>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {data && data.favorites.length > 0 && (
        <section className="section">
          <h2>Preferiti dal menù</h2>
          <div className="card">
            <ul className="list">
              {data.favorites.map((f) => (
                <li key={f.id}>
                  <Link to={`/ricetta/${f.id}`}>
                    <span className="star">★</span> {f.title}
                  </Link>{" "}
                  <small className="muted">{f.minutes} min</small>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {adding && (
        <Sheet title={MODE_LABEL[adding].title} onClose={() => setAdding(null)}>
          <RecipeForm
            mode={adding}
            onDone={async () => {
              setAdding(null);
              await reload();
            }}
          />
        </Sheet>
      )}
      {editing && (
        <Sheet title="Modifica ricetta" onClose={() => setEditing(null)}>
          <RecipeForm
            mode="own"
            recipe={editing}
            onDone={async () => {
              setEditing(null);
              await reload();
            }}
          />
        </Sheet>
      )}
    </>
  );
}

function RecipeForm({ mode, recipe, onDone }: { mode: Mode; recipe?: Recipe; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState(recipe?.title ?? "");
  const [servings, setServings] = useState(recipe?.servings ?? 4);
  const [minutes, setMinutes] = useState(recipe?.minutes ?? 30);
  const [steps, setSteps] = useState(recipe?.steps ?? "");
  const [ings, setIngs] = useState<Ingredient[]>(recipe?.ingredients.map(({ name, grams }) => ({ name, grams })) ?? [{ name: "", grams: 100 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = mode === "own";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const ingredients = ings.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), grams: Number(i.grams) || 0 }));
      if (recipe) {
        await api("PATCH", `/api/recipes/${recipe.id}`, {
          title,
          servings,
          minutes,
          ingredients,
          ...(recipe.kind === "own" ? { steps: steps || null } : {}),
        });
      } else if (full) {
        await api("POST", "/api/recipes", { mode, title, servings, minutes, ingredients, steps: steps || undefined });
      } else {
        await api("POST", "/api/recipes", { mode, title, servings });
      }
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!recipe || !confirm(`Eliminare «${recipe.title}»?`)) return;
    await api("DELETE", `/api/recipes/${recipe.id}`);
    await onDone();
  }

  return (
    <div className="stack">
      {!recipe && <p className="muted">{MODE_LABEL[mode].help}</p>}
      <div className="field">
        <label htmlFor="rt">Nome</label>
        <input id="rt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="es. Pasta e fagioli della nonna" />
      </div>
      <div className="row">
        <div className="grow">
          <label htmlFor="rs">Porzioni</label>
          <input id="rs" type="number" min={1} max={30} value={servings} onChange={(e) => setServings(Number(e.target.value))} />
        </div>
        {full && (
          <div className="grow">
            <label htmlFor="rm">Minuti</label>
            <input id="rm" type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </div>
        )}
      </div>
      {(full || recipe) && (
        <div>
          <label>Ingredienti (grammi totali)</label>
          <div className="stack">
            {ings.map((i, idx) => (
              <div key={idx} className="row">
                <input className="grow" value={i.name} placeholder="ingrediente" aria-label="Ingrediente" onChange={(e) => setIngs(ings.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))} />
                <input type="number" min={0} value={i.grams} aria-label="Grammi" style={{ width: 90 }} onChange={(e) => setIngs(ings.map((x, j) => (j === idx ? { ...x, grams: Number(e.target.value) } : x)))} />
                <button className="btn-ghost" aria-label="Rimuovi ingrediente" onClick={() => setIngs(ings.filter((_, j) => j !== idx))}>
                  ✕
                </button>
              </div>
            ))}
            <button className="btn-small" onClick={() => setIngs([...ings, { name: "", grams: 100 }])}>
              + Ingrediente
            </button>
          </div>
        </div>
      )}
      {(full && (!recipe || recipe.kind === "own")) && (
        <div className="field">
          <label htmlFor="rp">Procedimento</label>
          <textarea id="rp" value={steps} onChange={(e) => setSteps(e.target.value)} />
        </div>
      )}
      <ErrorBox error={error} />
      <button className="btn-primary btn-block" disabled={busy || title.trim().length < 2} onClick={() => void save()}>
        {busy ? (mode === "own" ? "Salvo…" : "L'AI ci sta pensando…") : "Salva"}
      </button>
      {recipe && (
        <button className="btn-ghost btn-danger" onClick={() => void remove()}>
          Elimina ricetta
        </button>
      )}
    </div>
  );
}
