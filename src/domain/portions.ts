import type { Ingredient } from "../shared/types";

/** Grammi mostrati = grammi ricetta × presenti / porzioni della ricetta. */
export function scaleGrams(grams: number, present: number, servings: number): number {
  if (servings <= 0 || present <= 0) return 0;
  const g = (grams * present) / servings;
  return g >= 10 ? Math.round(g) : Math.round(g * 10) / 10;
}

export function scaleIngredients(ingredients: Ingredient[], present: number, servings: number): Ingredient[] {
  return ingredients.map((i) => ({ ...i, grams: scaleGrams(i.grams, present, servings) }));
}
