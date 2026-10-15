import { Hono } from "hono";
import { z } from "zod";
import type { RejectReason } from "../../shared/types";
import { rejectionEffects, repeatedRejectionSuggestions, type ExistingConstraint } from "../../domain/learning";
import { normalizeName } from "../../domain/text";
import { presence } from "../../domain/week";
import type { AppEnv } from "../env";
import { body, fail } from "../http";
import { all, newId, run, stmt } from "../db/sql";
import { getRecipe, loadHouseholdCtx } from "../services/context";
import { getMealRow, mealAbsences } from "../services/weekView";
import { replaceMealFor } from "./weeks";

export const rejectionRoutes = new Hono<AppEnv>();

const REASON_TEXT: Record<RejectReason, string> = {
  today: "oggi non va",
  ingredient: "non piace un ingrediente",
  dish: "non piace questo tipo di piatto",
};

async function pendingQuestion(db: D1Database, userId: string): Promise<string | null> {
  const [rows, existing, dismissed] = await Promise.all([
    all<{ reason: RejectReason; created_at: string; recipe_ingredients: string }>(
      db,
      "SELECT reason, created_at, recipe_ingredients FROM rejections WHERE user_id = ? AND created_at >= datetime('now', '-30 days')",
      userId,
    ),
    all<ExistingConstraint>(db, "SELECT ingredient, level FROM food_constraints WHERE user_id = ?", userId),
    all<{ ingredient: string }>(db, "SELECT ingredient FROM dismissed_questions WHERE user_id = ?", userId),
  ]);
  const past = rows.map((r) => {
    let ingredients: string[] = [];
    try {
      ingredients = JSON.parse(r.recipe_ingredients);
    } catch {
      /* vuoto */
    }
    return { reason: r.reason, created_at: r.created_at, ingredients };
  });
  return repeatedRejectionSuggestions(past, new Date(), existing, dismissed.map((d) => d.ingredient))[0] ?? null;
}

/** "Non mi piace": registra, impara, sostituisce subito. Solo un presente può rifiutare. */
rejectionRoutes.post("/meals/:id/reject", async (c) => {
  const data = await body(
    c,
    z
      .object({
        reason: z.enum(["today", "ingredient", "dish"]),
        ingredients: z.array(z.string().min(1).max(80)).max(20).default([]),
      })
      .refine((d) => d.reason !== "ingredient" || d.ingredients.length > 0, "scegli almeno un ingrediente"),
  );
  const db = c.env.DB;
  const hid = c.get("householdId");
  const user = c.get("user");
  const meal = await getMealRow(db, hid, c.req.param("id"));
  if (!meal) fail(404, "Pasto non trovato");
  if (!meal.recipe_id) fail(409, "Il pasto non ha un piatto da rifiutare");
  const ctx = await loadHouseholdCtx(db, hid);
  const abs = (await mealAbsences(db, [meal.id])).get(meal.id) ?? [];
  if (!presence(meal.slot, ctx.members, abs).present.includes(user.id)) fail(403, "Solo chi è presente al pasto può rifiutarlo");

  const recipe = await getRecipe(db, hid, meal.recipe_id);
  if (!recipe) fail(404, "Ricetta non trovata");
  const recipeNames = recipe.ingredients.map((i) => i.name);
  const chosen = data.ingredients.map(normalizeName);
  if (data.reason === "ingredient" && !chosen.every((n) => recipeNames.includes(n))) {
    fail(400, "Gli ingredienti devono essere tra quelli del piatto");
  }

  const existing = await all<ExistingConstraint>(db, "SELECT ingredient, level FROM food_constraints WHERE user_id = ?", user.id);
  const effects = rejectionEffects(data.reason, chosen, recipe.dish_family, existing);
  await db.batch([
    stmt(
      db,
      "INSERT INTO rejections (id, user_id, meal_id, recipe_id, reason, ingredient, recipe_ingredients) VALUES (?, ?, ?, ?, ?, ?, ?)",
      newId(),
      user.id,
      meal.id,
      recipe.id,
      data.reason,
      data.reason === "ingredient" ? chosen.join(", ") : null,
      JSON.stringify(recipeNames),
    ),
    ...effects.dislikes.map((ing) =>
      stmt(
        db,
        `INSERT INTO food_constraints (id, user_id, ingredient, level, source) VALUES (?, ?, ?, 'dislike', 'learned')
         ON CONFLICT (user_id, ingredient) DO NOTHING`,
        newId(),
        user.id,
        ing,
      ),
    ),
    ...(effects.blockDish
      ? [stmt(db, "INSERT OR IGNORE INTO blocked_dishes (user_id, dish_family) VALUES (?, ?)", user.id, effects.blockDish)]
      : []),
  ]);

  const reasonText =
    data.reason === "ingredient"
      ? `a una persona non piace: ${chosen.join(", ")}`
      : data.reason === "dish"
        ? `a una persona non piacciono i piatti di tipo «${recipe.dish_family}»`
        : `${REASON_TEXT.today}: proponi qualcosa di diverso da «${recipe.title}»`;
  const updated = await replaceMealFor(c, meal.id, reasonText);

  const question = data.reason === "today" ? await pendingQuestion(db, user.id) : null;
  return c.json({ meal: updated, learned: effects, question: question ? { ingredient: question } : null });
});

/** Risposta a "Forse non ti piace X?" */
rejectionRoutes.post("/learning/answer", async (c) => {
  const { ingredient, yes } = await body(c, z.object({ ingredient: z.string().min(1).max(80), yes: z.boolean() }));
  const db = c.env.DB;
  const user = c.get("user");
  const ing = normalizeName(ingredient);
  if (yes) {
    await run(
      db,
      `INSERT INTO food_constraints (id, user_id, ingredient, level, source) VALUES (?, ?, ?, 'dislike', 'learned')
       ON CONFLICT (user_id, ingredient) DO NOTHING`,
      newId(),
      user.id,
      ing,
    );
  } else {
    await run(db, "INSERT OR IGNORE INTO dismissed_questions (user_id, ingredient) VALUES (?, ?)", user.id, ing);
  }
  return c.json({ ok: true });
});
