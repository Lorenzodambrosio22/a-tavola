import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProviderFactory } from "../src/server/ai";
import { cleanSteps, extractRecipePage } from "../src/server/services/recipeImages";
import { bestRecipeLink, giallozafferanoLinks } from "../src/server/services/recipeSearch";
import { FakeBackend, RECORDED, useFakes } from "./fixtures/fake";
import { family, START } from "./family";

const PAGE = "https://ricette.giallozafferano.it/Frittata-di-zucchine.html";
const PHOTO = "https://www.giallozafferano.it/images/frittata.jpg";
const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const recipePage = (instructions: unknown) =>
  '<script type="application/ld+json">' + JSON.stringify({ "@type": "Recipe", image: PHOTO, recipeInstructions: instructions }) + "</script>";
const searchPage = (...links: string[]) => links.map((l) => `<a href="${l}">ricetta</a>`).join("");

/** Simula GialloZafferano: pagina dei risultati e pagine delle ricette. */
function site(pages: Record<string, string>) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/ricerca-ricette/")) return html(searchPage(...Object.keys(pages)));
    return pages[url] ? html(pages[url]) : new Response("", { status: 404 });
  });
}

function mealAt(week: any, date: string, slot: string) {
  return week.meals.find((m: any) => m.date === date && m.slot === slot);
}

beforeEach(() => vi.mocked(fetch).mockClear());
afterEach(() => {
  setProviderFactory(null);
  vi.mocked(fetch).mockImplementation(async () => new Response("", { status: 503 }));
});

describe("ricerca diretta su GialloZafferano", () => {
  it("sceglie il risultato con più parole in comune col titolo", () => {
    const links = giallozafferanoLinks(searchPage(
      "https://ricette.giallozafferano.it/Arrosto-di-maiale-con-prugne.html",
      "https://ricette.giallozafferano.it/Arrosto-di-maiale.html",
      "https://ricette.giallozafferano.it/Arrosto-di-maiale-con-patate.html",
      "https://ricette.giallozafferano.it/Arrosto-di-maiale.html",
    ));
    expect(links).toHaveLength(3);
    expect(bestRecipeLink("Arrosto di maiale al forno con patate", links)).toBe("https://ricette.giallozafferano.it/Arrosto-di-maiale-con-patate.html");
    expect(bestRecipeLink("Tiramisù", links)).toBeNull();
  });

  it("legge il procedimento dalla Recipe JSON-LD togliendo i rimandi alle foto", async () => {
    const page = await extractRecipePage(recipePage([
      { "@type": "HowToStep", text: "Legate la carne con lo spago 1 ; salate 2 e massaggiate 3" },
      { "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "Cuocete in forno a 180° per 20 minuti 4." }] },
    ]), PAGE);
    expect(page.image).toBe(PHOTO);
    expect(page.steps).toBe("1. Legate la carne con lo spago; salate e massaggiate\n\n2. Cuocete in forno a 180° per 20 minuti.");
    expect(cleanSteps("Mescolate bene.\nServite.")).toBe("1. Mescolate bene.\n\n2. Servite.");
    expect(cleanSteps([])).toBeNull();
  });
});

describe("dettaglio ricetta senza AI", () => {
  it("prepara foto e procedimento in background dopo la generazione, senza chiamate AI", async () => {
    const { anna } = await family();
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner"));
    useFakes(claude);
    site({ [PAGE]: recipePage(["Sbattete le uova.", "Unite le zucchine e cuocete."]) });

    const week = (await anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;
    const before = claude.calls.length;
    const fresh = (await anna.req("GET", `/api/weeks/${week.id}`)).data.week;
    const meal = mealAt(fresh, "2030-01-07", "dinner");
    expect(meal.recipe).toMatchObject({ source_url: PAGE, image_url: PHOTO });

    const r = await anna.req("GET", `/api/recipes/${meal.recipe.id}`);
    expect(r.data.recipe.steps).toBe("1. Sbattete le uova.\n\n2. Unite le zucchine e cuocete.");
    expect(r.data.recipe.details_status).toBe("ready");
    expect(claude.count("steps")).toBe(0);
    expect(claude.calls.length).toBe(before);
  });

  it("un tentativo in background senza risultati non si ripete subito", async () => {
    const { anna } = await family();
    useFakes(new FakeBackend("claude").queue("week", RECORDED.week).queue("meal", RECORDED.replaceOk("2030-01-05", "dinner")));
    site({});
    const week = (await anna.req("POST", "/api/weeks/generate", { start_date: START })).data.week;
    const searches = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/ricerca-ricette/")).length;
    const first = searches();
    expect(first).toBeGreaterThan(0);
    await anna.req("GET", `/api/weeks/${week.id}`);
    expect(searches()).toBe(first);
  });
});
