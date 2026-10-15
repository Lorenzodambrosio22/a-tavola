import type { Env } from "../env";
import { AiInvalidOutput, type LlmBackend, type Task, type Usage } from "./types";

/**
 * Backend Workers AI (binding `AI`). La ricerca del link usa un'API di ricerca web
 * esterna (Brave Search, chiave BRAVE_SEARCH_API_KEY); senza chiave restituisce null.
 */
export class WorkersAiBackend implements LlmBackend {
  readonly name = "workersAi";
  readonly usage: Usage = { calls: 0, input_tokens: 0, output_tokens: 0 };

  constructor(
    private env: Env,
    private search: WebSearch | null = env.BRAVE_SEARCH_API_KEY ? braveSearch(env.BRAVE_SEARCH_API_KEY) : null,
  ) {}

  private get model(): string {
    return this.env.WORKERS_AI_MODEL || "@cf/meta/llama-4-scout-17b-16e-instruct";
  }

  async json(task: Task, system: string, user: string, schema: object): Promise<string> {
    if (!this.env.AI) throw new Error("Binding AI non disponibile");
    const out = (await this.env.AI.run(this.model as Parameters<Ai["run"]>[0], {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: schema },
      max_tokens: task === "week" ? 8000 : 2500,
      temperature: 0.4,
    } as never)) as { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    this.usage.calls++;
    this.usage.input_tokens += out?.usage?.prompt_tokens ?? 0;
    this.usage.output_tokens += out?.usage?.completion_tokens ?? 0;
    const r = out?.response;
    if (r === undefined || r === null) throw new AiInvalidOutput("Risposta vuota");
    return typeof r === "string" ? r : JSON.stringify(r);
  }

  async searchRecipe(title: string): Promise<{ candidates: string[]; chosen: string | null }> {
    if (!this.search) return { candidates: [], chosen: null };
    const candidates = await this.search(`${title} ricetta`);
    return { candidates, chosen: null };
  }
}

export type WebSearch = (query: string) => Promise<string[]>;

/** Brave Search API: https://api.search.brave.com/res/v1/web/search */
export function braveSearch(key: string): WebSearch {
  return async (query) => {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("country", "it");
    url.searchParams.set("search_lang", "it");
    url.searchParams.set("count", "10");
    const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
    if (!res.ok) throw new Error(`Ricerca web fallita (${res.status})`);
    const data = (await res.json()) as { web?: { results?: { url?: string }[] } };
    return (data.web?.results ?? []).map((r) => r.url).filter((u): u is string => !!u);
  };
}
