import type { Ingredient, Member, Recipe } from "../../shared/types";
import { TASTE_DISHES } from "../../shared/tastes";
import { mergePresentConstraints, type AllergenGroups, type BlockedRow, type ConstraintRow } from "../../domain/constraints";
import type { RecurringAbsenceRow } from "../../domain/week";
import { listMembers } from "../db/household";
import { all } from "../db/sql";
import type { PersonPrefs } from "../ai";
import { getAllergenGroups } from "./ingredients";

export interface HouseholdCtx {
  householdId: string;
  members: Member[];
  constraints: ConstraintRow[];
  blocked: BlockedRow[];
  groups: AllergenGroups;
  recurring: RecurringAbsenceRow[];
  tastes: { user_id: string; dish_id: string }[];
}

export async function loadHouseholdCtx(db: D1Database, householdId: string): Promise<HouseholdCtx> {
  const members = await listMembers(db, householdId);
  const ids = members.map((m) => m.id);
  const ph = ids.map(() => "?").join(",");
  const [constraints, blocked, recurring, groups, tastes] = await Promise.all([
    all<ConstraintRow>(db, `SELECT user_id, ingredient, level FROM food_constraints WHERE user_id IN (${ph})`, ...ids),
    all<BlockedRow>(db, `SELECT user_id, dish_family FROM blocked_dishes WHERE user_id IN (${ph})`, ...ids),
    all<RecurringAbsenceRow>(db, `SELECT user_id, weekday, slot FROM recurring_absences WHERE user_id IN (${ph})`, ...ids),
    getAllergenGroups(db),
    all<{ user_id: string; dish_id: string }>(db, `SELECT user_id, dish_id FROM taste_dishes WHERE user_id IN (${ph})`, ...ids),
  ]);
  return { householdId, members, constraints, blocked, groups, recurring, tastes };
}

export function displayName(m: Pick<Member, "name" | "email">): string {
  return m.name?.trim() || m.email.split("@")[0];
}

/** Vincoli per persona (solo presenti), nel formato per il prompt. */
export function peoplePrefs(ctx: HouseholdCtx, presentIds: string[]): PersonPrefs[] {
  return ctx.members
    .filter((m) => presentIds.includes(m.id))
    .map((m) => {
      const merged = mergePresentConstraints([m.id], ctx.constraints, ctx.blocked, ctx.groups);
      return {
        name: displayName(m),
        forbidden: merged.forbidden,
        little: merged.little,
        dislike: merged.dislike,
        blocked_dishes: merged.blockedDishes,
        liked_dishes: TASTE_DISHES.filter((d) => ctx.tastes.some((t) => t.user_id === m.id && t.dish_id === d.id)).map((d) => d.title),
      };
    });
}

export function namesOf(ctx: HouseholdCtx, ids: string[]): string[] {
  return ctx.members.filter((m) => ids.includes(m.id)).map(displayName);
}

interface RecipeRow {
  id: string;
  household_id: string;
  title: string;
  dish_family: string;
  minutes: number;
  servings: number;
  ingredients: string;
  steps: string | null;
  source_url: string | null;
  image_url: string | null;
  kind: Recipe["kind"];
  details_status: Recipe["details_status"];
}

export function rowToRecipe(r: RecipeRow): Recipe {
  let ingredients: Ingredient[] = [];
  try {
    ingredients = JSON.parse(r.ingredients);
  } catch {
    ingredients = [];
  }
  return {
    id: r.id,
    title: r.title,
    dish_family: r.dish_family,
    minutes: r.minutes,
    servings: r.servings,
    ingredients,
    steps: r.steps,
    source_url: r.source_url,
    image_url: r.image_url,
    kind: r.kind,
    details_status: r.details_status,
  };
}

const RECIPE_COLS = "id, household_id, title, dish_family, minutes, servings, ingredients, steps, source_url, image_url, kind, details_status";

export async function getRecipe(db: D1Database, householdId: string, id: string): Promise<Recipe | null> {
  const rows = await all<RecipeRow>(db, `SELECT ${RECIPE_COLS} FROM recipes WHERE id = ? AND household_id = ?`, id, householdId);
  return rows[0] ? rowToRecipe(rows[0]) : null;
}

export async function getRecipesByIds(db: D1Database, ids: string[]): Promise<Map<string, Recipe>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await all<RecipeRow>(db, `SELECT ${RECIPE_COLS} FROM recipes WHERE id IN (${uniq.map(() => "?").join(",")})`, ...uniq);
  return new Map(rows.map((r) => [r.id, rowToRecipe(r)]));
}

/** Ricette proprie del nucleo (non generate). */
export async function householdOwnRecipes(db: D1Database, householdId: string): Promise<Recipe[]> {
  const rows = await all<RecipeRow>(
    db,
    `SELECT ${RECIPE_COLS} FROM recipes WHERE household_id = ? AND kind != 'generated' ORDER BY title`,
    householdId,
  );
  return rows.map(rowToRecipe);
}
