import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";
import { AiInvalidOutput, type LlmBackend, type Task, type Usage } from "./types";

type Effort = "low" | "medium" | "high";

/** Modelli con fallback lato server sui rifiuti (beta server-side-fallback). */
function supportsServerFallback(model: string): boolean {
  return /^claude-(sonnet-5-5|opus-5|fable-5)/.test(model);
}

export class ClaudeBackend implements LlmBackend {
  readonly name = "claude";
  readonly usage: Usage = { calls: 0, input_tokens: 0, output_tokens: 0 };
  private client: Anthropic;

  constructor(private env: Env) {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120_000 });
  }

  private model(task: Task | "search"): string {
    switch (task) {
      case "week":
        return this.env.CLAUDE_MODEL_WEEK || "claude-sonnet-5-5";
      case "steps":
      case "search":
        return this.env.CLAUDE_MODEL_RECIPE || "claude-sonnet-5-5";
      // Compiti semplici (sostituzioni, nomi degli ingredienti, stime): Haiku
      default:
        return this.env.CLAUDE_MODEL_FAST || "claude-haiku-5-5";
    }
  }

  private effort(task: Task): Effort {
    return task === "week" || task === "steps" ? "medium" : "low";
  }

  private track(u: { input_tokens?: number | null; output_tokens?: number | null } | undefined) {
    this.usage.calls++;
    this.usage.input_tokens += u?.input_tokens ?? 0;
    this.usage.output_tokens += u?.output_tokens ?? 0;
  }

  async json(task: Task, system: string, user: string, schema: object): Promise<string> {
    const model = this.model(task);
    const fallback = supportsServerFallback(model);
    const res = await this.client.beta.messages.create({
      model,
      max_tokens: task === "week" ? 32000 : 8000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: {
        effort: this.effort(task),
        format: { type: "json_schema", schema: schema as Record<string, unknown> },
      },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    this.track(res.usage);
    if (res.stop_reason === "refusal") throw new AiInvalidOutput("Richiesta rifiutata dal modello");
    if (res.stop_reason === "max_tokens") throw new AiInvalidOutput("Risposta troncata");
    const text = res.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text;
  }

  /**
   * Ricerca web reale con il tool server `web_search`. Restituisce gli URL trovati nei
   * risultati di ricerca (gli unici salvabili) e l'URL scelto dal modello.
   */
  async searchRecipe(title: string): Promise<{ candidates: string[]; chosen: string | null }> {
    const model = this.model("search");
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: `Cerca sul web "${title} ricetta" e scegli il primo risultato pertinente su un sito di ricette italiano. Rispondi solo con l'URL esatto di quel risultato, senza altro testo. Se nessun risultato è pertinente rispondi "NESSUNO".`,
      },
    ];
    const candidates: string[] = [];
    let finalText = "";
    for (let turn = 0; turn < 3; turn++) {
      const res = await this.client.beta.messages.create({
        model,
        max_tokens: 4000,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "IT" } }],
        output_config: { effort: "low" },
      });
      this.track(res.usage);
      for (const block of res.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result" && r.url) candidates.push(r.url);
        }
        if (block.type === "text") finalText += block.text;
      }
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    const m = finalText.match(/https?:\/\/[^\s)\]"'<>]+/);
    return { candidates, chosen: m ? m[0] : null };
  }
}
