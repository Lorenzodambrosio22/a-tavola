import type { Recipe } from "../../shared/types";
import type { AiProvider } from "../ai";
import { all, run } from "../db/sql";
import { RECIPE_COLS, rowToRecipe, type RecipeRow } from "./context";
import { fetchRecipePage, type RecipePage } from "./recipeImages";
import { searchRecipeUrl } from "./recipeSearch";

/**
 * Dettaglio ricetta (§6.4). Prima la pagina originale trovata con la ricerca diretta su
 * GialloZafferano: link, foto e procedimento senza AI. Solo con un provider (apertura
 * esplicita del piatto) e se la pagina non basta: procedimento con writeRecipe e link con
 * findSourceUrl. Senza link la ricetta resta 'none' e si riprova alla prossima apertura.
 */
export async function ensureDetails(db: D1Database, provider: AiProvider | null, recipe: Recipe): Promise<Recipe> {
  if (recipe.details_status === "ready") return recipe;
  if (recipe.kind === "own_known" || recipe.kind === "own") return recipe;

  let steps = recipe.steps;
  let url = recipe.source_url ?? (await searchRecipeUrl(recipe.title).catch(() => null));
  let page: RecipePage | null = url ? await fetchRecipePage(url) : null;
  steps ??= page?.steps ?? null;

  if (provider && !steps) {
    const out = await provider.writeRecipe({ title: recipe.title, servings: recipe.servings, ingredients: recipe.ingredients });
    steps = out.steps;
  }
  if (provider && !url) {
    try {
      url = await provider.findSourceUrl(recipe.title);
    } catch {
      url = null;
    }
    if (url) page = await fetchRecipePage(url);
  }
  const status = url ? "ready" : "none";
  const image = page?.image ?? recipe.image_url ?? null;
  await run(
    db,
    "UPDATE recipes SET steps = ?, source_url = ?, details_status = ?, image_url = ?, image_checked_at = ? WHERE id = ?",
    steps,
    url,
    status,
    image,
    new Date().toISOString(),
    recipe.id,
  );
  return { ...recipe, steps, source_url: url, details_status: status, image_url: image };
}

const RETRY_MS = 86_400_000;

/**
 * Prepara in background foto e procedimento dei piatti generati, così il menù mostra le foto
 * senza aprire ogni ricetta. Mai AI; un tentativo fallito si ripete solo dopo un giorno.
 */
export async function prepareRecipes(db: D1Database, recipeIds: string[]): Promise<void> {
  const ids = [...new Set(recipeIds)].slice(0, 21);
  if (!ids.length) return;
  const rows = await all<RecipeRow>(
    db,
    `SELECT ${RECIPE_COLS} FROM recipes
      WHERE id IN (${ids.map(() => "?").join(",")}) AND kind = 'generated' AND details_status = 'none'
        AND (image_checked_at IS NULL OR image_checked_at < ?)`,
    ...ids,
    new Date(Date.now() - RETRY_MS).toISOString(),
  );
  for (const row of rows) {
    await ensureDetails(db, null, rowToRecipe(row)).catch((e) => console.warn("prepareRecipes", (e as Error).message));
  }
}
