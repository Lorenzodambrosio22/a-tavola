import type { Recipe } from "../../shared/types";
import type { AiProvider } from "../ai";
import { run } from "../db/sql";

/**
 * Dettaglio ricetta alla prima apertura (§6.4): procedimento con writeRecipe, link reale
 * con findSourceUrl. Se il link non si trova, la ricetta resta senza link e si riprova
 * alla prossima apertura (details_status resta 'none' ma il procedimento è salvato).
 */
export async function ensureDetails(db: D1Database, provider: AiProvider, recipe: Recipe): Promise<Recipe> {
  if (recipe.details_status === "ready") return recipe;
  if (recipe.kind === "own_known" || recipe.kind === "own") return recipe;

  let steps = recipe.steps;
  if (!steps) {
    const out = await provider.writeRecipe({ title: recipe.title, servings: recipe.servings, ingredients: recipe.ingredients });
    steps = out.steps;
  }
  let url = recipe.source_url;
  if (!url) {
    try {
      url = await provider.findSourceUrl(recipe.title);
    } catch {
      url = null;
    }
  }
  const status = url ? "ready" : "none";
  await run(db, "UPDATE recipes SET steps = ?, source_url = ?, details_status = ? WHERE id = ?", steps, url, status, recipe.id);
  return { ...recipe, steps, source_url: url, details_status: status };
}
