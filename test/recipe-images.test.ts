import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractRecipeImage, fetchRecipeImage, recipePageUrl } from "../src/server/services/recipeImages";
import { env, login } from "./helpers";

const PAGE = "https://ricette.giallozafferano.it/Risotto-alla-zucca.html";
const PHOTO = "https://www.giallozafferano.it/images/risotto.jpg";
const htmlResponse = (html: string) => new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const photoMeta = '<meta property="og:image" content="' + PHOTO + '">';

beforeEach(() => vi.mocked(fetch).mockClear());

describe("foto dalla pagina originale, senza AI", () => {
  it("legge Open Graph indipendentemente dall'ordine degli attributi e risolve URL relativi", async () => {
    const html = '<meta content="/images/risotto.jpg?width=900&amp;height=600" property="og:image">';
    expect(await extractRecipeImage(html, PAGE)).toBe("https://ricette.giallozafferano.it/images/risotto.jpg?width=900&height=600");
  });
  it("preferisce la foto della Recipe JSON-LD al logo generico Open Graph", async () => {
    const data = { "@graph": [{ "@type": "WebSite", image: "/logo.jpg" }, { "@type": ["Thing", "Recipe"], image: [{ "@type": "ImageObject", contentUrl: PHOTO }] }] };
    const html = '<meta property="og:image" content="/logo.jpg"><script type="application/ld+json">' + JSON.stringify(data) + '</script>';
    expect(await extractRecipeImage(html, PAGE)).toBe(PHOTO);
  });
  it("gestisce più blocchi JSON-LD e JSON non valido, con fallback Twitter", async () => {
    const html = '<script type="application/ld+json">bad json</script><script type="application/ld+json">' + JSON.stringify({ "@type": "Recipe", image: [PHOTO] }) + '</script>';
    expect(await extractRecipeImage(html, PAGE)).toBe(PHOTO);
    expect(await extractRecipeImage('<meta name="twitter:image" content="/photo.jpg">', PAGE)).toBe("https://ricette.giallozafferano.it/photo.jpg");
  });
  it("ignora immagini locali, URL eseguibili e pagine senza foto", async () => {
    for (const value of ["http://localhost/photo.jpg", "https://127.0.0.1/photo.jpg", "javascript:alert(1)", "data:image/png;base64,xxx", "https://private.internal/photo.jpg"]) {
      expect(await extractRecipeImage('<meta property="og:image" content="' + value + '">', PAGE)).toBeNull();
    }
    expect(await extractRecipeImage("<title>Risotto</title>", PAGE)).toBeNull();
  });
  it("non segue redirect verso host estranei o privati", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/secret" } }));
    expect(await fetchRecipeImage(PAGE)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(recipePageUrl("https://giallozafferano.it.evil.example/recipe")).toBeNull();
    expect(recipePageUrl("https://user:pass@giallozafferano.it/recipe")).toBeNull();
    expect(await fetchRecipeImage("https://localhost/recipe")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("segue redirect interni validi ma esclude contenuti non HTML o troppo grandi", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: "/risotto/" } })).mockResolvedValueOnce(htmlResponse(photoMeta));
    expect(await fetchRecipeImage(PAGE)).toBe(PHOTO);
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("https://ricette.giallozafferano.it/risotto/");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not html", { headers: { "Content-Type": "application/json" } }));
    expect(await fetchRecipeImage(PAGE)).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(htmlResponse("x".repeat(2 * 1024 * 1024 + 1)));
    expect(await fetchRecipeImage(PAGE)).toBeNull();
  });
  it("un sito bloccato o non raggiungibile lascia la ricetta utilizzabile", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    expect(await fetchRecipeImage(PAGE)).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("blocked", { status: 403 }));
    expect(await fetchRecipeImage(PAGE)).toBeNull();
  });
});

describe("foto salvata e riutilizzata nel menù", () => {
  it("arricchisce una ricetta pronta senza provider AI e riusa il risultato", async () => {
    const a = await login('photo-' + crypto.randomUUID() + '@example.com', "Ada");
    const created = await a.req("POST", "/api/recipes", { mode: "own", title: "Risotto alla zucca", servings: 2, minutes: 30, ingredients: [{ name: "riso", grams: 180 }] });
    const id = created.data.recipe.id;
    await env.DB.prepare("UPDATE recipes SET source_url = ? WHERE id = ?").bind(PAGE, id).run();
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(htmlResponse(photoMeta));
    const detail = await a.req("GET", '/api/recipes/' + id);
    expect(detail.status).toBe(200);
    expect(detail.data.recipe.image_url).toBe(PHOTO);
    expect(fetch).toHaveBeenCalledTimes(1);
    await a.req("GET", '/api/recipes/' + id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await a.req("GET", "/api/recipes")).data.recipes.find((r: any) => r.id === id).image_url).toBe(PHOTO);
    const hid = (await a.req("GET", "/api/me")).data.household.id;
    const week = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO weeks (id, household_id, start_date, shopping_day) VALUES (?, ?, '2030-01-05', 6)").bind(week, hid),
      env.DB.prepare("INSERT INTO meals (id, week_id, date, slot, recipe_id, speed) VALUES (?, ?, '2030-01-05', 'lunch', ?, 'long')").bind(crypto.randomUUID(), week, id),
    ]);
    expect((await a.req("GET", '/api/weeks/' + week)).data.week.meals[0].recipe).toMatchObject({ image_url: PHOTO, source_url: PAGE });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("salva anche il tentativo senza foto e non ripete richieste a ogni apertura", async () => {
    const a = await login('no-photo-' + crypto.randomUUID() + '@example.com', "Ada");
    const created = await a.req("POST", "/api/recipes", { mode: "own", title: "Riso bianco", servings: 2, minutes: 15, ingredients: [{ name: "riso", grams: 180 }] });
    const id = created.data.recipe.id;
    await env.DB.prepare("UPDATE recipes SET source_url = ? WHERE id = ?").bind(PAGE, id).run();
    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(htmlResponse("<title>Pagina senza foto</title>"));
    expect((await a.req("GET", '/api/recipes/' + id)).status).toBe(200);
    expect((await a.req("GET", '/api/recipes/' + id)).data.recipe.image_url).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
