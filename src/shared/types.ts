// Tipi condivisi tra API e frontend.

export type ConstraintLevel = "allergy" | "never" | "little" | "dislike";
export type ConstraintSource = "manual" | "learned";
export type Slot = "breakfast" | "lunch" | "dinner";
export type Speed = "quick" | "long";
export type RecipeKind = "own" | "own_ai" | "own_known" | "generated";
export type RejectReason = "today" | "ingredient" | "dish";
export type ProviderName = "claude" | "workersAi";

export const SLOTS: Slot[] = ["breakfast", "lunch", "dinner"];
export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Colazione",
  lunch: "Pranzo",
  dinner: "Cena",
};
export const LEVEL_LABEL: Record<ConstraintLevel, string> = {
  allergy: "Allergia",
  never: "Mai",
  little: "Poco",
  dislike: "Non mi piace",
};

export interface Member {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  breakfast: boolean;
}

export interface MeResponse {
  user: { id: string; name: string; email: string; breakfast: boolean; taste_dishes: string[] };
  household: { id: string; name: string; role: "owner" | "member"; provider: ProviderName | null };
  members: Member[];
  isAdmin: boolean;
  /** "pending" e "rejected" vedono solo la pagina di attesa. */
  access: "pending" | "approved" | "rejected";
  onboarded: boolean;
}

export interface FoodConstraint {
  id: string;
  ingredient: string;
  level: ConstraintLevel;
  source: ConstraintSource;
  created_at: string;
}

export interface RecurringAbsence {
  weekday: number;
  slot: Slot;
}

export interface Ingredient {
  name: string;
  grams: number;
  /** nome originale se diverso dal canonico (usato anche nel controllo allergie) */
  raw?: string;
}

export interface Recipe {
  id: string;
  title: string;
  dish_family: string;
  minutes: number;
  servings: number;
  ingredients: Ingredient[];
  steps: string | null;
  source_url: string | null;
  image_url?: string | null;
  kind: RecipeKind;
  details_status: "none" | "ready";
  favorite?: boolean;
  kcal?: number | null;
  kcal_partial?: boolean;
}

export interface AllergenWarning {
  user_id: string;
  name: string;
  allergen: string;
  ingredient: string;
}

export interface MealView {
  id: string;
  date: string;
  slot: Slot;
  speed: Speed;
  pinned: boolean;
  status: "planned" | "skipped";
  recipe: Pick<Recipe, "id" | "title" | "minutes" | "servings" | "dish_family" | "ingredients" | "image_url" | "source_url"> | null;
  kcal: number | null;
  kcal_partial: boolean;
  present: string[]; // user id presenti
  absent: string[];
  warnings: AllergenWarning[];
  /** Violazioni dei vincoli dei presenti (es. dopo il ritorno di una persona). */
  violations: string[];
  favorite: boolean;
  message: string | null;
}

export interface WeekView {
  id: string;
  start_date: string;
  shopping_day: number;
  status: "draft" | "shopped";
  provider: string | null;
  meals: MealView[];
  members: Member[];
}

export interface ShoppingItem {
  id: string;
  ingredient: string;
  grams: number;
  unit_label: string;
  aisle: string;
  buy_on: string;
  frozen_hint: boolean;
  manual: boolean;
  checked: boolean;
}

export interface ShoppingView {
  week_id: string;
  start_date: string;
  status: "draft" | "shopped";
  items: ShoppingItem[];
}

export interface PantryItem {
  id: string;
  ingredient: string;
  grams: number;
  bought_on: string;
  expires_at: string;
  status: "ok" | "used" | "trashed";
}
