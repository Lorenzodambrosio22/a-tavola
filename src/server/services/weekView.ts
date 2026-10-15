import type { MealView, Slot, Speed, WeekView } from "../../shared/types";
import { absentAllergenWarnings } from "../../domain/constraints";
import { kcalPerServing } from "../../domain/nutrition";
import { presence } from "../../domain/week";
import { all, first } from "../db/sql";
import { displayName, getRecipesByIds, loadHouseholdCtx, type HouseholdCtx } from "./context";
import { getRef, kcalTable, namesForCheck } from "./ingredients";
import { describeViolations, NO_VALID_PROPOSAL, violationsFor } from "./menu";

export interface MealRow {
  id: string;
  week_id: string;
  date: string;
  slot: Slot;
  recipe_id: string | null;
  speed: Speed;
  pinned: number;
  status: "planned" | "skipped";
}

export interface WeekRow {
  id: string;
  household_id: string;
  start_date: string;
  shopping_day: number;
  status: "draft" | "shopped";
  provider: string | null;
}

const SLOT_ORDER: Record<Slot, number> = { breakfast: 0, lunch: 1, dinner: 2 };

export async function getWeekRow(db: D1Database, householdId: string, weekId: string): Promise<WeekRow | null> {
  return first<WeekRow>(
    db,
    "SELECT id, household_id, start_date, shopping_day, status, provider FROM weeks WHERE id = ? AND household_id = ?",
    weekId,
    householdId,
  );
}

/** Pasto + settimana, verificando che appartenga al nucleo. */
export async function getMealRow(db: D1Database, householdId: string, mealId: string): Promise<(MealRow & { week_status: string; start_date: string }) | null> {
  return first(
    db,
    `SELECT m.id, m.week_id, m.date, m.slot, m.recipe_id, m.speed, m.pinned, m.status, w.status AS week_status, w.start_date
       FROM meals m JOIN weeks w ON w.id = m.week_id WHERE m.id = ? AND w.household_id = ?`,
    mealId,
    householdId,
  );
}

export async function mealAbsences(db: D1Database, mealIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!mealIds.length) return out;
  const rows = await all<{ meal_id: string; user_id: string }>(
    db,
    `SELECT meal_id, user_id FROM meal_absences WHERE meal_id IN (${mealIds.map(() => "?").join(",")})`,
    ...mealIds,
  );
  for (const r of rows) out.set(r.meal_id, [...(out.get(r.meal_id) ?? []), r.user_id]);
  return out;
}

export async function buildMealViews(db: D1Database, ctx: HouseholdCtx, meals: MealRow[], userId: string): Promise<MealView[]> {
  const [absences, recipes, ref, favs] = await Promise.all([
    mealAbsences(db, meals.map((m) => m.id)),
    getRecipesByIds(db, meals.map((m) => m.recipe_id ?? "")),
    getRef(db),
    all<{ recipe_id: string }>(db, "SELECT recipe_id FROM favorites WHERE user_id = ?", userId),
  ]);
  const kcal = kcalTable(ref);
  const favSet = new Set(favs.map((f) => f.recipe_id));
  return meals
    .map((m): MealView => {
      const { present, absent } = presence(m.slot, ctx.members, absences.get(m.id) ?? []);
      const r = m.recipe_id ? recipes.get(m.recipe_id) : undefined;
      const k = r ? kcalPerServing(r.ingredients, kcal, r.servings) : null;
      const warnings = r
        ? absentAllergenWarnings({ ingredients: namesForCheck(r.ingredients), dish_family: r.dish_family }, absent, ctx.constraints, ctx.groups).map((w) => {
            const mem = ctx.members.find((x) => x.id === w.user_id);
            return { ...w, name: mem ? displayName(mem) : "?" };
          })
        : [];
      const violations = r && m.status === "planned" ? describeViolations(ctx, violationsFor(ctx, present, r.ingredients, r.dish_family)) : [];
      return {
        id: m.id,
        date: m.date,
        slot: m.slot,
        speed: m.speed,
        pinned: !!m.pinned,
        status: m.status,
        recipe: r ? { id: r.id, title: r.title, minutes: r.minutes, servings: r.servings, dish_family: r.dish_family, ingredients: r.ingredients } : null,
        kcal: k?.kcal ?? null,
        kcal_partial: k?.partial ?? false,
        present,
        absent,
        warnings,
        violations,
        favorite: r ? favSet.has(r.id) : false,
        message: !r && m.status === "planned" ? NO_VALID_PROPOSAL : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
}

export async function buildWeekView(db: D1Database, householdId: string, weekId: string, userId: string): Promise<WeekView | null> {
  const week = await getWeekRow(db, householdId, weekId);
  if (!week) return null;
  const ctx = await loadHouseholdCtx(db, householdId);
  const meals = await all<MealRow>(
    db,
    "SELECT id, week_id, date, slot, recipe_id, speed, pinned, status FROM meals WHERE week_id = ?",
    weekId,
  );
  return {
    id: week.id,
    start_date: week.start_date,
    shopping_day: week.shopping_day,
    status: week.status,
    provider: week.provider,
    meals: await buildMealViews(db, ctx, meals, userId),
    members: ctx.members,
  };
}
