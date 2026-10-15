import { setProviderFactory } from "../../src/server/ai";
import { LlmProvider } from "../../src/server/ai/provider";
import type { LlmBackend, Task, Usage } from "../../src/server/ai/types";
import week from "./week-2030-01-05.json";

export const RECORDED = {
  week: JSON.stringify(week),
  /** Sostituto valido (senza frutta a guscio) */
  replaceOk: (date: string, slot: string) =>
    JSON.stringify({
      date,
      slot,
      recipe_id: null,
      title: "Pasta al pomodoro e basilico",
      dish_family: "pasta al pomodoro",
      minutes: 20,
      servings: 2,
      ingredients: [
        { name: "pasta", grams: 180 },
        { name: "passata di pomodoro", grams: 250 },
        { name: "basilico", grams: 5 },
      ],
    }),
  /** Sostituto che viola ancora (nocciole) */
  replaceBad: (date: string, slot: string) =>
    JSON.stringify({
      date,
      slot,
      recipe_id: null,
      title: "Insalata con nocciole",
      dish_family: "insalata",
      minutes: 10,
      servings: 2,
      ingredients: [
        { name: "insalata mista", grams: 150 },
        { name: "nocciole tostate", grams: 30 },
      ],
    }),
  steps: JSON.stringify({ steps: "1. Porta a bollore l'acqua salata.\n2. Cuoci la pasta al dente.\n3. Condisci e servi." }),
  /** Risposta in Markdown con JSON incorporato (succede con alcuni modelli) */
  stepsFenced: '```json\n{"steps": "1. Scalda l\'olio in padella.\\n2. Aggiungi gli ingredienti e cuoci 10 minuti."}\n```',
  invalid: "Ecco il menù: lunedì pasta, martedì riso!",
  invalidSchema: JSON.stringify({ meals: [{ date: "domani", slot: "pranzo", title: "x" }] }),
  emptyMap: JSON.stringify({ items: [] }),
};

type Resp = string | Error | ((user: string) => string);

export class FakeBackend implements LlmBackend {
  readonly usage: Usage = { calls: 0, input_tokens: 0, output_tokens: 0 };
  queues: Partial<Record<Task, Resp[]>> = {};
  defaults: Partial<Record<Task, Resp>> = { ingredientMap: RECORDED.emptyMap };
  search: { candidates: string[]; chosen: string | null } | Error = { candidates: [], chosen: null };
  calls: { task: Task | "search"; user: string }[] = [];

  constructor(readonly name: string) {}

  queue(task: Task, ...r: Resp[]) {
    (this.queues[task] ??= []).push(...r);
    return this;
  }

  count(task: Task | "search") {
    return this.calls.filter((c) => c.task === task).length;
  }

  async json(task: Task, _system: string, user: string): Promise<string> {
    this.calls.push({ task, user });
    this.usage.calls++;
    this.usage.input_tokens += 100;
    this.usage.output_tokens += 50;
    const q = this.queues[task];
    const r = q && q.length ? q.shift()! : this.defaults[task];
    if (r === undefined) throw new Error(`Nessuna risposta registrata per ${task}`);
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(user) : r;
  }

  async searchRecipe(title: string) {
    this.calls.push({ task: "search", user: title });
    if (this.search instanceof Error) throw this.search;
    return this.search;
  }
}

/** Installa provider finti: nessuna chiamata AI reale nei test. */
export function useFakes(claude: FakeBackend | null, workersAi: FakeBackend | null = null) {
  setProviderFactory((_env, name) => {
    const b = name === "claude" ? claude : workersAi;
    return b ? new LlmProvider(b) : null;
  });
}
