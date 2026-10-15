import type { Ingredient, Recipe, RecipeKind, Slot, Speed } from "../../shared/types";
import { findViolations, type Violation } from "../../domain/constraints";
import { addDays, todayIn } from "../../domain/dates";
import { planSlots, presence, type SlotPlan } from "../../domain/week";
import { normalizeName } from "../../domain/text";
import { AiUnavailable, type AiProvider, type HouseholdRecipeRef, type PlannedMeal, type WeekRequest } from "../ai";
import { all, first, newId, stmt } from "../db/sql";
import { HTTPException } from "hono/http-exception";
import {
  displayName,
  getRecipesByIds,
  householdOwnRecipes,
  loadHouseholdCtx,
  namesOf,
  peoplePrefs,
  type HouseholdCtx,
} from "./context";
import { canonicalize, namesForCheck, normalizeIngredients } from "./ingredients";

export const NO_VALID_PROPOSAL = "Nessuna proposta valida, scegli tu";

/** Ricetta candidata per un pasto: esistente (id) o nuova da salvare. */
export interface Candidate {
  existingId?: string;
  title: string;
  dish_family: string;
  minutes: number;
  servings: number;
  ingredients: Ingredient[];
  kind: RecipeKind;
}

export function describeViolations(ctx: HouseholdCtx, v: Violation[]): string[] {
  return v.map((x) => {
    const who = ctx.members.find((m) => m.id === x.user_id);
    const name = who ? displayName(who) : "?";
    if (x.kind === "dish") return `«${x.term}» è un piatto bloccato da ${name}`;
    return `contiene ${x.ingredient}${x.ingredient !== x.term ? ` (${x.term})` : ""}: ${x.level === "allergy" ? "allergia" : "vietato"} di ${name}`;
  });
}

export function violationsFor(ctx: HouseholdCtx, presentIds: string[], ingredients: Ingredient[], dishFamily: string): Violation[] {
  return findViolations({ ingredients: namesForCheck(ingredients), dish_family: dishFamily }, presentIds, ctx.constraints, ctx.blocked, ctx.groups);
}

export function recipeRefs(recipes: Recipe[]): HouseholdRecipeRef[] {
  return recipes.map((r) => ({ id: r.id, title: r.title, minutes: r.minutes, ingredients: r.ingredients.map((i) => i.name) }));
}

async function toCandidate(
  db: D1Database,
  provider: AiProvider | null,
  planned: PlannedMeal,
  known: Map<string, Recipe>,
): Promise<Candidate> {
  const existing = planned.recipe_id ? known.get(planned.recipe_id) : undefined;
  if (existing) {
    return { existingId: existing.id, title: existing.title, dish_family: existing.dish_family, minutes: existing.minutes, servings: existing.servings, ingredients: existing.ingredients, kind: existing.kind };
  }
  return {
    title: planned.title.trim(),
    dish_family: normalizeName(planned.dish_family),
    minutes: planned.minutes,
    servings: planned.servings,
    ingredients: await normalizeIngredients(db, provider, planned.ingredients),
    kind: "generated",
  };
}

export interface ResolveOptions {
  avoidTitles: string[];
  avoidFamilies: string[];
  preferIngredients: string[];
  known: Map<string, Recipe>;
  reason?: string;
  /** chiamate replaceMeal ammesse */
  maxReplacements: number;
}

/**
 * Controllo di sicurezza (§6.3) + sostituzione: verifica il candidato, se viola i vincoli
 * dei presenti rigenera solo quel pasto con replaceMeal (max N tentativi).
 * Restituisce null se non trova una proposta valida.
 */
export async function resolveMeal(
  db: D1Database,
  provider: AiProvider,
  ctx: HouseholdCtx,
  slot: { date: string; slot: Slot; speed: Speed; present: string[] },
  initial: PlannedMeal | null,
  opts: ResolveOptions,
): Promise<{ candidate: Candidate | null; attempts: number; rejected: string[] }> {
  let planned = initial;
  let replacements = 0;
  const avoid = [...opts.avoidTitles];
  const rejected: string[] = [];
  let reason = opts.reason;
  for (;;) {
    if (planned) {
      const cand = await toCandidate(db, provider, planned, opts.known);
      const v = violationsFor(ctx, slot.present, cand.ingredients, cand.dish_family);
      if (!v.length) return { candidate: cand, attempts: replacements, rejected };
      rejected.push(cand.title);
      avoid.push(cand.title);
      reason = `la proposta «${cand.title}» ${describeViolations(ctx, v).join("; ")}`;
    }
    if (replacements >= opts.maxReplacements) return { candidate: null, attempts: replacements, rejected };
    replacements++;
    try {
      const out = await provider.replaceMeal({
        meal: { date: slot.date, slot: slot.slot, speed: slot.speed, present: namesOf(ctx, slot.present) },
        people: peoplePrefs(ctx, slot.present),
        avoid_titles: avoid,
        avoid_dish_families: opts.avoidFamilies,
        prefer_ingredients: opts.preferIngredients,
        household_recipes: recipeRefs([...opts.known.values()].filter((r) => r.kind !== "generated")),
        reason,
      });
      planned = { ...out, date: slot.date, slot: slot.slot };
    } catch (e) {
      if (initial === null && replacements === 1) throw e instanceof AiUnavailable ? e : new AiUnavailable();
      return { candidate: null, attempts: replacements, rejected };
    }
  }
}

/** Salva la ricetta candidata (se nuova) e restituisce l'id. */
export function recipeInsert(db: D1Database, householdId: string, c: Candidate): { id: string; stmt: D1PreparedStatement | null } {
  if (c.existingId) return { id: c.existingId, stmt: null };
  const id = newId();
  return {
    id,
    stmt: stmt(
      db,
      `INSERT INTO recipes (id, household_id, title, dish_family, minutes, servings, ingredients, kind, details_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'none')`,
      id,
      householdId,
      c.title,
      c.dish_family,
      Math.round(c.minutes),
      Math.max(1, Math.round(c.servings)),
      JSON.stringify(c.ingredients),
      c.kind,
    ),
  };
}

export interface GenerateParams {
  start_date: string;
  shopping_day: number;
  speeds: Record<string, Speed>;
  reuse_favorites: boolean;
  pinned: { date: string; slot: Slot; recipe_id: string }[];
}

export async function recentMeals(db: D1Database, householdId: string, start: string) {
  return all<{ title: string; dish_family: string }>(
    db,
    `SELECT DISTINCT r.title, r.dish_family FROM meals m
       JOIN weeks w ON w.id = m.week_id JOIN recipes r ON r.id = m.recipe_id
      WHERE w.household_id = ? AND m.date >= ? AND m.date < ?`,
    householdId,
    addDays(start, -14),
    start,
  );
}

export async function favoriteRecipes(db: D1Database, ctx: HouseholdCtx): Promise<Recipe[]> {
  const ids = ctx.members.map((m) => m.id);
  const rows = await all<{ recipe_id: string }>(
    db,
    `SELECT DISTINCT f.recipe_id FROM favorites f JOIN recipes r ON r.id = f.recipe_id
      WHERE r.household_id = ? AND f.user_id IN (${ids.map(() => "?").join(",")})`,
    ctx.householdId,
    ...ids,
  );
  return [...(await getRecipesByIds(db, rows.map((r) => r.recipe_id))).values()];
}

/** Ingredienti in dispensa per i prompt (prima quelli in scadenza). */
export async function pantryForPrompt(db: D1Database, householdId: string) {
  return all<{ ingredient: string; expires_at: string }>(
    db,
    `SELECT ingredient, MIN(expires_at) AS expires_at FROM pantry_items
      WHERE household_id = ? AND status = 'ok' AND grams > 0 AND expires_at >= ? GROUP BY ingredient ORDER BY expires_at LIMIT 40`,
    householdId,
    todayIn(),
  );
}

/**
 * Generazione del menù (§6.2–6.3): una chiamata generateWeek, poi controllo di sicurezza
 * e sostituzione dei soli pasti non validi. La settimana esistente viene sostituita solo a
 * generazione riuscita.
 */
export async function generateWeek(db: D1Database, provider: AiProvider, householdId: string, params: GenerateParams): Promise<string> {
  const ctx = await loadHouseholdCtx(db, householdId);
  const existing = await first<{ id: string; status: string }>(
    db,
    "SELECT id, status FROM weeks WHERE household_id = ? AND start_date = ?",
    householdId,
    params.start_date,
  );
  if (existing?.status === "shopped") throw new HTTPException(409, { message: "La spesa di questa settimana è già fatta" });

  // Assenze manuali della bozza precedente: si conservano
  const prevAbsences = existing
    ? await all<{ date: string; slot: Slot; user_id: string }>(
        db,
        "SELECT m.date, m.slot, a.user_id FROM meal_absences a JOIN meals m ON m.id = a.meal_id WHERE m.week_id = ?",
        existing.id,
      )
    : [];

  const plan: SlotPlan[] = planSlots({
    startDate: params.start_date,
    members: ctx.members,
    recurring: ctx.recurring,
    speeds: params.speeds,
  }).map((p) => {
    const extra = prevAbsences.filter((a) => a.date === p.date && a.slot === p.slot).map((a) => a.user_id);
    if (!extra.length) return p;
    const pr = presence(p.slot, ctx.members, [...new Set([...p.absent, ...extra])]);
    return { ...p, ...pr };
  });

  const own = await householdOwnRecipes(db, householdId);
  const favorites = params.reuse_favorites ? await favoriteRecipes(db, ctx) : [];
  const known = new Map<string, Recipe>([...own, ...favorites].map((r) => [r.id, r]));

  const pins = new Map<string, Recipe>();
  if (params.pinned.length) {
    const pinRecipes = await getRecipesByIds(db, params.pinned.map((p) => p.recipe_id));
    for (const p of params.pinned) {
      const r = pinRecipes.get(p.recipe_id);
      const slot = plan.find((s) => s.date === p.date && s.slot === p.slot);
      const ownRecipe = r && await db.prepare("SELECT 1 FROM recipes WHERE id = ? AND household_id = ?").bind(r.id, householdId).first();
      if (!ownRecipe || !slot) throw new HTTPException(404, { message: "Pasto o ricetta fissata non trovati nel nucleo" });
      if (r) {
        const violations = violationsFor(ctx, slot.present, r.ingredients, r.dish_family);
        if (violations.length) throw new HTTPException(422, { message: `Piatto fissato non valido: ${describeViolations(ctx, violations).join("; ")}` });
        pins.set(`${p.date}|${p.slot}`, r);
        known.set(r.id, r);
      }
    }
  }

  const toGenerate = plan.filter((p) => p.present.length > 0 && !pins.has(`${p.date}|${p.slot}`));
  const recent = await recentMeals(db, householdId, params.start_date);
  const pantry = await pantryForPrompt(db, householdId);

  const people = peoplePrefs(ctx, ctx.members.map((m) => m.id));
  const request: WeekRequest = {
    meals: toGenerate.map((p) => ({ date: p.date, slot: p.slot, speed: p.speed, present: namesOf(ctx, p.present) })),
    people,
    recent,
    household_recipes: recipeRefs(own),
    favorites: favorites.map((f) => ({ id: f.id, title: f.title })),
    pantry,
  };

  const out = toGenerate.length ? await provider.generateWeek(request) : { meals: [] };

  // Normalizza in un colpo solo tutti i nomi nuovi (una sola chiamata mapIngredient)
  await canonicalize(db, provider, out.meals.flatMap((m) => m.ingredients.map((i) => i.name)));

  const byKey = new Map<string, PlannedMeal>();
  for (const m of out.meals) {
    const k = `${m.date}|${m.slot}`;
    if (!byKey.has(k)) byKey.set(k, m);
  }

  // Stessa settimana (stesso id): la lista della spesa conserva voci manuali e spunte
  const weekId = existing?.id ?? newId();
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(stmt(db, "DELETE FROM meal_absences WHERE meal_id IN (SELECT id FROM meals WHERE week_id = ?)", weekId));
    statements.push(stmt(db, "DELETE FROM meals WHERE week_id = ?", weekId));
    statements.push(stmt(db, "UPDATE weeks SET shopping_day = ?, provider = ? WHERE id = ?", params.shopping_day, provider.name, weekId));
  } else {
    statements.push(
      stmt(
        db,
        "INSERT INTO weeks (id, household_id, start_date, shopping_day, status, provider) VALUES (?, ?, ?, ?, 'draft', ?)",
        weekId,
        householdId,
        params.start_date,
        params.shopping_day,
        provider.name,
      ),
    );
  }

  const usedTitles = out.meals.map((m) => m.title);
  for (const p of plan) {
    const mealId = newId();
    let recipeId: string | null = null;
    let pinned = false;
    const pin = pins.get(`${p.date}|${p.slot}`);
    if (pin) {
      recipeId = pin.id;
      pinned = true;
    } else if (p.present.length > 0) {
      const { candidate } = await resolveMeal(db, provider, ctx, p, byKey.get(`${p.date}|${p.slot}`) ?? null, {
        avoidTitles: [...usedTitles, ...recent.map((r) => r.title)],
        avoidFamilies: [],
        preferIngredients: pantry.map((x) => x.ingredient),
        known,
        maxReplacements: 2,
      });
      if (candidate) {
        const ins = recipeInsert(db, householdId, candidate);
        if (ins.stmt) statements.push(ins.stmt);
        recipeId = ins.id;
        usedTitles.push(candidate.title);
      }
    }
    statements.push(
      stmt(
        db,
        "INSERT INTO meals (id, week_id, date, slot, recipe_id, speed, pinned, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        mealId,
        weekId,
        p.date,
        p.slot,
        recipeId,
        p.speed,
        pinned,
        p.present.length > 0 ? "planned" : "skipped",
      ),
    );
    for (const uid of p.absent) {
      statements.push(stmt(db, "INSERT INTO meal_absences (meal_id, user_id) VALUES (?, ?)", mealId, uid));
    }
  }
  await db.batch(statements);
  return weekId;
}
