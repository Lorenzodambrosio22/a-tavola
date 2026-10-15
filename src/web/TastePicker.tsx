import { useState } from "react";
import { TASTE_DISHES } from "../shared/tastes";

const CATEGORIES = [...new Set(TASTE_DISHES.map((d) => d.category))];

export function TastePicker({ selected, onChange, disabled = false }: { selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  return (
    <div className="taste-picker">
      <p className="muted">Tocca i piatti che ti piacciono. Ci aiutano a capire i tuoi gusti, lasciando spazio a nuove idee e alla varietà. Puoi cambiare la scelta dal profilo quando vuoi.</p>
      <p className="taste-count" role="status">{selected.length ? `${selected.length} ${selected.length === 1 ? "piatto selezionato" : "piatti selezionati"}` : "Scegli liberamente, anche nessuno."}</p>
      {CATEGORIES.map((category) => (
        <section className="taste-category" key={category} aria-label={category}>
          <h3>{category}</h3>
          <div className="taste-grid">
            {TASTE_DISHES.filter((d) => d.category === category).map((dish) => {
              const checked = selected.includes(dish.id);
              return (
                <div className="taste-card" key={dish.id}>
                  <button type="button" className={`taste-choice${checked ? " selected" : ""}`} aria-pressed={checked} onClick={() => toggle(dish.id)} disabled={disabled}>
                    {failed.includes(dish.id) ? <span className="taste-photo-fallback">Foto non disponibile</span> : <img src={dish.image} alt="" width="650" height="433" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed((old) => [...old, dish.id])} />}
                    <span className="taste-check" aria-hidden="true">{checked ? "✓" : "+"}</span>
                    <span className="taste-title">{dish.title}</span>
                  </button>
                  <a className="taste-credit" href={dish.source} target="_blank" rel="noopener noreferrer" aria-label={`Foto e ricetta di ${dish.title} su GialloZafferano`}>Foto: GialloZafferano ↗</a>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
