import { afterEach, describe, expect, it } from "vitest";
import { setProviderFactory } from "../src/server/ai";
import { loadHouseholdCtx, peoplePrefs } from "../src/server/services/context";
import { FakeBackend, RECORDED, useFakes } from "./fixtures/fake";
import { family, START } from "./family";
import { env, login } from "./helpers";

afterEach(() => setProviderFactory(null));

describe("gusti personali", () => {
  it("onboarding facoltativo, salvataggio senza AI e modifica successiva senza perdere i gusti", async () => {
    const ai = new FakeBackend("claude");
    useFakes(ai);
    const a = await login("tastes-onboarding@example.com");
    expect((await a.req("GET", "/api/me")).data.user.taste_dishes).toEqual([]);

    const saved = await a.req("PATCH", "/api/me", { name: "Anna", breakfast: true, taste_dishes: ["lasagne", "pizza", "pizza"] });
    expect(saved.status).toBe(200);
    expect(saved.data.onboarded).toBe(true);
    expect(saved.data.user.taste_dishes).toEqual(["lasagne", "pizza"]);

    const changed = await a.req("PATCH", "/api/me", { breakfast: false });
    expect(changed.data.user.breakfast).toBe(false);
    expect(changed.data.user.taste_dishes).toEqual(["lasagne", "pizza"]);
    expect((await a.req("GET", "/api/me")).data.user.taste_dishes).toEqual(["lasagne", "pizza"]);

    await a.req("PATCH", "/api/me", { taste_dishes: [] });
    expect((await a.req("GET", "/api/me")).data.user.taste_dishes).toEqual([]);
    expect(ai.calls).toEqual([]);
  });

  it("rifiuta selezioni arbitrarie o troppo lunghe senza salvare modifiche parziali", async () => {
    const a = await login("tastes-validation@example.com", "Anna");
    await a.req("PATCH", "/api/me", { taste_dishes: ["pizza"] });
    for (const taste_dishes of [["piatto-inesistente"], Array(25).fill("pizza"), "pizza"]) {
      const rejected = await a.req("PATCH", "/api/me", { name: "Modificato", taste_dishes });
      expect(rejected.status).toBe(400);
      const me = (await a.req("GET", "/api/me")).data;
      expect(me.user.name).toBe("Anna");
      expect(me.user.taste_dishes).toEqual(["pizza"]);
    }
  });

  it("mantiene separati i gusti dei familiari e usa solo quelli dei presenti nella sostituzione", async () => {
    const { anna, bruno } = await family();
    await anna.req("PATCH", "/api/me", { taste_dishes: ["lasagne"] });
    await bruno.req("PATCH", "/api/me", { taste_dishes: ["pizza"] });
    const a = (await anna.req("GET", "/api/me")).data;
    expect(a.user.taste_dishes).toEqual(["lasagne"]);
    expect((await bruno.req("GET", "/api/me")).data.user.taste_dishes).toEqual(["pizza"]);
    const ctx = await loadHouseholdCtx(env.DB, a.household.id);
    expect(peoplePrefs(ctx, [anna.userId])).toMatchObject([{ name: "Anna", liked_dishes: ["Lasagne al ragù"] }]);
    expect(peoplePrefs(ctx, [bruno.userId])).toMatchObject([{ name: "Bruno", liked_dishes: ["Pizza margherita"] }]);
    expect(peoplePrefs(ctx, [])).toEqual([]);
  });

  it("passa solo i nomi alla chiamata esistente e i gusti non superano i divieti", async () => {
    const { anna, bruno } = await family();
    await anna.req("PATCH", "/api/me", { taste_dishes: ["lasagne"] });
    await bruno.req("PATCH", "/api/me", { taste_dishes: ["pizza"] });
    await anna.req("POST", "/api/constraints", { ingredient: "pasta", level: "never" });
    const week = JSON.parse(RECORDED.week);
    const lasagne = week.meals.find((m: { date: string; slot: string }) => m.date === START && m.slot === "dinner");
    Object.assign(lasagne, { title: "Lasagne al ragù", dish_family: "lasagne", ingredients: [{ name: "pasta", grams: 180 }] });
    const valid = JSON.parse(RECORDED.replaceOk(START, "dinner"));
    Object.assign(valid, { title: "Riso al pomodoro", dish_family: "riso", ingredients: [{ name: "riso", grams: 160 }] });
    // Per questa verifica tutti gli altri pasti registrati sono privi del nuovo divieto.
    for (const meal of week.meals) {
      if (meal !== lasagne) meal.ingredients = [{ name: "riso", grams: 160 }];
    }
    const ai = new FakeBackend("claude").queue("week", JSON.stringify(week)).queue("meal", JSON.stringify(valid));
    useFakes(ai);
    const result = await anna.req("POST", "/api/weeks/generate", { start_date: START });
    expect(result.status).toBe(201);
    expect(ai.count("week")).toBe(1);
    expect(ai.count("meal")).toBe(1); // sostituisce comunque il piatto gradito che viola un divieto
    expect(ai.count("search")).toBe(0);
    for (const call of ai.calls.filter((c) => c.task === "week" || c.task === "meal")) {
      expect(call.user).toContain("esempi di piatti graditi (indicativi): Lasagne al ragù");
      expect(call.user).toContain("esempi di piatti graditi (indicativi): Pizza margherita");
      expect(call.user).not.toContain("https://");
    }
    const dinner = result.data.week.meals.find((m: { date: string; slot: string }) => m.date === START && m.slot === "dinner");
    expect(dinner.recipe.title).toBe("Riso al pomodoro");
    expect(dinner.violations).toEqual([]);
  });
});
