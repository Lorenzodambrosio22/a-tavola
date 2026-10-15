import { afterEach, describe, expect, it } from "vitest";
import { setProviderFactory } from "../src/server/ai";
import { FakeBackend, RECORDED, useFakes } from "./fixtures/fake";
import { family, START } from "./family";
import { env } from "./helpers";

afterEach(() => setProviderFactory(null));

const replacement = (title: string, ingredients: { name: string; grams: number }[], dish = "piatto") => (user: string) => {
  const m = user.match(/(\d{4}-\d{2}-\d{2}) (breakfast|lunch|dinner)/)!;
  return JSON.stringify({ date: m[1], slot: m[2], recipe_id: null, title, dish_family: dish, minutes: 20, servings: 2, ingredients });
};

async function setup() {
  const f = await family();
  const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
  useFakes(claude);
  const week = (await f.anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;
  const meal = (d: string, s: string) => week.meals.find((m: any) => m.date === d && m.slot === s);
  return { ...f, claude, week, meal };
}

describe("Non mi piace", () => {
  it("solo un presente può rifiutare", async () => {
    const { anna, bruno, meal } = await setup();
    const m = meal("2030-01-07", "dinner");
    await anna.req("POST", `/api/meals/${m.id}/absence`, { absent: true, user_id: bruno.userId });
    const r = await bruno.req("POST", `/api/meals/${m.id}/reject`, { reason: "today" });
    expect(r.status).toBe(403);
  });

  it("today: solo sostituzione, stessa velocità, ingredienti già in lista nel prompt", async () => {
    const { bruno, claude, meal } = await setup();
    const m = meal("2030-01-07", "dinner"); // frittata, veloce
    claude.queue("meal", replacement("Omelette alle erbe", [{ name: "uova", grams: 240 }, { name: "prezzemolo", grams: 10 }], "omelette"));
    const r = await bruno.req("POST", `/api/meals/${m.id}/reject`, { reason: "today" });
    expect(r.status).toBe(200);
    expect(r.data.meal.recipe.title).toBe("Omelette alle erbe");
    expect(r.data.meal.speed).toBe("quick");
    expect(r.data.learned).toEqual({ dislikes: [], blockDish: null });
    const prompt = claude.calls.filter((c) => c.task === "meal").at(-1)!.user;
    expect(prompt).toContain("2030-01-07 dinner (cena), quick");
    expect(prompt).toContain("Frittata di zucchine"); // da non riproporre
    expect(prompt).toMatch(/Preferisci ingredienti che ci sono già: .*zucchine/);
    const learned = await bruno.req("GET", "/api/learned");
    expect(learned.data.learned).toEqual([]);
  });

  it("ingredient: impara 'non mi piace' e la sostituzione ne tiene conto", async () => {
    const { bruno, claude, meal } = await setup();
    const m = meal("2030-01-07", "dinner");
    claude.queue("meal", replacement("Uova al pomodoro", [{ name: "uova", grams: 240 }, { name: "passata di pomodoro", grams: 200 }]));
    const r = await bruno.req("POST", `/api/meals/${m.id}/reject`, { reason: "ingredient", ingredients: ["zucchine"] });
    expect(r.status).toBe(200);
    expect(r.data.learned.dislikes).toEqual(["zucchine"]);
    const prompt = claude.calls.filter((c) => c.task === "meal").at(-1)!.user;
    expect(prompt).toMatch(/Bruno:\n\s+vietati: nessuno\n\s+evita: zucchine/);
    const learned = await bruno.req("GET", "/api/learned");
    expect(learned.data.learned.map((x: any) => [x.ingredient, x.level, x.source])).toEqual([["zucchine", "dislike", "learned"]]);

    // ingrediente non presente nel piatto → errore
    const bad = await bruno.req("POST", `/api/meals/${r.data.meal.id}/reject`, { reason: "ingredient", ingredients: ["caviale"] });
    expect(bad.status).toBe(400);
  });

  it("ingredient non declassa un vincolo più forte", async () => {
    const { anna, claude, meal } = await setup();
    await anna.req("POST", "/api/constraints", { ingredient: "uova", level: "never" });
    const m = meal("2030-01-09", "lunch"); // penne al pomodoro (nessun uovo)
    claude.queue("meal", replacement("Riso in bianco", [{ name: "riso", grams: 160 }]));
    const r = await anna.req("POST", `/api/meals/${m.id}/reject`, { reason: "ingredient", ingredients: ["basilico"] });
    expect(r.data.learned.dislikes).toEqual(["basilico"]);
    const row = await env.DB.prepare("SELECT level FROM food_constraints WHERE user_id = ? AND ingredient = 'uova'").bind(anna.userId).first<{ level: string }>();
    expect(row?.level).toBe("never");
  });

  it("dish: blocca la famiglia, cancellabile da 'Cose che ho imparato'", async () => {
    const { bruno, claude, meal } = await setup();
    const m = meal("2030-01-06", "dinner"); // minestrone
    claude.queue("meal", replacement("Zuppa di lenticchie", [{ name: "lenticchie", grams: 160 }], "zuppa di legumi"));
    const r = await bruno.req("POST", `/api/meals/${m.id}/reject`, { reason: "dish" });
    expect(r.data.learned.blockDish).toBe("minestrone");
    const prompt = claude.calls.filter((c) => c.task === "meal").at(-1)!.user;
    expect(prompt).toContain("famiglie di piatto bloccate: minestrone");
    const learned = await bruno.req("GET", "/api/learned");
    expect(learned.data.blocked.map((b: any) => b.dish_family)).toEqual(["minestrone"]);
    await bruno.req("DELETE", "/api/blocked/minestrone");
    expect((await bruno.req("GET", "/api/learned")).data.blocked).toEqual([]);
  });

  it("la sostituzione passa dal controllo di sicurezza", async () => {
    const { anna, claude, meal } = await setup();
    const m = meal("2030-01-07", "dinner");
    claude.queue(
      "meal",
      replacement("Pasta noci e gorgonzola", [{ name: "pasta", grams: 180 }, { name: "noci", grams: 40 }]),
      replacement("Pasta burro e salvia", [{ name: "pasta", grams: 180 }, { name: "burro", grams: 30 }]),
    );
    const r = await anna.req("POST", `/api/meals/${m.id}/reject`, { reason: "today" });
    expect(r.data.meal.recipe.title).toBe("Pasta burro e salvia");
    expect(claude.count("meal")).toBe(3); // 1 in generazione + 2 qui
  });

  it("3 rifiuti 'solo oggi' con lo stesso ingrediente in 30 giorni → 'Forse non ti piace X?'", async () => {
    const { bruno, claude, meal } = await setup();
    const zucchine = (t: string) => replacement(t, [{ name: "zucchine", grams: 300 }, { name: "menta", grams: 5 }]);
    claude.queue("meal", zucchine("Zucchine trifolate"), zucchine("Torta salata di zucchine"), replacement("Patate al forno", [{ name: "patate", grams: 400 }]));
    // 1° rifiuto: frittata di zucchine; 2° e 3°: i sostituti con zucchine
    let m = meal("2030-01-07", "dinner");
    let r = await bruno.req("POST", `/api/meals/${m.id}/reject`, { reason: "today" });
    expect(r.data.question).toBeNull();
    r = await bruno.req("POST", `/api/meals/${m.id}/reject`, { reason: "today" });
    expect(r.data.question).toBeNull();
    r = await bruno.req("POST", `/api/meals/${m.id}/reject`, { reason: "today" });
    expect(r.data.question).toEqual({ ingredient: "zucchine" });

    await bruno.req("POST", "/api/learning/answer", { ingredient: "zucchine", yes: true });
    const learned = await bruno.req("GET", "/api/learned");
    expect(learned.data.learned.map((x: any) => x.ingredient)).toContain("zucchine");
    // promuovi a "mai"
    const z = learned.data.learned.find((x: any) => x.ingredient === "zucchine");
    await bruno.req("PATCH", `/api/constraints/${z.id}`, { level: "never" });
    const list = await bruno.req("GET", "/api/constraints");
    expect(list.data.constraints.find((x: any) => x.ingredient === "zucchine").level).toBe("never");
    m = r.data.meal;
    expect(m.recipe.title).toBe("Patate al forno");
  });

  it("AI non raggiungibile durante la sostituzione: 503 e pasto invariato", async () => {
    const { bruno, meal, week } = await setup();
    const m = meal("2030-01-07", "dinner");
    const down = new FakeBackend("claude").queue("meal", new Error("down"), new Error("down"));
    useFakes(down);
    const r = await bruno.req("POST", `/api/meals/${m.id}/reject`, { reason: "today" });
    expect(r.status).toBe(503);
    const w = await bruno.req("GET", `/api/weeks/${week.id}`);
    expect(w.data.week.meals.find((x: any) => x.id === m.id).recipe.title).toBe("Frittata di zucchine");
  });
});
