import { describe, expect, it } from "vitest";
import { addDays, todayIn } from "../src/domain/dates";
import { consumePastMeals } from "../src/server/services/pantry";
import { env, login, type Client } from "./helpers";

async function weekFor(client: Client) {
  const me = (await client.req("GET", "/api/me")).data;
  const id = crypto.randomUUID();
  const recipe = (await client.req("POST", "/api/recipes", {
    mode: "own", title: "Riso con salmone", servings: 2, minutes: 20,
    ingredients: [{ name: "riso", grams: 200 }, { name: "salmone", grams: 300 }],
  })).data.recipe;
  await env.DB.prepare("INSERT INTO weeks (id, household_id, start_date, shopping_day) VALUES (?, ?, '2030-01-05', 6)").bind(id, me.household.id).run();
  const meals = [crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch(meals.map((m, i) => env.DB.prepare("INSERT INTO meals (id, week_id, date, slot, recipe_id, speed) VALUES (?, ?, ?, 'dinner', ?, 'quick')").bind(m, id, i ? "2030-01-10" : "2030-01-05", recipe.id)));
  return { id, meals, hid: me.household.id };
}

describe("spesa condivisa e dispensa", () => {
  it("mostra le spunte a tutti i membri dello stesso nucleo", async () => {
    const a = await login(`shared-owner-${crypto.randomUUID()}@example.com`, "Ada");
    const b = await login(`shared-member-${crypto.randomUUID()}@example.com`, "Bea");
    const invite = (await a.req("POST", "/api/household/invites")).data;
    expect((await b.req("POST", "/api/household/join", { token: invite.token })).status).toBe(200);
    const w = await weekFor(a);
    const item = (await a.req("GET", `/api/shopping/${w.id}`)).data.items[0];
    expect((await a.req("PATCH", `/api/shopping/${w.id}/items/${item.id}`, { checked: true })).status).toBe(200);
    expect((await b.req("GET", `/api/shopping/${w.id}`)).data.items.find((i: any) => i.id === item.id).checked).toBe(true);
  });
  it("scala sulle presenze, mantiene spunte e voci manuali, esclude i pasti saltati", async () => {
    const a = await login(`shopping-${crypto.randomUUID()}@example.com`, "Ada");
    const week = await weekFor(a);
    let view = (await a.req("GET", `/api/shopping/${week.id}`)).data;
    expect(view.items.find((i: any) => i.ingredient === "riso").grams).toBe(200);
    const rice = view.items.find((i: any) => i.ingredient === "riso");
    await a.req("PATCH", `/api/shopping/${week.id}/items/${rice.id}`, { checked: true });
    await a.req("POST", `/api/shopping/${week.id}/items`, { ingredient: "caffè", grams: 250, aisle: "Bevande" });
    const skip = await a.req("POST", `/api/meals/${week.meals[1]}/absence`, { absent: true });
    expect(skip.data.meal.status).toBe("skipped");
    view = (await a.req("GET", `/api/shopping/${week.id}`)).data;
    expect(view.items.find((i: any) => i.id === rice.id)).toMatchObject({ grams: 100, checked: true });
    expect(view.items.find((i: any) => i.ingredient === "caffè")).toMatchObject({ manual: true, grams: 250 });
    expect(view.items.some((i: any) => i.buy_on > view.start_date)).toBe(false);
  });

  it("compra dopo i freschi, congela le quantità e registra ogni acquisto una sola volta", async () => {
    const a = await login(`purchase-${crypto.randomUUID()}@example.com`, "Ada");
    const w = await weekFor(a);
    const path = `/api/shopping/${w.id}`;
    const initial = (await a.req("GET", path)).data;
    const later = initial.items.find((i: any) => i.ingredient === "salmone" && i.buy_on > initial.start_date);
    expect(later).toMatchObject({ grams: 150, buy_on: "2030-01-09", frozen_hint: true });
    const first = initial.items.find((i: any) => i.ingredient === "riso");
    await a.req("PATCH", `${path}/items/${first.id}`, { checked: true });
    const complete = await a.req("POST", `${path}/complete`);
    expect(complete.status).toBe(200);
    expect(complete.data.status).toBe("shopped");
    await a.req("POST", `${path}/complete`);
    let pantry = (await a.req("GET", "/api/pantry")).data;
    expect(pantry.items).toHaveLength(1);
    expect(pantry.items[0]).toMatchObject({ ingredient: "riso", grams: 200, bought_on: todayIn() });
    await a.req("POST", `/api/meals/${w.meals[1]}/absence`, { absent: true });
    expect((await a.req("GET", path)).data.items).toEqual(complete.data.items);
    expect((await a.req("POST", `${path}/items`, { ingredient: "sale" })).status).toBe(409);
    // Un acquisto nei giorni successivi entra a sua volta in dispensa, senza doppioni.
    await a.req("PATCH", `${path}/items/${later.id}`, { checked: true });
    await a.req("PATCH", `${path}/items/${later.id}`, { checked: true });
    pantry = (await a.req("GET", "/api/pantry")).data;
    expect(pantry.items).toHaveLength(2);
    expect((await a.req("PATCH", `${path}/items/${first.id}`, { checked: false })).status).toBe(409);
    const fish = pantry.items.find((i: any) => i.ingredient === "salmone");
    expect((await a.req("PATCH", `/api/pantry/${fish.id}`, { grams: 75 })).status).toBe(200);
    expect((await a.req("GET", "/api/pantry")).data.items.find((i: any) => i.id === fish.id).grams).toBe(75);
    await a.req("PATCH", `/api/pantry/${fish.id}`, { status: "trashed" });
    expect((await a.req("GET", "/api/pantry")).data.items).toHaveLength(1);
  });

  it("isola lista e dispensa fra nuclei e verifica l'autenticazione", async () => {
    const a = await login(`owner-${crypto.randomUUID()}@example.com`, "Ada");
    const b = await login(`stranger-${crypto.randomUUID()}@example.com`, "Bea");
    const w = await weekFor(a);
    expect((await b.req("GET", `/api/shopping/${w.id}`)).status).toBe(404);
    expect((await b.req("POST", `/api/shopping/${w.id}/complete`)).status).toBe(404);
    expect((await b.req("PATCH", "/api/pantry/nope", { grams: 12 })).status).toBe(404);
    expect((await a.req("POST", `/api/shopping/${w.id}/complete`)).status).toBe(409);
  });

  it("il Cron scala FIFO e un retry concorrente non consuma due volte", async () => {
    const a = await login(`cron-${crypto.randomUUID()}@example.com`, "Ada");
    const w = await weekFor(a);
    const today = todayIn();
    await env.DB.prepare("UPDATE weeks SET status = 'shopped' WHERE id = ?").bind(w.id).run();
    await env.DB.batch([
      env.DB.prepare("UPDATE meals SET date = ? WHERE id = ?").bind(today, w.meals[0]),
      env.DB.prepare("UPDATE meals SET status = 'skipped' WHERE id = ?").bind(w.meals[1]),
    ]);
    const early = crypto.randomUUID(), late = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO pantry_items (id, household_id, ingredient, grams, bought_on, expires_at) VALUES (?, ?, 'riso', 80, ?, ?)").bind(early, w.hid, today, addDays(today, 1)),
      env.DB.prepare("INSERT INTO pantry_items (id, household_id, ingredient, grams, bought_on, expires_at) VALUES (?, ?, 'riso', 200, ?, ?)").bind(late, w.hid, today, addDays(today, 10)),
    ]);
    await Promise.all([consumePastMeals(env.DB, today), consumePastMeals(env.DB, today)]);
    expect(await env.DB.prepare("SELECT grams, status FROM pantry_items WHERE id = ?").bind(early).first()).toMatchObject({ grams: 0, status: "used" });
    expect(await env.DB.prepare("SELECT grams FROM pantry_items WHERE id = ?").bind(late).first()).toMatchObject({ grams: 180 });
    await consumePastMeals(env.DB, today);
    expect(await env.DB.prepare("SELECT grams FROM pantry_items WHERE id = ?").bind(late).first()).toMatchObject({ grams: 180 });
  });
});
