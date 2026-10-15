import type { Ingredient, Recipe } from "../../shared/types";
import { adaptSiteIngredients } from "../../domain/recipeIngredients";
import type { AiProvider } from "../ai";
import { all, first, run } from "../db/sql";
import { loadHouseholdCtx, RECIPE_COLS, rowToRecipe, type RecipeRow } from "./context";
import { getRef, normalizeIngredients } from "./ingredients";
import { violationsFor } from "./menu";
import { fetchRecipePage, type RecipePage } from "./recipeImages";
import { ingredientWords, searchRecipeUrls } from "./recipeSearch";

interface SiteRecipe {
  url: string;
  page: RecipePage;
  /** Ingredienti del sito in grammi, scalati sulle porzioni della ricetta; null se non convertibili. */
  ingredients: Ingredient[] | null;
}

/** La ricetta del sito non deve contenere nulla di vietato a nessun membro del nucleo. */
async function pickSiteRecipe(db: D1Database, provider: AiProvider | null, householdId: string, recipe: Recipe, urls: string[]): Promise<SiteRecipe | null> {
  const ctx = await loadHouseholdCtx(db, householdId);
  const everyone = ctx.members.map((m) => m.id);
  for (const url of urls) {
    const page = await fetchRecipePage(url);
    if (!page?.steps) continue;
    const adapted = adaptSiteIngredients(page.ingredients, page.yield, recipe.servings);
    const lines = adapted?.allNames ?? page.ingredients;
    // I nomi dei siti ("Spalla di maiale senza osso") vanno ricondotti a quelli canonici: Haiku, con cache
    const names = await normalizeIngredients(db, provider, lines.map((name) => ({ name, grams: 0 })));
    if (violationsFor(ctx, everyone, names, recipe.dish_family).length) continue;
    const ingredients = adapted ? await normalizeIngredients(db, provider, adapted.ingredients) : null;
    return { url, page, ingredients: ingredients?.length ? ingredients : null };
  }
  return null;
}

/** Gli ingredienti si sostituiscono solo se nessuna settimana con questo piatto ha già fatto la spesa. */
async function canReplaceIngredients(db: D1Database, recipeId: string): Promise<boolean> {
  const shopped = await first<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM meals m JOIN weeks w ON w.id = m.week_id WHERE m.recipe_id = ? AND w.status <> 'draft'",
    recipeId,
  );
  return !shopped?.n;
}

/**
 * Dettaglio ricetta (§6.4), dal più economico al più costoso:
 * 1. ricetta vera da un sito (GialloZafferano, poi Benedetta): procedimento, foto e ingredienti
 *    scalati sulle porzioni, purché non contenga nulla di vietato al nucleo. Nessuna AI;
 * 2. altrimenti, con un provider, procedimento scritto dall'AI (Sonnet) e nessuna foto.
 * In background, se un sito non risponde, la ricetta resta 'none' e si riprova più tardi invece
 * di pagare l'AI; all'apertura esplicita del piatto si ripiega subito sull'AI.
 */
export async function ensureDetails(
  db: D1Database,
  provider: AiProvider | null,
  recipe: Recipe,
  householdId: string,
  opts: { background?: boolean } = {},
): Promise<Recipe> {
  if (recipe.details_status === "ready") return recipe;
  if (recipe.kind === "own_known" || recipe.kind === "own") return recipe;

  const search = recipe.source_url
    ? { urls: [recipe.source_url], incomplete: false }
    : await searchRecipeUrls(recipe.title, ingredientWords((await getRef(db)).keys()));
  const site = await pickSiteRecipe(db, provider, householdId, recipe, search.urls);

  let { steps, ingredients } = recipe;
  let url: string | null = null;
  let image = recipe.image_url ?? null;
  if (site) {
    url = site.url;
    steps = site.page.steps;
    image = site.page.image ?? image;
    if (site.ingredients && (await canReplaceIngredients(db, recipe.id))) ingredients = site.ingredients;
  } else if (provider && !steps && !(opts.background && search.incomplete)) {
    try {
      steps = (await provider.writeRecipe({ title: recipe.title, servings: recipe.servings, ingredients: recipe.ingredients })).steps;
    } catch (e) {
      // In background si registra solo il tentativo; all'apertura l'errore arriva all'utente
      if (!opts.background) throw e;
    }
  }
  const status = steps ? "ready" : "none";
  await run(
    db,
    `UPDATE recipes SET steps = ?, source_url = ?, details_status = ?, image_url = ?, image_checked_at = ?, ingredients = ?
      WHERE id = ? AND details_status = 'none'`,
    steps,
    url,
    status,
    image,
    new Date().toISOString(),
    JSON.stringify(ingredients),
    recipe.id,
  );
  return { ...recipe, steps, source_url: url, details_status: status, image_url: image, ingredients };
}

const RETRY_MS = 86_400_000;

/**
 * Prepara in background i piatti generati, così il menù mostra foto e ricette senza aprirle.
 * Un tentativo fallito (siti non raggiungibili) si ripete solo dopo un giorno.
 */
export async function prepareRecipes(db: D1Database, provider: AiProvider | null, householdId: string, recipeIds: string[]): Promise<void> {
  const ids = [...new Set(recipeIds)].slice(0, 21);
  if (!ids.length) return;
  const rows = await all<RecipeRow>(
    db,
    `SELECT ${RECIPE_COLS} FROM recipes
      WHERE id IN (${ids.map(() => "?").join(",")}) AND household_id = ? AND kind = 'generated' AND details_status = 'none'
        AND (image_checked_at IS NULL OR image_checked_at < ?)`,
    ...ids,
    householdId,
    new Date(Date.now() - RETRY_MS).toISOString(),
  );
  for (const row of rows) {
    await ensureDetails(db, provider, rowToRecipe(row), householdId, { background: true }).catch((e) => console.warn("prepareRecipes", (e as Error).message));
  }
}
