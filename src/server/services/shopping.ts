import { all, newId, stmt } from "../db/sql";
import { getRecipesByIds } from "./context";
import { buildShoppingList, sortLines, type IngredientUse } from "../../domain/shopping";
import { scaleIngredients } from "../../domain/portions";
import type { ShoppingItem, ShoppingView } from "../../shared/types";
import { buildWeekView, getWeekRow } from "./weekView";
import { getRef } from "./ingredients";
import { fail } from "../http";

export async function shoppingView(db: D1Database, householdId: string, weekId: string, userId: string): Promise<ShoppingView> {
  const week = await getWeekRow(db, householdId, weekId);
  if (!week) fail(404, "Settimana non trovata");
  if (week.status === "draft") {
    const view = (await buildWeekView(db, householdId, weekId, userId))!;
    const ref = await getRef(db);
    const uses: IngredientUse[] = view.meals.flatMap((m) =>
      m.status === "planned" && m.recipe
        ? scaleIngredients(m.recipe.ingredients, m.present.length, m.recipe.servings).map((i) => ({ ingredient: i.name, grams: i.grams, date: m.date }))
        : [],
    );
    const fresh = buildShoppingList(uses, week.start_date, (name) => {
      const r = ref.get(name);
      return r ? { ...r, freezer_ok: !!r.freezer_ok } : undefined;
    });
    const existing = await all<{ id: string; ingredient: string; buy_on: string }>(db,
      "SELECT id, ingredient, buy_on FROM shopping_items WHERE week_id = ? AND manual = 0", weekId);
    const keys = new Set(fresh.map((f) => `${f.ingredient}|${f.buy_on}`));
    const statements = fresh.map((f) => stmt(db, `
      INSERT INTO shopping_items (id, week_id, ingredient, grams, unit_label, aisle, buy_on, frozen_hint)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM weeks WHERE id = ? AND status = 'draft')
      ON CONFLICT (week_id, ingredient, buy_on, manual) DO UPDATE SET
        grams = excluded.grams, unit_label = excluded.unit_label, aisle = excluded.aisle, frozen_hint = excluded.frozen_hint`,
      newId(), weekId, f.ingredient, f.grams, f.unit_label, f.aisle, f.buy_on, f.frozen_hint, weekId));
    for (const e of existing) if (!keys.has(`${e.ingredient}|${e.buy_on}`)) {
      statements.push(stmt(db, "DELETE FROM shopping_items WHERE id = ? AND EXISTS (SELECT 1 FROM weeks WHERE id = ? AND status = 'draft')", e.id, weekId));
    }
    if (statements.length) await db.batch(statements);
  }
  const rows = await all<ShoppingItem>(db, "SELECT id, ingredient, grams, unit_label, aisle, buy_on, frozen_hint, manual, checked FROM shopping_items WHERE week_id = ?", weekId);
  const current = (await getWeekRow(db, householdId, weekId))!;
  return { week_id: weekId, start_date: week.start_date, status: current.status,
    items: sortLines(rows.map((r) => ({ ...r, frozen_hint: !!r.frozen_hint, manual: !!r.manual, checked: !!r.checked }))) };
}

/** Ingredienti già "in lista" per la settimana: quelli dei pasti pianificati. */
export async function shoppingIngredientNames(db: D1Database, weekId: string): Promise<string[]> {
  const rows = await all<{ recipe_id: string }>(
    db,
    "SELECT recipe_id FROM meals WHERE week_id = ? AND status = 'planned' AND recipe_id IS NOT NULL",
    weekId,
  );
  const recipes = await getRecipesByIds(db, rows.map((r) => r.recipe_id));
  const names = new Set<string>();
  for (const r of recipes.values()) for (const i of r.ingredients) names.add(i.name);
  return [...names];
}
