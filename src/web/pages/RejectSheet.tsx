import { useState } from "react";
import type { MealView, RejectReason } from "../../shared/types";
import { api } from "../api";
import { ErrorBox, Sheet } from "../ui";

interface RejectResp {
  meal: MealView;
  learned: { dislikes: string[]; blockDish: string | null };
  question: { ingredient: string } | null;
}

export function RejectSheet({ meal, onClose, onDone }: { meal: MealView; onClose: () => void; onDone: (m: MealView) => void }) {
  const [reason, setReason] = useState<RejectReason>("today");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RejectResp | null>(null);
  const recipe = meal.recipe!;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<RejectResp>("POST", `/api/meals/${meal.id}/reject`, { reason, ingredients: reason === "ingredient" ? [...picked] : [] });
      if (r.question) setResult(r);
      else onDone(r.meal);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function answer(yes: boolean) {
    if (!result?.question) return;
    await api("POST", "/api/learning/answer", { ingredient: result.question.ingredient, yes }).catch(() => {});
    onDone(result.meal);
  }

  if (result?.question) {
    return (
      <Sheet title="Una domanda" onClose={() => onDone(result.meal)}>
        <div className="stack">
          <p>
            Ho cambiato piatto: ora c'è <strong>{result.meal.recipe?.title ?? "spazio libero"}</strong>.
          </p>
          <p>
            Hai rifiutato più volte piatti con <strong>{result.question.ingredient}</strong>. Forse non ti piace?
          </p>
          <div className="row">
            <button className="btn-primary grow" onClick={() => void answer(true)}>
              Sì, evitalo
            </button>
            <button className="grow" onClick={() => void answer(false)}>
              No, è un caso
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  const options: { value: RejectReason; label: string; help: string }[] = [
    { value: "today", label: "Solo oggi", help: "Cambio il piatto, senza imparare nulla." },
    { value: "ingredient", label: "Non mi piace un ingrediente", help: "Lo eviterò nei pasti in cui ci sei." },
    { value: "dish", label: `Non mi piacciono i piatti «${recipe.dish_family}»`, help: "Non te li riproporrò." },
  ];

  return (
    <Sheet title={`Non mi piace: ${recipe.title}`} onClose={onClose}>
      <div className="stack">
        {options.map((o) => (
          <label key={o.value} className="card check" style={{ alignItems: "flex-start", cursor: "pointer" }}>
            <input type="radio" name="reason" checked={reason === o.value} onChange={() => setReason(o.value)} />
            <span>
              {o.label}
              <br />
              <small className="muted">{o.help}</small>
            </span>
          </label>
        ))}
        {reason === "ingredient" && (
          <div className="row">
            {recipe.ingredients.map((i) => {
              const on = picked.has(i.name);
              return (
                <button
                  key={i.name}
                  className={`chip ${on ? "allergy" : ""}`}
                  aria-pressed={on}
                  onClick={() => {
                    const n = new Set(picked);
                    if (on) n.delete(i.name);
                    else n.add(i.name);
                    setPicked(n);
                  }}
                >
                  {on ? "✕ " : ""}
                  {i.name}
                </button>
              );
            })}
          </div>
        )}
        <ErrorBox error={error} />
        <button className="btn-primary btn-block" disabled={busy || (reason === "ingredient" && picked.size === 0)} onClick={() => void send()}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden /> Cerco un'alternativa…
            </>
          ) : (
            "Cambia piatto"
          )}
        </button>
      </div>
    </Sheet>
  );
}
