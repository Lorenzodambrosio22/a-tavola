import { describe, expect, it } from "vitest";
import { buildShoppingList, formatQuantity, mergeShopping } from "../../src/domain/shopping";
import { allocateConsumption } from "../../src/domain/pantry";
import type { PantryItem } from "../../src/shared/types";

describe("lista della spesa", () => {
  it("accorpa nomi e quantità, separando le quote che non durerebbero", () => {
    const lines = buildShoppingList([
      { ingredient: " Cipolle ", grams: 150, date: "2030-01-05" },
      { ingredient: "cipolle", grams: 300, date: "2030-01-08" },
      { ingredient: "salmone", grams: 400, date: "2030-01-05" },
      { ingredient: "salmone", grams: 200, date: "2030-01-10" },
    ], "2030-01-05", (name) => ({ aisle: name === "salmone" ? "Pesce" : "Frutta e verdura", shelf_days: name === "salmone" ? 2 : 14, freezer_ok: true }));
    expect(lines).toHaveLength(3);
    expect(lines.find((i) => i.ingredient === "cipolle")).toMatchObject({ grams: 450, unit_label: "450 g (~3)", buy_on: "2030-01-05" });
    expect(lines.find((i) => i.buy_on === "2030-01-09")).toMatchObject({ grams: 200, frozen_hint: true });
  });
  it("usa durata prudente per sconosciuti e acquisto il giorno stesso per durata zero", () => {
    expect(buildShoppingList([{ ingredient: "ignoto", grams: 40, date: "2030-01-10" }], "2030-01-05", () => undefined)[0]).toMatchObject({ aisle: "Altro", buy_on: "2030-01-09", frozen_hint: false });
    expect(buildShoppingList([{ ingredient: "pesce", grams: 40, date: "2030-01-10" }], "2030-01-05", () => ({ aisle: "Pesce", shelf_days: 0, freezer_ok: false }))[0].buy_on).toBe("2030-01-10");
    expect(formatQuantity("latte", 1500)).toBe("1,5 l");
  });
  it("il ricalcolo conserva voci manuali e identità delle righe già spuntate", () => {
    const base = { ingredient: "riso", grams: 100, unit_label: "100 g", aisle: "Pasta, riso e cereali", buy_on: "2030-01-05", frozen_hint: false };
    const plan = mergeShopping([{ ...base, grams: 200 }], [{ ...base, id: "rice", manual: false, checked: true }, { ...base, id: "manual", ingredient: "caffè", manual: true, checked: true }]);
    expect(plan.update[0]).toMatchObject({ id: "rice", grams: 200 });
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
  });
});

describe("consumo dispensa", () => {
  it("usa prima il lotto che scade prima, escludendo scaduti e acquisti successivi al pasto", () => {
    const lot = (id: string, grams: number, bought_on: string, expires_at: string): PantryItem => ({ id, ingredient: "riso", grams, bought_on, expires_at, status: "ok" });
    const stock = [lot("late", 300, "2030-01-05", "2030-02-01"), lot("early", 100, "2030-01-05", "2030-01-10"), lot("expired", 900, "2029-12-01", "2030-01-01"), lot("future", 500, "2030-01-12", "2030-02-12")];
    expect(allocateConsumption(stock, "Riso", 250, "2030-01-08")).toEqual({ allocations: [{ id: "early", grams: 100 }, { id: "late", grams: 150 }], missing: 0 });
    expect(allocateConsumption(stock, "riso", 600, "2030-01-08").missing).toBe(200);
    expect(stock[1].grams).toBe(100);
  });
});
