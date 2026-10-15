import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Speed } from "../../shared/types";
import { addDays, isISODate, nextWeekday, todayIn } from "../../domain/dates";
import { presence } from "../../domain/week";
import type { AppEnv } from "../env";
import { body, fail } from "../http";
import { getProvider } from "../ai";
import { all, first, run, stmt } from "../db/sql";
import { getHousehold } from "../db/household";
import { getRecipe, householdOwnRecipes, loadHouseholdCtx } from "../services/context";
import { describeViolations, generateWeek, pantryForPrompt, recipeInsert, resolveMeal, violationsFor } from "../services/menu";
import { buildMealViews, buildWeekView, getMealRow, mealAbsences, type MealRow } from "../services/weekView";
import { shoppingIngredientNames } from "../services/shopping";

export const weekRoutes = new Hono<AppEnv>();

export async function providerFor(c: Context<AppEnv>) {
  const hh = await getHousehold(c.env.DB, c.get("householdId"));
  return getProvider(c.env, hh?.provider);
}

async function mealView(c: Context<AppEnv>, mealId: string) {
  const db = c.env.DB;
  const ctx = await loadHouseholdCtx(db, c.get("householdId"));
  const rows = await all<MealRow>(db, "SELECT id, week_id, date, slot, recipe_id, speed, pinned, status FROM meals WHERE id = ?", mealId);
  return (await buildMealViews(db, ctx, rows, c.get("user").id))[0];
}

/** Settimana corrente (o prossima bozza) + giorno della spesa suggerito. */
weekRoutes.get("/weeks/current", async (c) => {
  const db = c.env.DB;
  const hid = c.get("householdId");
  const today = todayIn();
  const w =
    (await first<{ id: string }>(
      db,
      "SELECT id FROM weeks WHERE household_id = ? AND start_date <= ? AND start_date > ? ORDER BY start_date DESC LIMIT 1",
      hid,
      today,
      addDays(today, -7),
    )) ??
    (await first<{ id: string }>(db, "SELECT id FROM weeks WHERE household_id = ? AND start_date > ? ORDER BY start_date LIMIT 1", hid, today));
  const last = await first<{ shopping_day: number; start_date: string }>(
    db,
    "SELECT shopping_day, start_date FROM weeks WHERE household_id = ? ORDER BY start_date DESC LIMIT 1",
    hid,
  );
  const shoppingDay = last?.shopping_day ?? 6;
  let suggested = nextWeekday(today, shoppingDay);
  if (last && last.start_date >= suggested) suggested = addDays(last.start_date, 7);
  const week = w ? await buildWeekView(db, hid, w.id, c.get("user").id) : null;
  return c.json({ week, today, suggested_start: suggested, shopping_day: shoppingDay });
});

weekRoutes.get("/weeks", async (c) => {
  const rows = await all<{ id: string; start_date: string; status: string }>(
    c.env.DB,
    "SELECT id, start_date, status FROM weeks WHERE household_id = ? ORDER BY start_date DESC LIMIT 12",
    c.get("householdId"),
  );
  return c.json({ weeks: rows });
});

weekRoutes.get("/weeks/:id", async (c) => {
  const v = await buildWeekView(c.env.DB, c.get("householdId"), c.req.param("id"), c.get("user").id);
  if (!v) fail(404, "Settimana non trovata");
  return c.json({ week: v });
});

const SLOT = z.enum(["breakfast", "lunch", "dinner"]);

weekRoutes.post("/weeks/generate", async (c) => {
  const data = await body(
    c,
    z.object({
      start_date: z.string().refine(isISODate, "data non valida"),
      speeds: z.record(z.string(), z.enum(["quick", "long"])).default({}),
      reuse_favorites: z.boolean().default(false),
      pinned: z.array(z.object({ date: z.string(), slot: SLOT, recipe_id: z.string() })).max(21).default([]),
    }),
  );
  const provider = await providerFor(c);
  const weekId = await generateWeek(c.env.DB, provider, c.get("householdId"), {
    start_date: data.start_date,
    shopping_day: new Date(data.start_date + "T12:00:00Z").getUTCDay(),
    speeds: data.speeds as Record<string, Speed>,
    reuse_favorites: data.reuse_favorites,
    pinned: data.pinned,
  });
  const v = await buildWeekView(c.env.DB, c.get("householdId"), weekId, c.get("user").id);
  return c.json({ week: v }, 201);
});

/** "Non ci sono" / "Ci sono": aggiorna le presenze del pasto. */
weekRoutes.post("/meals/:id/absence", async (c) => {
  const data = await body(c, z.object({ user_id: z.string().optional(), absent: z.boolean() }));
  const db = c.env.DB;
  const hid = c.get("householdId");
  const meal = await getMealRow(db, hid, c.req.param("id"));
  if (!meal) fail(404, "Pasto non trovato");
  const userId = data.user_id ?? c.get("user").id;
  const ctx = await loadHouseholdCtx(db, hid);
  if (!ctx.members.some((m) => m.id === userId)) fail(403, "Non è un membro del nucleo");
  if (data.absent) await run(db, "INSERT OR IGNORE INTO meal_absences (meal_id, user_id) VALUES (?, ?)", meal.id, userId);
  else await run(db, "DELETE FROM meal_absences WHERE meal_id = ? AND user_id = ?", meal.id, userId);
  const abs = (await mealAbsences(db, [meal.id])).get(meal.id) ?? [];
  const { present } = presence(meal.slot, ctx.members, abs);
  await run(db, "UPDATE meals SET status = ? WHERE id = ?", present.length ? "planned" : "skipped", meal.id);
  return c.json({ meal: await mealView(c, meal.id) });
});

/** Scegli tu: imposta una ricetta del nucleo (con controllo di sicurezza). null = svuota. */
weekRoutes.put("/meals/:id/recipe", async (c) => {
  const data = await body(c, z.object({ recipe_id: z.string().nullable(), pinned: z.boolean().optional() }));
  const db = c.env.DB;
  const hid = c.get("householdId");
  const meal = await getMealRow(db, hid, c.req.param("id"));
  if (!meal) fail(404, "Pasto non trovato");
  if (data.recipe_id) {
    const r = await getRecipe(db, hid, data.recipe_id);
    if (!r) fail(404, "Ricetta non trovata");
    const ctx = await loadHouseholdCtx(db, hid);
    const abs = (await mealAbsences(db, [meal.id])).get(meal.id) ?? [];
    const { present } = presence(meal.slot, ctx.members, abs);
    const v = violationsFor(ctx, present, r.ingredients, r.dish_family);
    if (v.length) fail(422, `Non si può: ${describeViolations(ctx, v).join("; ")}`);
  }
  await run(db, "UPDATE meals SET recipe_id = ?, pinned = ? WHERE id = ?", data.recipe_id, data.pinned ?? false, meal.id);
  return c.json({ meal: await mealView(c, meal.id) });
});

/**
 * Sostituzione senza apprendimento (es. il pasto ora viola i vincoli di chi è tornato).
 * Usata anche internamente da "Non mi piace".
 */
export async function replaceMealFor(c: Context<AppEnv>, mealId: string, reason: string | undefined) {
  const db = c.env.DB;
  const hid = c.get("householdId");
  const meal = await getMealRow(db, hid, mealId);
  if (!meal) fail(404, "Pasto non trovato");
  const ctx = await loadHouseholdCtx(db, hid);
  const abs = (await mealAbsences(db, [meal.id])).get(meal.id) ?? [];
  const { present } = presence(meal.slot, ctx.members, abs);
  if (!present.length) fail(409, "Nessuno è presente a questo pasto");

  const weekTitles = await all<{ title: string }>(
    db,
    "SELECT r.title FROM meals m JOIN recipes r ON r.id = m.recipe_id WHERE m.week_id = ?",
    meal.week_id,
  );
  const own = await householdOwnRecipes(db, hid);
  // Prima della spesa: ingredienti già in lista; dopo: in dispensa
  const prefer =
    meal.week_status === "shopped"
      ? (await pantryForPrompt(db, hid)).map((p) => p.ingredient)
      : await shoppingIngredientNames(db, meal.week_id);
  const provider = await providerFor(c);
  const { candidate } = await resolveMeal(db, provider, ctx, { date: meal.date, slot: meal.slot, speed: meal.speed, present }, null, {
    avoidTitles: weekTitles.map((t) => t.title),
    avoidFamilies: [],
    preferIngredients: prefer.slice(0, 40),
    known: new Map(own.map((r) => [r.id, r])),
    reason,
    maxReplacements: 3,
  });
  let recipeId: string | null = null;
  const statements: D1PreparedStatement[] = [];
  if (candidate) {
    const ins = recipeInsert(db, hid, candidate);
    if (ins.stmt) statements.push(ins.stmt);
    recipeId = ins.id;
  }
  statements.push(stmt(db, "UPDATE meals SET recipe_id = ?, pinned = 0, status = 'planned' WHERE id = ?", recipeId, meal.id));
  await db.batch(statements);
  return mealView(c, meal.id);
}

weekRoutes.post("/meals/:id/replace", async (c) => {
  const meal = await replaceMealFor(c, c.req.param("id"), "il piatto non va più bene per chi è presente");
  return c.json({ meal });
});
