import { allocateConsumption } from "../../domain/pantry";
import { scaleIngredients } from "../../domain/portions";
import type { PantryItem } from "../../shared/types";
import { all, stmt } from "../db/sql";
import { buildWeekView } from "./weekView";

/** Rientra in sicurezza dopo un retry. Ogni pasto viene scalato una sola volta. */
export async function consumePastMeals(db: D1Database, throughDate: string): Promise<number> {
  const rows = await all<{ week_id: string; household_id: string; user_id: string }>(db, `
    SELECT DISTINCT w.id AS week_id, w.household_id, hm.user_id FROM weeks w
    JOIN household_members hm ON hm.household_id = w.household_id AND hm.role = 'owner'
    JOIN meals m ON m.week_id = w.id
    WHERE w.status = 'shopped' AND m.date <= ? AND m.status = 'planned' AND m.recipe_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pantry_consumptions pc WHERE pc.meal_id = m.id)
    ORDER BY w.start_date`, throughDate);
  let processed = 0;
  for (const row of rows) {
    const week = await buildWeekView(db, row.household_id, row.week_id, row.user_id);
    if (!week) continue;
    for (const meal of week.meals) {
      if (meal.date > throughDate || meal.status !== "planned" || !meal.recipe) continue;
      const pantry = await all<PantryItem>(db, "SELECT * FROM pantry_items WHERE household_id = ? AND status = 'ok'", row.household_id);
      // Mantiene uno snapshot aggiornato anche se due ingredienti hanno lo stesso nome.
      const statements: D1PreparedStatement[] = [];
      for (const i of scaleIngredients(meal.recipe.ingredients, meal.present.length, meal.recipe.servings)) {
        const { allocations } = allocateConsumption(pantry, i.name, i.grams, meal.date);
        for (const a of allocations) {
          statements.push(stmt(db, `UPDATE pantry_items SET grams = MAX(0, grams - ?),
            status = CASE WHEN grams <= ? THEN 'used' ELSE status END
            WHERE id = ? AND household_id = ? AND status = 'ok'
            AND NOT EXISTS (SELECT 1 FROM pantry_consumptions WHERE meal_id = ?)`, a.grams, a.grams, a.id, row.household_id, meal.id));
          const lot = pantry.find((p) => p.id === a.id)!;
          lot.grams -= a.grams;
        }
      }
      statements.push(stmt(db, "INSERT OR IGNORE INTO pantry_consumptions (meal_id) VALUES (?)", meal.id));
      const results = await db.batch(statements);
      processed += results.at(-1)?.meta.changes ?? 0;
    }
  }
  return processed;
}
