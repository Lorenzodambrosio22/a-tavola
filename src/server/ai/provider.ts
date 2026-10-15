import type { z } from "zod";
import { normalizeName } from "../../domain/text";
import {
  estimatePrompt,
  mapPrompt,
  recipePrompt,
  RECIPE_DOMAINS,
  replacePrompt,
  SYSTEM_ESTIMATE,
  SYSTEM_MAP,
  SYSTEM_PLANNER,
  SYSTEM_RECIPE,
  weekPrompt,
} from "./prompts";
import {
  AiInvalidOutput,
  AiUnavailable,
  IngredientEstimateSchema,
  IngredientMapSchema,
  JSON_SCHEMAS,
  PlannedMealSchema,
  RecipeStepsSchema,
  WeekPlanSchema,
  type AiProvider,
  type LlmBackend,
  type Task,
  type Usage,
} from "./types";

/** Estrae il primo oggetto JSON dal testo (tollera ```json … ``` e testo intorno). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* prosegui */
  }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* prosegui */
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* niente */
    }
  }
  throw new AiInvalidOutput("JSON non valido");
}

/** Sceglie il link: solo URL presenti nei risultati di ricerca, mai uno scritto dal modello. */
export function pickSourceUrl(candidates: string[], chosen: string | null): string | null {
  const valid = candidates.filter((u) => /^https?:\/\//i.test(u));
  if (!valid.length) return null;
  const norm = (u: string) => u.replace(/\/+$/, "").replace(/^http:/i, "https:");
  if (chosen) {
    const hit = valid.find((u) => norm(u) === norm(chosen));
    if (hit) return hit;
  }
  const onRecipeSite = valid.find((u) => {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "");
      return RECIPE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
    } catch {
      return false;
    }
  });
  return onRecipeSite ?? null;
}

/**
 * Provider basato su un backend LLM: costruisce i prompt, valida ogni risposta con zod
 * e in caso di risposta invalida fa un nuovo tentativo.
 */
export class LlmProvider implements AiProvider {
  constructor(private backend: LlmBackend) {}

  get name() {
    return this.backend.name;
  }
  get usage(): Usage {
    return this.backend.usage;
  }

  private async call<S extends z.ZodType>(task: Task, system: string, user: string, schema: S): Promise<z.infer<S>> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await this.backend.json(task, system, user, JSON_SCHEMAS[task]);
        const parsed = schema.safeParse(extractJson(text));
        if (parsed.success) return parsed.data;
        lastErr = new AiInvalidOutput(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new AiInvalidOutput(String(lastErr));
  }

  generateWeek(input: Parameters<AiProvider["generateWeek"]>[0]) {
    return this.call("week", SYSTEM_PLANNER, weekPrompt(input), WeekPlanSchema);
  }

  replaceMeal(input: Parameters<AiProvider["replaceMeal"]>[0]) {
    return this.call("meal", SYSTEM_PLANNER, replacePrompt(input), PlannedMealSchema);
  }

  writeRecipe(input: Parameters<AiProvider["writeRecipe"]>[0]) {
    return this.call("steps", SYSTEM_RECIPE, recipePrompt(input), RecipeStepsSchema);
  }

  async findSourceUrl(title: string): Promise<string | null> {
    const { candidates, chosen } = await this.backend.searchRecipe(title);
    return pickSourceUrl(candidates, chosen);
  }

  async mapIngredient(names: string[], known: string[]): Promise<Record<string, string>> {
    if (!names.length) return {};
    const out = await this.call("ingredientMap", SYSTEM_MAP, mapPrompt(names, known), IngredientMapSchema);
    const res: Record<string, string> = {};
    for (const it of out.items) {
      const k = normalizeName(it.input);
      const v = normalizeName(it.name);
      if (k && v && names.some((n) => normalizeName(n) === k)) res[k] = v;
    }
    return res;
  }

  estimateIngredients(title: string, servings: number) {
    return this.call("estimate", SYSTEM_ESTIMATE, estimatePrompt(title, servings), IngredientEstimateSchema);
  }
}

/**
 * Catena di provider (§10/§11): primario (già con un nuovo tentativo), poi l'altro provider,
 * poi errore "Riprova tra poco". findSourceUrl non lancia: restituisce null.
 */
export class FallbackProvider implements AiProvider {
  constructor(private chain: AiProvider[]) {
    if (!chain.length) throw new AiUnavailable("Nessun provider AI configurato.");
  }

  get name() {
    return this.chain[0].name;
  }
  get usage(): Usage {
    return this.chain.reduce(
      (a, p) => ({ calls: a.calls + p.usage.calls, input_tokens: a.input_tokens + p.usage.input_tokens, output_tokens: a.output_tokens + p.usage.output_tokens }),
      { calls: 0, input_tokens: 0, output_tokens: 0 },
    );
  }

  private async run<T>(fn: (p: AiProvider) => Promise<T>): Promise<T> {
    let last: unknown;
    for (const p of this.chain) {
      try {
        return await fn(p);
      } catch (e) {
        last = e;
        console.warn(`Provider ${p.name} fallito:`, (e as Error)?.message);
      }
    }
    console.error("Tutti i provider AI hanno fallito", last);
    throw new AiUnavailable();
  }

  generateWeek(i: Parameters<AiProvider["generateWeek"]>[0]) {
    return this.run((p) => p.generateWeek(i));
  }
  replaceMeal(i: Parameters<AiProvider["replaceMeal"]>[0]) {
    return this.run((p) => p.replaceMeal(i));
  }
  writeRecipe(i: Parameters<AiProvider["writeRecipe"]>[0]) {
    return this.run((p) => p.writeRecipe(i));
  }
  async findSourceUrl(title: string) {
    for (const p of this.chain) {
      try {
        const url = await p.findSourceUrl(title);
        if (url) return url;
      } catch (e) {
        console.warn(`Ricerca link con ${p.name} fallita:`, (e as Error)?.message);
      }
    }
    return null;
  }
  mapIngredient(names: string[], known: string[]) {
    return this.run((p) => p.mapIngredient(names, known));
  }
  estimateIngredients(title: string, servings: number) {
    return this.run((p) => p.estimateIngredients(title, servings));
  }
}
