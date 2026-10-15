import type { Ingredient } from "../shared/types";
import { normalizeName } from "./text";

export interface KcalResult {
  /** kcal per porzione, null se nessun ingrediente ha un valore */
  kcal: number | null;
  /** true se almeno un ingrediente è stato escluso perché senza valore */
  partial: boolean;
  missing: string[];
}

/**
 * kcal per porzione = Σ(grammi × kcal_100g / 100) / porzioni.
 * Ingredienti senza valore → esclusi e segnalati ("calorie parziali").
 */
export function kcalPerServing(ingredients: Ingredient[], kcalTable: Map<string, number | null>, servings: number): KcalResult {
  let total = 0;
  let known = 0;
  const missing: string[] = [];
  for (const ing of ingredients) {
    const v = kcalTable.get(normalizeName(ing.name));
    if (v === undefined || v === null) {
      missing.push(ing.name);
      continue;
    }
    total += (ing.grams * v) / 100;
    known++;
  }
  const s = servings > 0 ? servings : 1;
  return {
    kcal: known > 0 ? Math.round(total / s) : null,
    partial: missing.length > 0,
    missing,
  };
}
