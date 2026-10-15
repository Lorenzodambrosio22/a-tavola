import { afterEach, describe, expect, it } from "vitest";
import { setProviderFactory } from "../src/server/ai";
import { FakeBackend, RECORDED, useFakes } from "./fixtures/fake";
import { family, START } from "./family";
import { env } from "./helpers";

afterEach(() => setProviderFactory(null));

function mealAt(week: any, date: string, slot: string) {
  return week.meals.find((m: any) => m.date === date && m.slot === slot);
}

describe("generazione del menù", () => {
  it("genera 7 giorni × pranzo/cena e sostituisce solo il pasto che viola un'allergia di un presente", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude);

    const res = await anna.req("POST", "/api/weeks/generate", { start_date: START });
    expect(res.status).toBe(201);
    const week = res.data.week;
    expect(week.meals).toHaveLength(14);
    expect(claude.count("week")).toBe(1);
    expect(claude.count("meal")).toBe(1); // solo il pasto con i pinoli

    const dinner = mealAt(week, "2030-01-05", "dinner");
    expect(dinner.recipe.title).toBe("Pasta al pomodoro e basilico");
    expect(week.meals.every((m: any) => m.violations.length === 0)).toBe(true);
    // il prompt di sostituzione spiega il motivo
    expect(claude.calls.find((c) => c.task === "meal")!.user).toContain("pinoli");

    // velocità di default: sabato/domenica lunga, feriali veloce
    expect(mealAt(week, "2030-01-05", "lunch").speed).toBe("long");
    expect(mealAt(week, "2030-01-07", "lunch").speed).toBe("quick");

    // ingredienti normalizzati sul riferimento + calorie calcolate
    const risotto = mealAt(week, "2030-01-05", "lunch");
    expect(risotto.recipe.ingredients.map((i: any) => i.name)).toContain("cipolle");
    expect(risotto.kcal).toBeGreaterThan(300);
    expect(risotto.kcal_partial).toBe(false);
  });

  it("dopo 2 tentativi falliti il pasto resta vuoto con 'Nessuna proposta valida, scegli tu'", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude")
      .queue("week", RECORDED.week)
      .queue("meal", RECORDED.replaceBad("2030-01-05", "dinner"), RECORDED.replaceBad("2030-01-05", "dinner"));
    useFakes(claude);
    const res = await anna.req("POST", "/api/weeks/generate", { start_date: START });
    const dinner = mealAt(res.data.week, "2030-01-05", "dinner");
    expect(claude.count("meal")).toBe(2);
    expect(dinner.recipe).toBeNull();
    expect(dinner.message).toBe("Nessuna proposta valida, scegli tu");
  });

  it("i vincoli valgono solo per i presenti: con Anna assente il pesto resta, con badge di avviso", async () => {
    const { anna } = await family();
    await anna.req("PUT", "/api/absences/recurring", { absences: [{ weekday: 6, slot: "dinner" }] });
    const claude = new FakeBackend("claude").queue("week", RECORDED.week);
    useFakes(claude);
    const res = await anna.req("POST", "/api/weeks/generate", { start_date: START });
    const dinner = mealAt(res.data.week, "2030-01-05", "dinner");
    expect(claude.count("meal")).toBe(0);
    expect(dinner.recipe.title).toBe("Trofie al pesto");
    expect(dinner.absent).toEqual([anna.userId]);
    expect(dinner.warnings).toEqual([
      { user_id: anna.userId, name: "Anna", allergen: "frutta a guscio", ingredient: "pinoli" },
    ]);

    // Anna torna: il pasto viene segnalato e si propone la sostituzione
    const back = await anna.req("POST", `/api/meals/${dinner.id}/absence`, { absent: false });
    expect(back.data.meal.violations[0]).toContain("pinoli");
    claude.queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    const rep = await anna.req("POST", `/api/meals/${dinner.id}/replace`);
    expect(rep.status).toBe(200);
    expect(rep.data.meal.recipe.title).toBe("Pasta al pomodoro e basilico");
    expect(rep.data.meal.violations).toEqual([]);
  });

  it("zero presenti → pasto saltato", async () => {
    const { anna, bruno } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude);
    const week = (await anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;
    const lunch = mealAt(week, "2030-01-06", "lunch");
    await anna.req("POST", `/api/meals/${lunch.id}/absence`, { absent: true });
    const r = await anna.req("POST", `/api/meals/${lunch.id}/absence`, { absent: true, user_id: bruno.userId });
    expect(r.data.meal.status).toBe("skipped");
    expect(r.data.meal.present).toEqual([]);
  });

  it("JSON non valido: nuovo tentativo, poi fallback sull'altro provider", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.invalid, RECORDED.invalidSchema);
    const workers = new FakeBackend("workersAi").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude, workers);
    const res = await anna.req("POST", "/api/weeks/generate", { start_date: START });
    expect(res.status).toBe(201);
    expect(claude.count("week")).toBe(2);
    expect(workers.count("week")).toBe(1);
    expect(res.data.week.meals).toHaveLength(14);
  });

  it("AI non raggiungibile: 503 'Riprova tra poco' senza perdere la settimana esistente", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude);
    const first = (await anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;

    const down = new FakeBackend("claude").queue("week", new Error("network"), new Error("network"));
    useFakes(down, null);
    const res = await anna.req("POST", "/api/weeks/generate", { start_date: START });
    expect(res.status).toBe(503);
    expect(res.data.error).toMatch(/Riprova tra poco/);
    const again = await anna.req("GET", `/api/weeks/${first.id}`);
    expect(again.status).toBe(200);
    expect(again.data.week.meals.filter((m: any) => m.recipe)).toHaveLength(14);
  });

  it("colazione solo se qualcuno la fa, e solo per chi la fa", async () => {
    const { anna } = await family({ annaBreakfast: true });
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    claude.defaults.meal = (user: string) => {
      const m = user.match(/(\d{4}-\d{2}-\d{2}) (breakfast|lunch|dinner)/)!;
      return JSON.stringify({ date: m[1], slot: m[2], recipe_id: null, title: "Yogurt e frutta", dish_family: "yogurt", minutes: 5, servings: 1, ingredients: [{ name: "yogurt bianco", grams: 125 }, { name: "banane", grams: 100 }] });
    };
    useFakes(claude);
    const res = await anna.req("POST", "/api/weeks/generate", { start_date: START });
    const week = res.data.week;
    expect(week.meals).toHaveLength(21);
    const bf = mealAt(week, "2030-01-07", "breakfast");
    expect(bf.present).toEqual([anna.userId]);
    expect(bf.recipe.title).toBe("Yogurt e frutta");
    // il prompt della settimana elenca la colazione solo con Anna
    expect(claude.calls[0].user).toContain("2030-01-07 breakfast (colazione), quick, presenti: Anna\n");
  });

  it("pasti fissati, ricette del nucleo e preferiti nel prompt", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude);
    const own = await anna.req("POST", "/api/recipes", {
      mode: "own",
      title: "Pasta e fagioli della nonna",
      servings: 4,
      minutes: 40,
      ingredients: [
        { name: "Pasta", grams: 250 },
        { name: "fagioli borlotti", grams: 400 },
        { name: "Cipolla", grams: 80 },
      ],
      steps: "1. Soffriggi. 2. Unisci i fagioli. 3. Cuoci la pasta nel brodo.",
    });
    expect(own.status).toBe(201);
    expect(own.data.recipe.ingredients.map((i: any) => i.name)).toEqual(["pasta", "fagioli borlotti", "cipolle"]);
    await anna.req("PUT", `/api/recipes/${own.data.recipe.id}/favorite`, { favorite: true });

    const res = await anna.req("POST", "/api/weeks/generate", {
      start_date: START,
      reuse_favorites: true,
      pinned: [{ date: "2030-01-09", slot: "dinner", recipe_id: own.data.recipe.id }],
    });
    const pinned = mealAt(res.data.week, "2030-01-09", "dinner");
    expect(pinned.pinned).toBe(true);
    expect(pinned.recipe.title).toBe("Pasta e fagioli della nonna");
    expect(pinned.favorite).toBe(true);
    const prompt = claude.calls[0].user;
    expect(prompt).toContain("Pasta e fagioli della nonna");
    expect(prompt).toContain("Preferiti:");
    expect(prompt).not.toContain("2030-01-09 dinner");
    expect(prompt).toMatch(/Anna:\n\s+vietati: [^\n]*pinoli/);
  });

  it("scegli tu: rifiuta una ricetta con allergene di un presente", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude);
    const own = await anna.req("POST", "/api/recipes", {
      mode: "own",
      title: "Torta di noci",
      servings: 6,
      minutes: 60,
      ingredients: [{ name: "noci", grams: 200 }, { name: "farina 00", grams: 200 }],
    });
    const week = (await anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;
    const meal = mealAt(week, "2030-01-07", "dinner");
    const r = await anna.req("PUT", `/api/meals/${meal.id}/recipe`, { recipe_id: own.data.recipe.id });
    expect(r.status).toBe(422);
    expect(r.data.error).toContain("noci");
  });
});

describe("dettaglio ricetta", () => {
  it("se nessun sito ha il piatto, alla prima apertura il procedimento lo scrive l'AI, senza ricerca web", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude);
    const week = (await anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;
    const meal = mealAt(week, "2030-01-07", "dinner");

    claude.queue("steps", RECORDED.stepsFenced);
    const r = await anna.req("GET", `/api/recipes/${meal.recipe.id}?meal=${meal.id}`);
    expect(r.status).toBe(200);
    expect(r.data.recipe.steps).toContain("Scalda l'olio");
    expect(r.data.recipe.source_url).toBeNull();
    expect(r.data.recipe.details_status).toBe("ready");
    expect(r.data.scaled_ingredients.find((i: any) => i.name === "uova").grams).toBe(240);
    expect(claude.count("search")).toBe(0);

    // seconda apertura: niente nuove chiamate
    const before = claude.calls.length;
    await anna.req("GET", `/api/recipes/${meal.recipe.id}`);
    expect(claude.calls.length).toBe(before);
  });

  it("AI non disponibile all'apertura: messaggio di errore e nuovo tentativo alla prossima apertura", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude);
    const week = (await anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;
    const meal = mealAt(week, "2030-01-08", "dinner");
    claude.queue("steps", new Error("AI down"));
    const r1 = await anna.req("GET", `/api/recipes/${meal.recipe.id}`);
    expect(r1.data.recipe.steps).toBeNull();
    expect(r1.data.details_error).toBeTruthy();

    claude.queue("steps", RECORDED.steps);
    const r2 = await anna.req("GET", `/api/recipes/${meal.recipe.id}`);
    expect(r2.data.recipe.steps).toContain("Cuoci la pasta");
    expect(r2.data.recipe.details_status).toBe("ready");
  });

  it("ricette 'trova tu' e 'la so io'", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude");
    claude.queue("estimate", JSON.stringify({ dish_family: "parmigiana", minutes: 90, ingredients: [{ name: "melanzane", grams: 800 }, { name: "mozzarella", grams: 250 }, { name: "passata di pomodoro", grams: 500 }] }));
    claude.queue("estimate", JSON.stringify({ dish_family: "polpette", minutes: 40, ingredients: [{ name: "macinato misto", grams: 400 }, { name: "uova", grams: 60 }, { name: "pane raffermo", grams: 80 }] }));
    claude.queue("steps", RECORDED.steps);
    useFakes(claude);

    const ai = await anna.req("POST", "/api/recipes", { mode: "own_ai", title: "Parmigiana di melanzane", servings: 4 });
    expect(ai.status).toBe(201);
    expect(ai.data.recipe.kind).toBe("own_ai");
    expect(ai.data.recipe.source_url).toBeNull(); // nei test i siti non rispondono
    expect(ai.data.recipe.steps).toBeTruthy();

    const known = await anna.req("POST", "/api/recipes", { mode: "own_known", title: "Polpette della mamma", servings: 4 });
    expect(known.data.recipe.kind).toBe("own_known");
    expect(known.data.recipe.steps).toBeNull();
    expect(known.data.recipe.source_url).toBeNull();
    expect(known.data.recipe.ingredients.map((i: any) => i.name)).toContain("pane");

    // l'utente corregge gli ingredienti stimati
    const fix = await anna.req("PATCH", `/api/recipes/${known.data.recipe.id}`, {
      ingredients: [{ name: "macinato misto", grams: 500 }, { name: "uova", grams: 120 }],
    });
    expect(fix.data.recipe.ingredients).toHaveLength(2);

    const list = await anna.req("GET", "/api/recipes");
    expect(list.data.recipes.map((r: any) => r.title).sort()).toEqual(["Parmigiana di melanzane", "Polpette della mamma"]);
  });

  it("mapIngredient: alias salvati in cache, nessuna seconda chiamata", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude");
    claude.queue("ingredientMap", JSON.stringify({ items: [{ input: "pomodorini datterini", name: "pomodorini" }] }));
    useFakes(claude);
    const body = { mode: "own", title: "Bruschetta", servings: 2, minutes: 10, ingredients: [{ name: "Pomodorini datterini", grams: 200 }, { name: "pane", grams: 100 }] };
    const r = await anna.req("POST", "/api/recipes", body);
    expect(r.data.recipe.ingredients[0]).toEqual({ name: "pomodorini", grams: 200, raw: "pomodorini datterini" });
    await anna.req("POST", "/api/recipes", { ...body, title: "Bruschetta 2" });
    expect(claude.count("ingredientMap")).toBe(1);
    const alias = await env.DB.prepare("SELECT name FROM ingredient_aliases WHERE alias = 'pomodorini datterini'").first<{ name: string }>();
    expect(alias?.name).toBe("pomodorini");
  });
});
