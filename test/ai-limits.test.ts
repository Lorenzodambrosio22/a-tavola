import { afterEach, describe, expect, it } from "vitest";
import { AiQuotaExceeded, setProviderFactory } from "../src/server/ai";
import { devMails } from "../src/server/email";
import { GLOBAL_LIMIT_MESSAGE, reserveAiCall, USER_LIMIT_MESSAGE } from "../src/server/services/aiQuota";
import { FakeBackend, RECORDED, useFakes } from "./fixtures/fake";
import { START } from "./family";
import { env, login } from "./helpers";

const original = { user: env.AI_LIMIT_USER_DAY, global: env.AI_LIMIT_GLOBAL_DAY };
afterEach(() => {
  setProviderFactory(null);
  env.AI_LIMIT_USER_DAY = original.user;
  env.AI_LIMIT_GLOBAL_DAY = original.global;
});

const uniq = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}@example.com`;
let dayN = 0;
/** Un giorno diverso per test, così i conteggi non si mescolano. */
const freshDay = () => `2031-01-${String(++dayN).padStart(2, "0")}`;

async function usage(userId: string) {
  return env.DB.prepare(`SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(input_tokens), 0) AS input_tokens FROM ai_usage WHERE user_id = ?`).bind(userId).first<{ calls: number; input_tokens: number }>();
}

describe("limiti di consumo AI", () => {
  it("oltre il limite personale la route AI risponde 429 con un messaggio chiaro", async () => {
    env.AI_LIMIT_USER_DAY = "2";
    const u = await login(uniq("limite"), "Ada");
    const claude = new FakeBackend("claude").queue("week", RECORDED.week, RECORDED.week, RECORDED.week);
    useFakes(claude);
    expect((await u.req("POST", "/api/weeks/generate", { start_date: START })).status).toBe(201);
    expect((await u.req("POST", "/api/weeks/generate", { start_date: START })).status).toBe(201);
    const third = await u.req("POST", "/api/weeks/generate", { start_date: START });
    expect(third.status).toBe(429);
    expect(third.data.error).toBe(USER_LIMIT_MESSAGE);
    expect(claude.count("week")).toBe(2);
    // Una richiesta = una operazione, anche se chiama l'AI più volte (menù + nomi degli ingredienti)
    const u2 = await usage(u.userId);
    expect(u2?.calls).toBe(2);
    expect(u2?.input_tokens).toBeGreaterThan(0);
  });

  it("le richieste che non usano l'AI non consumano operazioni", async () => {
    const u = await login(uniq("senza-ai"), "Bea");
    useFakes(new FakeBackend("claude"));
    await u.req("GET", "/api/weeks/current");
    await u.req("POST", "/api/recipes", { mode: "own", title: "Pasta e burro", servings: 2, minutes: 10, ingredients: [{ name: "pasta", grams: 200 }] });
    expect((await usage(u.userId))?.calls).toBe(0);
  });

  it("il limite personale vale per giorno e per utente", async () => {
    const e = { ...env, AI_LIMIT_USER_DAY: "1", AI_LIMIT_GLOBAL_DAY: "1000" };
    const a = await login(uniq("a"));
    const b = await login(uniq("b"));
    const day = freshDay();
    await reserveAiCall(e, a.userId, false, day);
    await expect(reserveAiCall(e, a.userId, false, day)).rejects.toThrow(USER_LIMIT_MESSAGE);
    await expect(reserveAiCall(e, b.userId, false, day)).resolves.toEqual({ day });
    await expect(reserveAiCall(e, a.userId, false, freshDay())).resolves.toBeTruthy();
  });

  it("il tetto globale ferma tutti, avvisa l'admin una volta sola e non blocca l'admin", async () => {
    const e = { ...env, AI_LIMIT_USER_DAY: "100", AI_LIMIT_GLOBAL_DAY: "3" };
    const a = await login(uniq("g1"));
    const b = await login(uniq("g2"));
    const admin = await login("admin@example.com");
    const day = freshDay();
    const alerts = () => devMails.filter((m) => m.to === "admin@example.com" && m.text.includes(`(${day})`)).length;

    await reserveAiCall(e, a.userId, false, day);
    await reserveAiCall(e, a.userId, false, day);
    expect(alerts()).toBe(0);
    await reserveAiCall(e, b.userId, false, day); // terza: tetto raggiunto
    expect(alerts()).toBe(1);

    const err = await reserveAiCall(e, b.userId, false, day).catch((x) => x);
    expect(err).toBeInstanceOf(AiQuotaExceeded);
    expect(err.message).toBe(GLOBAL_LIMIT_MESSAGE);
    await expect(reserveAiCall(e, a.userId, false, day)).rejects.toThrow(GLOBAL_LIMIT_MESSAGE);
    expect(alerts()).toBe(1);

    await expect(reserveAiCall(e, admin.userId, true, day)).resolves.toEqual({ day });
  });

  it("l'admin non ha limiti personali", async () => {
    const e = { ...env, AI_LIMIT_USER_DAY: "1", AI_LIMIT_GLOBAL_DAY: "1000" };
    const admin = await login("admin@example.com");
    const day = freshDay();
    for (let i = 0; i < 5; i++) await reserveAiCall(e, admin.userId, true, day);
    const row = await env.DB.prepare("SELECT calls FROM ai_usage WHERE user_id = ? AND day = ?").bind(admin.userId, day).first<{ calls: number }>();
    expect(row?.calls).toBe(5);
  });

  it("il tetto globale raggiunto blocca le route AI con 429", async () => {
    env.AI_LIMIT_GLOBAL_DAY = "0";
    const u = await login(uniq("globale"), "Cora");
    const claude = new FakeBackend("claude").queue("week", RECORDED.week);
    useFakes(claude);
    const res = await u.req("POST", "/api/weeks/generate", { start_date: START });
    expect(res.status).toBe(429);
    expect(res.data.error).toBe(GLOBAL_LIMIT_MESSAGE);
    expect(claude.calls).toHaveLength(0);
  });

  it("l'admin vede il consumo del giorno", async () => {
    const admin = await login("admin@example.com");
    const res = await admin.req("GET", "/api/admin/usage");
    expect(res.status).toBe(200);
    expect(res.data.limits).toEqual({ user: 20, global: 100000 });
  });
});
