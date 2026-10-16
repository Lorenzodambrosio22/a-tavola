import { z } from "zod";
import type { Slot, Speed } from "../../shared/types";

// ---------- Input ----------

export interface PersonPrefs {
  name: string;
  /** allergie + mai (gruppi allergeni già espansi): vietati */
  forbidden: string[];
  little: string[];
  dislike: string[];
  blocked_dishes: string[];
  /** Esempi di gusto, senza obbligo di riproporli o escludere gli altri piatti. */
  liked_dishes: string[];
}

export interface MealSlotRequest {
  date: string;
  slot: Slot;
  speed: Speed;
  present: string[]; // nomi
}

export interface HouseholdRecipeRef {
  id: string;
  title: string;
  minutes: number;
  ingredients: string[];
}

export interface WeekRequest {
  meals: MealSlotRequest[];
  people: PersonPrefs[];
  recent: { title: string; dish_family: string }[];
  household_recipes: HouseholdRecipeRef[];
  favorites: { id: string; title: string }[];
  /** ingredienti in dispensa, prima quelli in scadenza */
  pantry: { ingredient: string; expires_at: string }[];
}

export interface ReplaceRequest {
  meal: MealSlotRequest;
  people: PersonPrefs[];
  /** titoli da non riproporre (piatto rifiutato, resto della settimana) */
  avoid_titles: string[];
  avoid_dish_families: string[];
  /** ingredienti da preferire (già in lista / in dispensa) */
  prefer_ingredients: string[];
  household_recipes: HouseholdRecipeRef[];
  /** motivo della sostituzione, solo come contesto */
  reason?: string;
}

export interface RecipeRequest {
  title: string;
  servings: number;
  ingredients: { name: string; grams: number }[];
}

/** Contorno di un piatto la cui ricetta principale arriva da un sito. */
export interface SideRequest {
  dish: string;
  side: string;
  servings: number;
  ingredients: { name: string; grams: number }[];
}

// ---------- Output (validato con zod) ----------

const num = z.coerce.number();

export const IngredientOut = z.object({
  name: z.string().trim().min(1).max(80),
  grams: num.positive().max(10000),
});

export const PlannedMealSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["breakfast", "lunch", "dinner"]),
  recipe_id: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(2).max(120),
  dish_family: z.string().trim().min(1).max(60),
  minutes: num.int().min(1).max(600),
  servings: num.int().min(1).max(30),
  ingredients: z.array(IngredientOut).min(1).max(40),
});
export type PlannedMeal = z.infer<typeof PlannedMealSchema>;

export const WeekPlanSchema = z.object({ meals: z.array(PlannedMealSchema) });
export type WeekPlan = z.infer<typeof WeekPlanSchema>;

export const RecipeStepsSchema = z.object({ steps: z.string().trim().min(20).max(8000) });
export const SideStepsSchema = z.object({ steps: z.string().trim().min(10).max(3000) });

export const IngredientMapSchema = z.object({
  items: z.array(z.object({ input: z.string(), name: z.string() })),
});

export const IngredientEstimateSchema = z.object({
  dish_family: z.string().trim().min(1).max(60),
  minutes: num.int().min(1).max(600),
  ingredients: z.array(IngredientOut).min(1).max(40),
});
export type IngredientEstimate = z.infer<typeof IngredientEstimateSchema>;

// ---------- JSON Schema per structured outputs ----------

const ingredientJson = {
  type: "object",
  properties: { name: { type: "string" }, grams: { type: "number" } },
  required: ["name", "grams"],
  additionalProperties: false,
};

const mealJson = {
  type: "object",
  properties: {
    date: { type: "string", description: "YYYY-MM-DD" },
    slot: { type: "string", enum: ["breakfast", "lunch", "dinner"] },
    recipe_id: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "id di una ricetta del nucleo, altrimenti null",
    },
    title: { type: "string" },
    dish_family: { type: "string" },
    minutes: { type: "integer" },
    servings: { type: "integer" },
    ingredients: { type: "array", items: ingredientJson },
  },
  required: ["date", "slot", "recipe_id", "title", "dish_family", "minutes", "servings", "ingredients"],
  additionalProperties: false,
};

export const JSON_SCHEMAS = {
  week: {
    type: "object",
    properties: { meals: { type: "array", items: mealJson } },
    required: ["meals"],
    additionalProperties: false,
  },
  meal: mealJson,
  steps: {
    type: "object",
    properties: { steps: { type: "string" } },
    required: ["steps"],
    additionalProperties: false,
  },
  side: {
    type: "object",
    properties: { steps: { type: "string" } },
    required: ["steps"],
    additionalProperties: false,
  },
  ingredientMap: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { input: { type: "string" }, name: { type: "string" } },
          required: ["input", "name"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  estimate: {
    type: "object",
    properties: {
      dish_family: { type: "string" },
      minutes: { type: "integer" },
      ingredients: { type: "array", items: ingredientJson },
    },
    required: ["dish_family", "minutes", "ingredients"],
    additionalProperties: false,
  },
} as const;

// ---------- Interfaccia provider ----------

export interface Usage {
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AiProvider {
  readonly name: string;
  readonly usage: Usage;
  generateWeek(input: WeekRequest): Promise<WeekPlan>;
  replaceMeal(input: ReplaceRequest): Promise<PlannedMeal>;
  writeRecipe(input: RecipeRequest): Promise<{ steps: string }>;
  /** Pochi passaggi per il solo contorno (compito facile: Haiku). */
  writeSide(input: SideRequest): Promise<{ steps: string }>;
  findSourceUrl(title: string): Promise<string | null>;
  mapIngredient(names: string[], known: string[]): Promise<Record<string, string>>;
  /** Estensione: ingredienti stimati per ricette "trova tu"/"la so io" (§6.4). */
  estimateIngredients(title: string, servings: number): Promise<IngredientEstimate>;
}

export type Task = "week" | "meal" | "steps" | "side" | "ingredientMap" | "estimate";

/** Livello basso: un modello che risponde con testo JSON e (opzionalmente) cerca sul web. */
export interface LlmBackend {
  readonly name: string;
  readonly usage: Usage;
  json(task: Task, system: string, user: string, schema: object): Promise<string>;
  /** Ricerca ricetta: URL presenti nei risultati di ricerca + eventuale scelta del modello. */
  searchRecipe(title: string): Promise<{ candidates: string[]; chosen: string | null }>;
}

export class AiInvalidOutput extends Error {}
export class AiUnavailable extends Error {
  constructor(message = "Il servizio AI non è raggiungibile. Riprova tra poco.") {
    super(message);
  }
}
