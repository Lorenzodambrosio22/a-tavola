import { afterEach, describe, expect, it } from "vitest";
import { setProviderFactory } from "../src/server/ai";
import { FakeBackend, RECORDED, useFakes } from "./fixtures/fake";
import { family, START } from "./family";
import { login } from "./helpers";

afterEach(() => setProviderFactory(null));

describe("confronto provider e sicurezza dei pasti fissati", () => {
  it("l'admin confronta gli stessi input senza creare una settimana", async () => {
    const a = await login("admin@example.com", "Admin");
    await a.req("POST", "/api/constraints", { ingredient: "frutta a guscio", level: "allergy" });
    const claude = new FakeBackend("claude").queue("week", RECORDED.week);
    const workers = new FakeBackend("workersAi").queue("week", RECORDED.week);
    useFakes(claude, workers);
    const res = await a.req("POST", "/api/admin/compare", { start_date: START });
    expect(res.status).toBe(200);
    expect(res.data.results).toHaveLength(2);
    expect(res.data.results[0].violations).toBeGreaterThan(0);
    expect(res.data.results[0].missing).toBe(0);
    expect(claude.calls[0].user).toBe(workers.calls[0].user);
    expect((await a.req("GET", "/api/weeks")).data.weeks).toEqual([]);
  });
  it("nega il confronto agli altri utenti e gestisce provider non configurati", async () => {
    const a = await login(`ordinary-${crypto.randomUUID()}@example.com`, "Ada");
    expect((await a.req("POST", "/api/admin/compare", { start_date: START })).status).toBe(403);
    const admin = await login("admin@example.com");
    setProviderFactory(() => null);
    const res = await admin.req("POST", "/api/admin/compare", { start_date: START });
    expect(res.status).toBe(200);
    expect(res.data.results.every((r: any) => r.error === "Provider non configurato")).toBe(true);
  });
  it("rifiuta piatti fissati con allergeni o appartenenti a un altro nucleo", async () => {
    const { anna } = await family();
    const stranger = await login(`pin-${crypto.randomUUID()}@example.com`, "Altra casa");
    useFakes(new FakeBackend("claude"));
    const recipe = { mode: "own", title: "Noci a tavola", servings: 2, minutes: 10, ingredients: [{ name: "noci", grams: 100 }] };
    const own = (await anna.req("POST", "/api/recipes", recipe)).data.recipe;
    const other = (await stranger.req("POST", "/api/recipes", recipe)).data.recipe;
    const generate = (recipe_id: string) => anna.req("POST", "/api/weeks/generate", { start_date: START, pinned: [{ date: START, slot: "dinner", recipe_id }] });
    expect((await generate(own.id)).status).toBe(422);
    expect((await generate(other.id)).status).toBe(404);
    expect((await anna.req("GET", "/api/weeks")).data.weeks).toEqual([]);
  });
});
