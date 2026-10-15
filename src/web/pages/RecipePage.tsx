import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Ingredient, MealView, Recipe } from "../../shared/types";
import { SLOT_LABEL } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, formatDay, Loading, useLoad } from "../ui";
import { RecipePhoto } from "../RecipePhoto";

interface Resp {
  recipe: Recipe;
  meal: MealView | null;
  scaled_ingredients: Ingredient[] | null;
  details_error: string | null;
}

function fmtGrams(g: number): string {
  return g >= 1000 ? `${(g / 1000).toLocaleString("it-IT", { maximumFractionDigits: 2 })} kg` : `${g.toLocaleString("it-IT")} g`;
}

export function RecipePage() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const meal = sp.get("meal");
  const { data, setData, error, loading } = useLoad<Resp>(`/api/recipes/${id}${meal ? `?meal=${meal}` : ""}`);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !data)
    return (
      <>
        <Link to="/" className="btn-ghost btn-small">
          ← Settimana
        </Link>
        <Loading label="Preparo la ricetta…" />
      </>
    );
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const r = data.recipe;
  const ingredients = data.scaled_ingredients ?? r.ingredients;
  const people = data.meal ? data.meal.present.length : r.servings;

  async function toggleFav() {
    try {
      await api("PUT", `/api/recipes/${r.id}/favorite`, { favorite: !r.favorite });
      setData({ ...data!, recipe: { ...r, favorite: !r.favorite } });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <Link to={data.meal ? "/" : "/ricette"} className="btn-ghost btn-small" style={{ paddingLeft: 0 }}>
        ← {data.meal ? "Settimana" : "Ricette"}
      </Link>
      <div className="page-head">
        <div>
          {data.meal && (
            <p className="muted" style={{ margin: 0 }}>
              {formatDay(data.meal.date)} · {SLOT_LABEL[data.meal.slot]}
            </p>
          )}
          <h1>{r.title}</h1>
          <p className="muted">
            {r.minutes} min
            {r.kcal != null && ` · ${r.kcal} kcal a porzione${r.kcal_partial ? " (calorie parziali)" : ""}`}
          </p>
        </div>
        <button className="btn-ghost" onClick={() => void toggleFav()} aria-label={r.favorite ? "Togli dai preferiti" : "Aggiungi ai preferiti"} aria-pressed={!!r.favorite}>
          <span className="star" style={{ fontSize: "1.4rem" }}>
            {r.favorite ? "★" : "☆"}
          </span>
        </button>
      </div>

      <RecipePhoto image={r.image_url} source={r.source_url} title={r.title} />

      {data.meal?.warnings.map((w, i) => (
        <span key={i} className="badge-warn">
          ⚠️ contiene {w.ingredient}, allergene di {w.name} (assente)
        </span>
      ))}
      {data.meal?.violations.map((v, i) => (
        <span key={i} className="badge-warn">
          ⚠️ {v}
        </span>
      ))}

      <section className="section">
        <h2>
          Ingredienti <small className="muted">per {people} {people === 1 ? "persona" : "persone"}</small>
        </h2>
        <div className="card">
          <ul className="list">
            {ingredients.map((i) => (
              <li key={i.name} className="row between">
                <span>{i.name}</span>
                <span className="muted">{fmtGrams(i.grams)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section">
        <h2>Procedimento</h2>
        <div className="card">
          {r.steps ? (
            <p className="steps">{r.steps}</p>
          ) : r.kind === "own_known" ? (
            <p className="muted">La sai tu! 🙂</p>
          ) : (
            <p className="muted">{data.details_error ?? "Procedimento non disponibile."}</p>
          )}
        </div>
      </section>

      {r.source_url && (
        <p className="section">
          <a href={r.source_url} target="_blank" rel="noopener noreferrer">
            Ricetta originale ↗
          </a>{" "}
          <small className="muted">({new URL(r.source_url).hostname.replace(/^www\./, "")})</small>
        </p>
      )}
      <ErrorBox error={err} />
    </>
  );
}
