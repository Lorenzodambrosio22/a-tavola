import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { todayIn } from "../../domain/dates";
import { adminEmails } from "../access";
import { AiQuotaExceeded, type AiProvider, type Usage } from "../ai";
import { sendGlobalCapReached } from "../email";
import type { AppEnv, Env } from "../env";
import { all, first, run } from "../db/sql";

/** Operazioni AI al giorno per utente (l'admin non ha limiti). Override: AI_LIMIT_USER_DAY. */
export const AI_LIMIT_USER_DAY = 20;
/** Operazioni AI al giorno per tutta l'app; oltre, l'AI si ferma per tutti tranne l'admin. Override: AI_LIMIT_GLOBAL_DAY. */
export const AI_LIMIT_GLOBAL_DAY = 200;

export const USER_LIMIT_MESSAGE = "Hai raggiunto il limite di oggi, riprova domani.";
export const GLOBAL_LIMIT_MESSAGE = "Le funzioni AI sono in pausa per oggi, riprova domani.";

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function aiLimits(env: Env) {
  return { user: num(env.AI_LIMIT_USER_DAY, AI_LIMIT_USER_DAY), global: num(env.AI_LIMIT_GLOBAL_DAY, AI_LIMIT_GLOBAL_DAY) };
}

async function dayTotal(db: D1Database, day: string): Promise<number> {
  return (await first<{ n: number }>(db, "SELECT COALESCE(SUM(calls), 0) AS n FROM ai_usage WHERE day = ?", day))?.n ?? 0;
}

/** Una sola email per giorno, anche con richieste concorrenti. */
async function alertGlobalCap(env: Env, day: string, limit: number) {
  const res = await run(env.DB, "INSERT OR IGNORE INTO ai_alerts (day) VALUES (?)", day);
  if (!res.meta.changes) return;
  for (const admin of adminEmails(env)) {
    await sendGlobalCapReached(env, admin, day, limit).catch((e) => console.error("Avviso tetto AI non inviato", (e as Error).message));
  }
}

/**
 * Prenota un'operazione AI per l'utente, controllando prima il tetto globale e poi quello personale.
 * Lancia AiQuotaExceeded (429) se uno dei due è raggiunto.
 */
export async function reserveAiCall(env: Env, userId: string, admin: boolean, day = todayIn()): Promise<{ day: string }> {
  const limits = aiLimits(env);
  const db = env.DB;
  const total = await dayTotal(db, day);
  if (!admin && total >= limits.global) {
    await alertGlobalCap(env, day, limits.global);
    throw new AiQuotaExceeded(GLOBAL_LIMIT_MESSAGE);
  }
  if (admin) {
    await run(db, "INSERT INTO ai_usage (user_id, day, calls) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET calls = calls + 1", userId, day);
  } else {
    if (limits.user <= 0) throw new AiQuotaExceeded(USER_LIMIT_MESSAGE);
    // Incremento atomico solo sotto il limite: due richieste insieme non lo superano
    const res = await run(
      db,
      "INSERT INTO ai_usage (user_id, day, calls) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET calls = calls + 1 WHERE calls < ?",
      userId,
      day,
      limits.user,
    );
    if (!res.meta.changes) throw new AiQuotaExceeded(USER_LIMIT_MESSAGE);
  }
  if (total + 1 >= limits.global) await alertGlobalCap(env, day, limits.global);
  return { day };
}

async function addTokens(db: D1Database, userId: string, day: string, input: number, output: number) {
  if (!input && !output) return;
  await run(db, "UPDATE ai_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE user_id = ? AND day = ?", input, output, userId, day);
}

/**
 * Provider che conta le operazioni AI: la prima chiamata della richiesta prenota un'operazione
 * (e verifica i limiti), le successive della stessa richiesta (anche in background) sono comprese.
 * Le richieste che non chiamano davvero l'AI non consumano nulla.
 */
export class MeteredProvider implements AiProvider {
  private recorded = { input_tokens: 0, output_tokens: 0 };

  constructor(
    private inner: AiProvider,
    private reserve: () => Promise<{ day: string }>,
    private record: (day: string, input: number, output: number) => Promise<void>,
  ) {}

  get name() {
    return this.inner.name;
  }
  get usage(): Usage {
    return this.inner.usage;
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    const { day } = await this.reserve();
    try {
      return await fn();
    } finally {
      // Solo la differenza dall'ultima registrazione: corretto anche con chiamate in parallelo
      const u = this.inner.usage;
      const input = u.input_tokens - this.recorded.input_tokens;
      const output = u.output_tokens - this.recorded.output_tokens;
      this.recorded = { input_tokens: u.input_tokens, output_tokens: u.output_tokens };
      await this.record(day, input, output).catch((e) => console.warn("Registrazione token non riuscita", (e as Error).message));
    }
  }

  generateWeek(i: Parameters<AiProvider["generateWeek"]>[0]) {
    return this.run(() => this.inner.generateWeek(i));
  }
  replaceMeal(i: Parameters<AiProvider["replaceMeal"]>[0]) {
    return this.run(() => this.inner.replaceMeal(i));
  }
  writeRecipe(i: Parameters<AiProvider["writeRecipe"]>[0]) {
    return this.run(() => this.inner.writeRecipe(i));
  }
  writeSide(i: Parameters<AiProvider["writeSide"]>[0]) {
    return this.run(() => this.inner.writeSide(i));
  }
  findSourceUrl(title: string) {
    return this.run(() => this.inner.findSourceUrl(title));
  }
  mapIngredient(names: string[], known: string[]) {
    return this.run(() => this.inner.mapIngredient(names, known));
  }
  estimateIngredients(title: string, servings: number) {
    return this.run(() => this.inner.estimateIngredients(title, servings));
  }
}

/** Avvolge il provider della richiesta: approvazione e limiti controllati lato server prima di ogni chiamata. */
export function meteredFor(c: Context<AppEnv>, provider: AiProvider): AiProvider {
  const user = c.get("user");
  return new MeteredProvider(
    provider,
    () => {
      if (c.get("access") !== "approved") return Promise.reject(new HTTPException(403, { message: "Il tuo account è in attesa di approvazione" }));
      let charge = c.get("aiCharge");
      if (!charge) {
        charge = reserveAiCall(c.env, user.id, c.get("isAdmin"));
        c.set("aiCharge", charge);
      }
      return charge;
    },
    (day, input, output) => addTokens(c.env.DB, user.id, day, input, output),
  );
}

export interface UsageRow {
  user_id: string;
  email: string;
  name: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

/** Riepilogo del giorno per la pagina admin. */
export async function usageOf(env: Env, day = todayIn()) {
  const rows = await all<UsageRow>(
    env.DB,
    `SELECT a.user_id, u.email, u.name, a.calls, a.input_tokens, a.output_tokens
       FROM ai_usage a JOIN "user" u ON u.id = a.user_id WHERE a.day = ? ORDER BY a.calls DESC`,
    day,
  );
  return { day, limits: aiLimits(env), total: rows.reduce((n, r) => n + r.calls, 0), users: rows };
}
