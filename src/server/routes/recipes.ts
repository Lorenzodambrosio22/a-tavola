import { Hono } from "hono";
import { z } from "zod";
import type { Recipe } from "../../shared/types";
import { kcalPerServing } from "../../domain/nutrition";
import { scaleIngredients } from "../../domain/portions";
import { normalizeName } from "../../domain/text";
import type { AppEnv } from "../env";
import { body, fail } from "../http";
import { all, newId, run } from "../db/sql";
import { getRecipe, householdOwnRecipes, loadHouseholdCtx } from "../services/context";
import { getRef, kcalTable, normalizeIngredients } from "../services/ingredients";
import { ensureDetails } from "../services/recipes";
import { ensureRecipeImage } from "../services/recipeImages";
import { buildMealViews, type MealRow } from "../services/weekView";
import { providerFor } from "./weeks";

export const recipeRoutes = new Hono<AppEnv>();

async function withKcal(db: D1Database, r: Recipe): Promise<Recipe> {
  const k = kcalPerServing(r.ingredients, kcalTable(await getRef(db)), r.servings);
  return { ...r, kcal: k.kcal, kcal_partial: k.partial };
}

recipeRoutes.get("/recipes", async (c) => {
  const db = c.env.DB;
  const own = await householdOwnRecipes(db, c.get("householdId"));
  const favRows = await all<{ recipe_id: string }>(db, "SELECT recipe_id FROM favorites WHERE user_id = ?", c.get("user").id);
  const fav = new Set(favRows.map((f) => f.recipe_id));
  // Preferiti anche tra le ricette generate
  const favGenerated = await all<{ id: string; title: string; minutes: number }>(
    db,
    `SELECT r.id, r.title, r.minutes FROM favorites f JOIN recipes r ON r.id = f.recipe_id
      WHERE f.user_id = ? AND r.household_id = ? AND r.kind = 'generated' ORDER BY r.title`,
    c.get("user").id,
    c.get("householdId"),
  );
  return c.json({
    recipes: await Promise.all(own.map(async (r) => ({ ...(await withKcal(db, r)), favorite: fav.has(r.id) }))),
    favorites: favGenerated,
  });
});

/** Dettaglio ricetta; con ?meal=ID scala ingredienti e calorie sui presenti di quel pasto. */
recipeRoutes.get("/recipes/:id", async (c) => {
  const db = c.env.DB;
  const hid = c.get("householdId");
  let recipe = await getRecipe(db, hid, c.req.param("id"));
  if (!recipe) fail(404, "Ricetta non trovata");
  let detailsError: string | null = null;
  if (recipe.details_status === "none" && (recipe.kind === "generated" || recipe.kind === "own_ai")) {
    try {
      recipe = await ensureDetails(db, await providerFor(c), recipe, hid);
    } catch (e) {
      detailsError = "Procedimento non disponibile ora. Riprova tra poco.";
      console.warn("ensureDetails", (e as Error).message);
    }
  }
  recipe = await ensureRecipeImage(db, recipe);
  const fav = await all(db, "SELECT 1 FROM favorites WHERE user_id = ? AND recipe_id = ?", c.get("user").id, recipe.id);
  const full = { ...(await withKcal(db, recipe)), favorite: fav.length > 0 };

  const mealId = c.req.query("meal");
  let meal = null;
  let scaled = null;
  if (mealId) {
    const rows = await all<MealRow>(
      db,
      `SELECT m.id, m.week_id, m.date, m.slot, m.recipe_id, m.speed, m.pinned, m.status FROM meals m JOIN weeks w ON w.id = m.week_id
        WHERE m.id = ? AND w.household_id = ?`,
      mealId,
      hid,
    );
    if (rows.length) {
      const ctx = await loadHouseholdCtx(db, hid);
      meal = (await buildMealViews(db, ctx, rows, c.get("user").id))[0];
      scaled = scaleIngredients(recipe.ingredients, meal.present.length, recipe.servings);
    }
  }
  return c.json({ recipe: full, meal, scaled_ingredients: scaled, details_error: detailsError });
});

const IngredientIn = z.object({ name: z.string().trim().min(1).max(80), grams: z.coerce.number().positive().max(10000) });

const CreateRecipe = z.discriminatedUnion("mode", [
  // Scritta: ingredienti e procedimento dell'utente
  z.object({
    mode: z.literal("own"),
    title: z.string().trim().min(2).max(120),
    servings: z.number().int().min(1).max(30),
    minutes: z.number().int().min(1).max(600),
    dish_family: z.string().trim().max(60).optional(),
    ingredients: z.array(IngredientIn).min(1).max(40),
    steps: z.string().trim().max(8000).optional(),
  }),
  // Trova tu: l'AI stima ingredienti, scrive il procedimento e cerca il link
  z.object({ mode: z.literal("own_ai"), title: z.string().trim().min(2).max(120), servings: z.number().int().min(1).max(30) }),
  // La so io: solo titolo, ingredienti stimati una volta per la spesa (correggibili)
  z.object({ mode: z.literal("own_known"), title: z.string().trim().min(2).max(120), servings: z.number().int().min(1).max(30) }),
]);

recipeRoutes.post("/recipes", async (c) => {
  const data = await body(c, CreateRecipe);
  const db = c.env.DB;
  const hid = c.get("householdId");
  const id = newId();
  if (data.mode === "own") {
    const provider = await providerFor(c).catch(() => null);
    const ingredients = await normalizeIngredients(db, provider, data.ingredients);
    await run(
      db,
      `INSERT INTO recipes (id, household_id, title, dish_family, minutes, servings, ingredients, steps, kind, details_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'own', 'ready')`,
      id,
      hid,
      data.title,
      normalizeName(data.dish_family || data.title),
      data.minutes,
      data.servings,
      JSON.stringify(ingredients),
      data.steps || null,
    );
  } else {
    const provider = await providerFor(c);
    const est = await provider.estimateIngredients(data.title, data.servings);
    const ingredients = await normalizeIngredients(db, provider, est.ingredients);
    await run(
      db,
      `INSERT INTO recipes (id, household_id, title, dish_family, minutes, servings, ingredients, kind, details_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      hid,
      data.title,
      normalizeName(est.dish_family),
      est.minutes,
      data.servings,
      JSON.stringify(ingredients),
      data.mode,
      data.mode === "own_known" ? "ready" : "none",
    );
    if (data.mode === "own_ai") {
      // Stesso flusso del dettaglio: procedimento + link reale
      const r = await getRecipe(db, hid, id);
      if (r) await ensureDetails(db, provider, r, hid).then((ready) => ensureRecipeImage(db, ready)).catch((e) => console.warn("ensureDetails", (e as Error).message));
    }
  }
  const r = await getRecipe(db, hid, id);
  return c.json({ recipe: r && (await withKcal(db, r)) }, 201);
});

recipeRoutes.patch("/recipes/:id", async (c) => {
  const data = await body(
    c,
    z.object({
      title: z.string().trim().min(2).max(120).optional(),
      servings: z.number().int().min(1).max(30).optional(),
      minutes: z.number().int().min(1).max(600).optional(),
      dish_family: z.string().trim().min(1).max(60).optional(),
      ingredients: z.array(IngredientIn).min(1).max(40).optional(),
      steps: z.string().trim().max(8000).nullable().optional(),
    }),
  );
  const db = c.env.DB;
  const hid = c.get("householdId");
  const r = await getRecipe(db, hid, c.req.param("id"));
  if (!r) fail(404, "Ricetta non trovata");
  const ingredients = data.ingredients ? await normalizeIngredients(db, await providerFor(c).catch(() => null), data.ingredients) : r.ingredients;
  await run(
    db,
    "UPDATE recipes SET title = ?, servings = ?, minutes = ?, dish_family = ?, ingredients = ?, steps = ? WHERE id = ? AND household_id = ?",
    data.title ?? r.title,
    data.servings ?? r.servings,
    data.minutes ?? r.minutes,
    data.dish_family ? normalizeName(data.dish_family) : r.dish_family,
    JSON.stringify(ingredients),
    data.steps !== undefined ? data.steps : r.steps,
    r.id,
    hid,
  );
  const updated = await getRecipe(db, hid, r.id);
  return c.json({ recipe: updated && (await withKcal(db, updated)) });
});

recipeRoutes.delete("/recipes/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM recipes WHERE id = ? AND household_id = ? AND kind != 'generated'", c.req.param("id"), c.get("householdId"));
  return c.json({ ok: true });
});

recipeRoutes.put("/recipes/:id/favorite", async (c) => {
  const { favorite } = await body(c, z.object({ favorite: z.boolean() }));
  const db = c.env.DB;
  const r = await getRecipe(db, c.get("householdId"), c.req.param("id"));
  if (!r) fail(404, "Ricetta non trovata");
  if (favorite) await run(db, "INSERT OR IGNORE INTO favorites (user_id, recipe_id) VALUES (?, ?)", c.get("user").id, r.id);
  else await run(db, "DELETE FROM favorites WHERE user_id = ? AND recipe_id = ?", c.get("user").id, r.id);
  return c.json({ favorite });
});
