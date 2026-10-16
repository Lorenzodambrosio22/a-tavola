import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProviderFactory } from "../src/server/ai";
import { cleanSteps, extractRecipePage } from "../src/server/services/recipeImages";
import { rankRecipeLinks, resultLinks, splitSide } from "../src/server/services/recipeSearch";
import { FakeBackend, RECORDED, useFakes } from "./fixtures/fake";
import { family, START } from "./family";
import { env } from "./helpers";

const GZ = "https://ricette.giallozafferano.it/Frittata-di-zucchine.html";
const BENEDETTA = "https://www.fattoincasadabenedetta.it/ricetta/frittata-di-zucchine/";
const PHOTO = "https://www.giallozafferano.it/images/frittata.jpg";
const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const recipePage = (data: Record<string, unknown>) =>
  '<script type="application/ld+json">' + JSON.stringify({ "@type": "Recipe", image: PHOTO, ...data }) + "</script>";
const FRITTATA = recipePage({
  recipeYield: "4",
  recipeIngredient: ["Uova 6", "Zucchine 400 g", "Parmigiano Reggiano DOP 40 g", "Sale fino q.b."],
  recipeInstructions: ["Sbattete le uova.", "Unite le zucchine e cuocete."],
});
const links = (...urls: string[]) => urls.map((l) => `<a href="${l}">ricetta</a>`).join("");

/** Simula i siti: pagine dei risultati (GialloZafferano e Benedetta) e pagine delle ricette. */
function sites(pages: Record<string, string>, opts: { down?: boolean } = {}) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (opts.down) return new Response("", { status: 503 });
    if (url.includes("/ricerca-ricette/")) return html(links(...Object.keys(pages).filter((u) => u.includes("giallozafferano"))));
    if (url.includes("fattoincasadabenedetta.it/?s=")) return html(links(...Object.keys(pages).filter((u) => u.includes("benedetta"))));
    return pages[url] ? html(pages[url]) : new Response("", { status: 404 });
  });
}

function mealAt(week: any, date: string, slot: string) {
  return week.meals.find((m: any) => m.date === date && m.slot === slot);
}

async function generated(claude = new FakeBackend("claude")) {
  const { anna } = await family();
  claude.queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
  useFakes(claude);
  const week = (await anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;
  return { anna, claude, week };
}

beforeEach(() => vi.mocked(fetch).mockClear());
afterEach(() => {
  setProviderFactory(null);
  vi.mocked(fetch).mockImplementation(async () => new Response("", { status: 503 }));
});

describe("ricerca diretta sui siti", () => {
  it("tiene solo lo stesso piatto e lo ordina per somiglianza", () => {
    const found = resultLinks(
      links(
        "https://ricette.giallozafferano.it/Arrosto-di-maiale-con-prugne.html",
        "https://ricette.giallozafferano.it/Stinco-di-maiale-al-forno-con-patate.html",
        "https://ricette.giallozafferano.it/Arrosto-di-maiale-con-patate.html",
        "https://ricette.giallozafferano.it/Arrosto-di-maiale-con-prugne.html",
        "https://ricette.giallozafferano.it/Arrosto-di-maiale.html",
      ),
      /https:\/\/ricette\.giallozafferano\.it\/[A-Za-z0-9%_-]+\.html/g,
    );
    expect(found).toHaveLength(4);
    expect(rankRecipeLinks("Arrosto di maiale al forno con patate", found)).toEqual([
      "https://ricette.giallozafferano.it/Arrosto-di-maiale-con-patate.html",
    ]);
    // Senza il contorno del titolo non è lo stesso piatto
    expect(rankRecipeLinks("Arrosto di maiale", found)).toEqual([
      "https://ricette.giallozafferano.it/Arrosto-di-maiale.html",
      // a parità di somiglianza resta l'ordine del sito
      "https://ricette.giallozafferano.it/Arrosto-di-maiale-con-prugne.html",
      "https://ricette.giallozafferano.it/Arrosto-di-maiale-con-patate.html",
    ]);
    const other = [
      "https://ricette.giallozafferano.it/Insalata-di-riso-basmati-e-selvaggio-alle-verdure.html",
      "https://ricette.giallozafferano.it/Insalata-di-pollo.html",
      "https://ricette.giallozafferano.it/Salmone-al-forno.html",
    ];
    expect(rankRecipeLinks("Riso basmati con verdure", other)).toEqual([]);
    expect(rankRecipeLinks("Petto di pollo alla piastra con insalata", other)).toEqual([]);
    expect(rankRecipeLinks("Salmone al forno con broccoli", other)).toEqual([]);
    expect(rankRecipeLinks("Salmone al forno", other)).toEqual(["https://ricette.giallozafferano.it/Salmone-al-forno.html"]);
    // ingrediente in più o metodo di cottura diverso: non è lo stesso piatto
    expect(rankRecipeLinks("Penne al pomodoro", ["https://ricette.giallozafferano.it/Penne-ai-carciofi-e-pomodoro.html"], new Set(["carciofi"]))).toEqual([]);
    expect(rankRecipeLinks("Salmone al forno con broccoli", ["https://ricette.giallozafferano.it/Salmone-al-vapore-con-crema-di-broccoli.html"])).toEqual([]);
    expect(rankRecipeLinks("Lasagne", ["https://ricette.giallozafferano.it/Lasagne-alla-Bolognese.html"], new Set(["carciofi"]))).toHaveLength(1);
  });

  it("separa il contorno solo quando resta un piatto riconoscibile", () => {
    expect(splitSide("Saltimbocca alla romana con insalata")).toEqual({ main: "Saltimbocca alla romana", side: "insalata" });
    expect(splitSide("Petto di pollo al limone con spinaci")).toEqual({ main: "Petto di pollo al limone", side: "spinaci" });
    expect(splitSide("Piadina con prosciutto, rucola e stracchino")).toBeNull();
    expect(splitSide("Pasta con le sarde")).toBeNull();
    expect(splitSide("Frittata di zucchine")).toBeNull();
  });

  it("legge procedimento, ingredienti e porzioni togliendo i rimandi alle foto", async () => {
    const page = await extractRecipePage(recipePage({
      recipeYield: ["6", "6 persone"],
      recipeIngredient: ["Spalla di maiale 1,2 kg", "Sale q.b."],
      recipeInstructions: [
        { "@type": "HowToStep", text: "Legate la carne con lo spago 1 ; salate 2 e massaggiate 3" },
        { "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "Cuocete in forno a 180° per 20 minuti 4.&nbsp;" }] },
      ],
    }), GZ);
    expect(page).toEqual({
      image: PHOTO,
      steps: "1. Legate la carne con lo spago; salate e massaggiate\n\n2. Cuocete in forno a 180° per 20 minuti.",
      ingredients: ["Spalla di maiale 1,2 kg", "Sale q.b."],
      yield: 6,
    });
    expect(cleanSteps("Mescolate bene.\nServite.")).toBe("1. Mescolate bene.\n\n2. Servite.");
    expect(cleanSteps([])).toBeNull();
  });
});

describe("ricette dai siti, AI solo se mancano", () => {
  it("in background usa la ricetta del sito: procedimento, foto e ingredienti scalati, nessuna AI", async () => {
    sites({ [GZ]: FRITTATA });
    const { anna, claude, week } = await generated();
    const fresh = (await anna.req("GET", `/api/weeks/${week.id}`)).data.week;
    const meal = mealAt(fresh, "2030-01-07", "dinner");
    expect(meal.recipe).toMatchObject({ source_url: GZ, image_url: PHOTO });
    // 6 uova da 55 g per 4 persone → 2 porzioni
    expect(meal.recipe.ingredients).toEqual(expect.arrayContaining([{ name: "uova", grams: 165 }, { name: "zucchine", grams: 200 }]));
    expect(meal.recipe.ingredients.map((i: any) => i.name)).not.toContain("sale fino");

    const r = await anna.req("GET", `/api/recipes/${meal.recipe.id}`);
    expect(r.data.recipe.steps).toBe("1. Sbattete le uova.\n\n2. Unite le zucchine e cuocete.");
    expect(r.data.recipe.details_status).toBe("ready");
    expect(claude.count("steps")).toBe(0);
    expect(claude.count("search")).toBe(0);
  });

  it("piatto con contorno: ricetta del sito per il piatto principale, contorno scritto da Haiku e nella spesa", async () => {
    const SALMONE = "https://ricette.giallozafferano.it/Salmone-al-forno.html";
    sites({
      [SALMONE]: recipePage({ recipeYield: "4", recipeIngredient: ["Salmone 800 g", "Limone 1"], recipeInstructions: ["Infornate il salmone a 200° per 15 minuti."] }),
    });
    const claude = new FakeBackend("claude");
    claude.queue("side", '{"steps": "1. Lessate i broccoli per 8 minuti e conditeli con olio."}');
    const { anna, week } = await generated(claude);
    const meal = mealAt((await anna.req("GET", `/api/weeks/${week.id}`)).data.week, "2030-01-08", "dinner");
    expect(meal.recipe).toMatchObject({ source_url: SALMONE, image_url: PHOTO });
    const r = (await anna.req("GET", `/api/recipes/${meal.recipe.id}`)).data.recipe;
    expect(r.steps).toBe("1. Infornate il salmone a 200° per 15 minuti.\n\nContorno: broccoli\n\n1. Lessate i broccoli per 8 minuti e conditeli con olio.");
    const names = r.ingredients.map((i: any) => i.name);
    expect(names).toContain("broccoli");
    expect(r.ingredients).toEqual(expect.arrayContaining([{ name: "salmone", grams: 400 }]));
    expect(names.filter((n: string) => n === "salmone")).toHaveLength(1);
    expect(claude.count("side")).toBe(1);
    expect(claude.count("steps")).toBe(0);
  });

  it("scarta la ricetta del sito che contiene un allergene del nucleo e prova il sito successivo", async () => {
    sites({
      [GZ]: recipePage({ recipeYield: "4", recipeIngredient: ["Uova 6", "Zucchine 400 g", "Noci 50 g"], recipeInstructions: ["Con le noci."] }),
      [BENEDETTA]: FRITTATA,
    });
    const { anna, week } = await generated();
    const meal = mealAt((await anna.req("GET", `/api/weeks/${week.id}`)).data.week, "2030-01-07", "dinner");
    expect(meal.recipe.source_url).toBe(BENEDETTA);
    expect(meal.recipe.ingredients.map((i: any) => i.name)).not.toContain("noci");
  });

  it("senza ricetta sui siti scrive il procedimento con l'AI, senza ricerca web a pagamento", async () => {
    sites({});
    const claude = new FakeBackend("claude");
    const { anna, week } = await generated(claude);
    const meal = mealAt(week, "2030-01-07", "dinner");
    claude.queue("steps", RECORDED.steps);
    const r = await anna.req("GET", `/api/recipes/${meal.recipe.id}`);
    expect(r.data.recipe.steps).toContain("Cuoci la pasta");
    expect(r.data.recipe.source_url).toBeNull();
    expect(r.data.recipe.details_status).toBe("ready");
    expect(claude.count("search")).toBe(0);
  });

  it("con i siti irraggiungibili il background non paga l'AI e riprova solo dopo un giorno", async () => {
    sites({}, { down: true });
    const claude = new FakeBackend("claude");
    claude.defaults.steps = RECORDED.steps;
    const { anna, week } = await generated(claude);
    expect(claude.count("steps")).toBe(0);
    const searches = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/ricerca-ricette/")).length;
    const first = searches();
    expect(first).toBeGreaterThan(0);
    await anna.req("GET", `/api/weeks/${week.id}`);
    expect(searches()).toBe(first);
    expect(claude.count("steps")).toBe(0);
  });

  it("dopo la spesa non cambia gli ingredienti, ma usa comunque procedimento e foto", async () => {
    sites({}, { down: true });
    const { anna, week } = await generated();
    await env.DB.prepare("UPDATE weeks SET status = 'shopped' WHERE id = ?").bind(week.id).run();
    const meal = mealAt(week, "2030-01-07", "dinner");
    const before = meal.recipe.ingredients;
    sites({ [GZ]: FRITTATA });
    const r = await anna.req("GET", `/api/recipes/${meal.recipe.id}`);
    expect(r.data.recipe.source_url).toBe(GZ);
    expect(r.data.recipe.image_url).toBe(PHOTO);
    expect(r.data.recipe.ingredients).toEqual(before);
  });
});
