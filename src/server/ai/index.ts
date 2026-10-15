import type { Env } from "../env";
import type { ProviderName } from "../../shared/types";
import { ClaudeBackend } from "./claude";
import { WorkersAiBackend } from "./workersAi";
import { FallbackProvider, LlmProvider } from "./provider";
import type { AiProvider } from "./types";

export * from "./types";

type Factory = (env: Env, name: ProviderName) => AiProvider | null;

let override: Factory | null = null;

/** Solo per i test: sostituisce i provider reali con provider finti. */
export function setProviderFactory(f: Factory | null) {
  override = f;
}

/** Provider singolo (senza fallback), o null se non configurato. */
export function singleProvider(env: Env, name: ProviderName): AiProvider | null {
  if (override) return override(env, name);
  if (name === "claude") return env.ANTHROPIC_API_KEY ? new LlmProvider(new ClaudeBackend(env)) : null;
  return env.AI ? new LlmProvider(new WorkersAiBackend(env)) : null;
}

export function resolveProviderName(env: Env, preferred?: string | null): ProviderName {
  const p = preferred || env.AI_PROVIDER_DEFAULT || "claude";
  return p === "workersAi" ? "workersAi" : "claude";
}

/** Provider attivo del nucleo con fallback sull'altro. */
export function getProvider(env: Env, preferred?: string | null): AiProvider {
  const first = resolveProviderName(env, preferred);
  const second: ProviderName = first === "claude" ? "workersAi" : "claude";
  const chain = [singleProvider(env, first), singleProvider(env, second)].filter((p): p is AiProvider => !!p);
  return new FallbackProvider(chain);
}
