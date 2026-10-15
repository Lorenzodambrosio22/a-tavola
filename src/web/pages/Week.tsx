import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { MealView, Recipe, Slot, Speed, WeekView } from "../../shared/types";
import { SLOT_LABEL } from "../../shared/types";
import { api } from "../api";
import { DAY_SHORT, ErrorBox, formatDay, Loading, memberName, Sheet, useLoad, useMe, weekdayOf } from "../ui";
import { RejectSheet } from "./RejectSheet";
import { ExpiringSoon } from "./Pantry";
import { RecipePhoto } from "../RecipePhoto";

interface CurrentResp {
  week: WeekView | null;
  today: string;
  suggested_start: string;
  shopping_day: number;
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function Week() {
  const { me } = useMe();
  const { data, setData, error, loading, reload } = useLoad<CurrentResp>("/api/weeks/current");
  const [settings, setSettings] = useState(false);
  const [photoChecks, setPhotoChecks] = useState(0);

  // Il server prepara le foto in background: due aggiornamenti silenziosi le mostrano senza ricaricare.
  const missingPhotos = !!data?.week?.meals.some((m) => m.recipe && !m.recipe.source_url);
  useEffect(() => {
    if (!missingPhotos || photoChecks >= 2) return;
    const t = setTimeout(() => {
      setPhotoChecks((n) => n + 1);
      void reload();
    }, 8000);
    return () => clearTimeout(t);
  }, [missingPhotos, photoChecks, reload]);

  function replaceMeal(m: MealView) {
    if (!data?.week) return;
    setData({ ...data, week: { ...data.week, meals: data.week.meals.map((x) => (x.id === m.id ? m : x)) } });
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const week = data.week;

  return (
    <>
      <div className="page-head week-head">
        <div>
          <p className="eyebrow">MANGIARE BENE, INSIEME</p>
          <h1>{week ? "La tua settimana buona." : `Ciao ${me.user.name}!`}</h1>
          {week ? (
            <p className="muted">
              Da {formatDay(week.start_date)} · {week.status === "shopped" ? "La spesa è pronta" : "Il menù prende forma"}
            </p>
          ) : (
            <p className="muted">La settimana buona, per tutta la famiglia.</p>
          )}
        </div>
        {week && (
          <button className="btn-small" onClick={() => setSettings(true)}>
            {week.status === "shopped" ? "Nuova settimana" : "Rigenera"}
          </button>
        )}
      </div>

      {week && <div className="week-summary"><span><strong>7</strong> giorni da gustare</span><span><strong>{week.meals.filter((m) => m.status === "planned").length}</strong> pasti organizzati</span><span className="week-summary-note">Un pensiero in meno, ogni giorno.</span></div>}

      <ExpiringSoon />

      {!week && <WeekSettings start={data.suggested_start} onDone={reload} />}
      {week && <WeekGrid week={week} onMeal={replaceMeal} />}

      {settings && week && (
        <Sheet title="Impostazioni della settimana" onClose={() => setSettings(false)}>
          <WeekSettings
            start={week.status === "shopped" ? addDays(week.start_date, 7) : week.start_date}
            onDone={async () => {
              setSettings(false);
              await reload();
            }}
          />
        </Sheet>
      )}
    </>
  );
}

function WeekSettings({ start: initialStart, onDone }: { start: string; onDone: () => Promise<void> | void }) {
  const { me } = useMe();
  const [start, setStart] = useState(initialStart);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const [speeds, setSpeeds] = useState<Record<string, Speed>>({});
  const [reuse, setReuse] = useState(false);
  const [pins, setPins] = useState<{ date: string; slot: Slot; recipe_id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    const s: Record<string, Speed> = {};
    for (const d of days) {
      const wd = weekdayOf(d);
      s[d] = wd === 0 || wd === 6 ? "long" : "quick";
    }
    setSpeeds(s);
  }, [days]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/api/weeks/generate", {
        start_date: start,
        speeds,
        reuse_favorites: reuse,
        pinned: pins.map(({ date, slot, recipe_id }) => ({ date, slot, recipe_id })),
      });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const slots: Slot[] = me.members.some((m) => m.breakfast) ? ["breakfast", "lunch", "dinner"] : ["lunch", "dinner"];

  return (
    <div className="card stack">
      <div className="field">
        <label htmlFor="start">Giorno della spesa (inizio settimana)</label>
        <input id="start" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
      </div>
      <div>
        <label>Veloce o con calma?</label>
        <div className="speed-toggle">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              className={speeds[d] === "long" ? "long" : ""}
              onClick={() => setSpeeds({ ...speeds, [d]: speeds[d] === "long" ? "quick" : "long" })}
              aria-label={`${formatDay(d)}: ${speeds[d] === "long" ? "lunga" : "veloce"}`}
            >
              <span>{DAY_SHORT[weekdayOf(d)]}</span>
              <small>{speeds[d] === "long" ? "calma" : "≤25′"}</small>
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
        Riproponi preferiti
      </label>
      <div>
        <div className="row between">
          <label style={{ margin: 0 }}>Pasti fissati</label>
          <button type="button" className="btn-small" onClick={() => setPinOpen(true)}>
            + Fissa un piatto
          </button>
        </div>
        {pins.length === 0 ? (
          <p className="muted">Nessuno: decide l'AI.</p>
        ) : (
          <ul className="list">
            {pins.map((p, i) => (
              <li key={i} className="row between">
                <span>
                  {formatDay(p.date)} · {SLOT_LABEL[p.slot]}: <strong>{p.title}</strong>
                </span>
                <button className="btn-ghost btn-small" onClick={() => setPins(pins.filter((_, j) => j !== i))}>
                  Rimuovi
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ErrorBox error={error} />
      <button className="btn-primary btn-block" disabled={busy} onClick={() => void generate()}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden /> Sto preparando il menù…
          </>
        ) : (
          "Genera il menù"
        )}
      </button>
      {pinOpen && (
        <PinPicker
          days={days}
          slots={slots}
          onClose={() => setPinOpen(false)}
          onPick={(p) => {
            setPins([...pins.filter((x) => !(x.date === p.date && x.slot === p.slot)), p]);
            setPinOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PinPicker({
  days,
  slots,
  onClose,
  onPick,
}: {
  days: string[];
  slots: Slot[];
  onClose: () => void;
  onPick: (p: { date: string; slot: Slot; recipe_id: string; title: string }) => void;
}) {
  const { data } = useLoad<{ recipes: Recipe[]; favorites: { id: string; title: string }[] }>("/api/recipes");
  const [date, setDate] = useState(days[0]);
  const [slot, setSlot] = useState<Slot>("dinner");
  const options = [
    ...(data?.recipes ?? []).map((r) => ({ id: r.id, title: r.title, fav: !!r.favorite })),
    ...(data?.favorites ?? []).map((r) => ({ id: r.id, title: r.title, fav: true })),
  ];
  return (
    <Sheet title="Fissa un piatto" onClose={onClose}>
      <div className="stack">
        <div className="row">
          <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="Giorno" className="grow">
            {days.map((d) => (
              <option key={d} value={d}>
                {formatDay(d)}
              </option>
            ))}
          </select>
          <select value={slot} onChange={(e) => setSlot(e.target.value as Slot)} aria-label="Pasto" style={{ width: "auto" }}>
            {slots.map((s) => (
              <option key={s} value={s}>
                {SLOT_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {options.length === 0 ? (
          <p className="muted">
            Nessuna ricetta tua o preferita. Aggiungine una in <Link to="/ricette">Ricette</Link>.
          </p>
        ) : (
          <ul className="list">
            {options.map((o) => (
              <li key={o.id}>
                <button className="btn-ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => onPick({ date, slot, recipe_id: o.id, title: o.title })}>
                  {o.fav && <span className="star">★</span>} {o.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

function WeekGrid({ week, onMeal }: { week: WeekView; onMeal: (m: MealView) => void }) {
  const byDay = useMemo(() => {
    const map = new Map<string, MealView[]>();
    for (const m of week.meals) map.set(m.date, [...(map.get(m.date) ?? []), m]);
    return [...map.entries()];
  }, [week]);
  return (
    <>
      {byDay.map(([date, meals]) => (
        <section key={date} className="day">
          <div className="day-head">
            <h2>{formatDay(date)}</h2>
            <small className="muted">{meals[0]?.speed === "long" ? "con calma" : "veloce"}</small>
          </div>
          <div className="stack">
            {meals.map((m) => (
              <MealCard key={m.id} meal={m} week={week} onChange={onMeal} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function MealCard({ meal, week, onChange }: { meal: MealView; week: WeekView; onChange: (m: MealView) => void }) {
  const { me } = useMe();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reject, setReject] = useState(false);
  const [choose, setChoose] = useState(false);
  const iAmPresent = meal.present.includes(me.user.id);
  const eaters = week.members.filter((m) => meal.slot !== "breakfast" || m.breakfast);

  async function act(label: string, fn: () => Promise<{ meal: MealView }>) {
    setBusy(label);
    setError(null);
    try {
      onChange((await fn()).meal);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleFav() {
    if (!meal.recipe) return;
    try {
      await api("PUT", `/api/recipes/${meal.recipe.id}/favorite`, { favorite: !meal.favorite });
      onChange({ ...meal, favorite: !meal.favorite });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const togglePresence = (userId: string) =>
    act("presence", () => api("POST", `/api/meals/${meal.id}/absence`, { user_id: userId, absent: meal.present.includes(userId) }));

  return (
    <article className={`card meal ${meal.status === "skipped" ? "skipped" : ""} ${!meal.recipe ? "empty" : ""}`}>
      {meal.recipe && meal.status !== "skipped" && <RecipePhoto image={meal.recipe.image_url} source={meal.recipe.source_url} title={meal.recipe.title} compact />}
      <div className="meal-body">
      <div className="row between">
        <span className="slot">
          {SLOT_LABEL[meal.slot]}
          {meal.pinned && " · fissato"}
        </span>
        {meal.recipe && (
          <button className="btn-ghost btn-small" onClick={() => void toggleFav()} aria-label={meal.favorite ? "Togli dai preferiti" : "Aggiungi ai preferiti"} aria-pressed={meal.favorite}>
            <span className="star">{meal.favorite ? "★" : "☆"}</span>
          </button>
        )}
      </div>
      {meal.status === "skipped" ? (
        <p className="title">Nessuno a tavola</p>
      ) : meal.recipe ? (
        <Link className="title" to={`/ricetta/${meal.recipe.id}?meal=${meal.id}`}>
          {meal.recipe.title}
        </Link>
      ) : (
        <p className="title">{meal.message}</p>
      )}
      {meal.recipe && meal.status !== "skipped" && (
        <div className="meta">
          <span>{meal.recipe.minutes} min</span>
          {meal.kcal !== null && (
            <span>
              {meal.kcal} kcal/porz.{meal.kcal_partial && " (parziali)"}
            </span>
          )}
          <span>{meal.present.length} a tavola</span>
        </div>
      )}
      {meal.warnings.map((w, i) => (
        <span key={i} className="badge-warn">
          ⚠️ contiene {w.ingredient}, allergene di {w.name} (assente)
        </span>
      ))}
      {meal.violations.length > 0 && (
        <span className="badge-warn">
          ⚠️ {meal.violations.join("; ")}.{" "}
          <button className="btn-small" disabled={!!busy} onClick={() => void act("replace", () => api("POST", `/api/meals/${meal.id}/replace`))}>
            {busy === "replace" ? "Cerco…" : "Sostituisci"}
          </button>
        </span>
      )}

      {eaters.length > 1 && (
        <div className="row" style={{ marginTop: 8 }} aria-label="Presenti">
          {eaters.map((m) => {
            const here = meal.present.includes(m.id);
            return (
              <button key={m.id} className={`chip ${here ? "ok" : ""}`} disabled={!!busy} onClick={() => void togglePresence(m.id)} aria-pressed={here}>
                {here ? "✓" : "✕"} {memberName(me, m.id)}
              </button>
            );
          })}
        </div>
      )}

      {week.status === "draft" || meal.recipe ? (
        <div className="actions">
          {eaters.some((m) => m.id === me.user.id) && (
            <button className="btn-ghost btn-small" disabled={!!busy} onClick={() => void togglePresence(me.user.id)}>
              {iAmPresent ? "Non ci sono" : "Ci sono"}
            </button>
          )}
          {meal.recipe && iAmPresent && meal.status === "planned" && (
            <button className="btn-ghost btn-small" disabled={!!busy} onClick={() => setReject(true)}>
              Non mi piace
            </button>
          )}
          {meal.status === "planned" && (
            <button className="btn-ghost btn-small" disabled={!!busy} onClick={() => setChoose(true)}>
              Scegli tu
            </button>
          )}
        </div>
      ) : null}
      <ErrorBox error={error} />
      </div>
      {reject && meal.recipe && (
        <RejectSheet
          meal={meal}
          onClose={() => setReject(false)}
          onDone={(m) => {
            setReject(false);
            onChange(m);
          }}
        />
      )}
      {choose && (
        <ChooseRecipe
          onClose={() => setChoose(false)}
          onPick={(id) => {
            setChoose(false);
            void act("choose", () => api("PUT", `/api/meals/${meal.id}/recipe`, { recipe_id: id, pinned: true }));
          }}
        />
      )}
    </article>
  );
}

function ChooseRecipe({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const { data, loading } = useLoad<{ recipes: Recipe[]; favorites: { id: string; title: string }[] }>("/api/recipes");
  const options = [
    ...(data?.favorites ?? []).map((r) => ({ id: r.id, title: r.title, fav: true })),
    ...(data?.recipes ?? []).map((r) => ({ id: r.id, title: r.title, fav: !!r.favorite })),
  ];
  return (
    <Sheet title="Scegli tu" onClose={onClose}>
      {loading ? (
        <Loading />
      ) : options.length === 0 ? (
        <p className="muted">
          Non hai ancora ricette tue o preferite. Aggiungile in <Link to="/ricette">Ricette</Link> o con la ⭐.
        </p>
      ) : (
        <ul className="list">
          {options.map((o) => (
            <li key={o.id}>
              <button className="btn-ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => onPick(o.id)}>
                {o.fav && <span className="star">★</span>} {o.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
