import { describe, expect, it } from "vitest";
import { rejectionEffects, repeatedRejectionSuggestions } from "../../src/domain/learning";

describe("apprendimento dai rifiuti", () => {
  it("today: nessun effetto", () => {
    expect(rejectionEffects("today", ["funghi"], "risotto", [])).toEqual({ dislikes: [], blockDish: null });
  });
  it("ingredient: dislike imparato, senza declassare vincoli più forti", () => {
    const r = rejectionEffects("ingredient", ["Funghi", "piselli", "noci"], "risotto", [
      { ingredient: "noci", level: "allergy" },
      { ingredient: "piselli", level: "dislike" },
    ]);
    expect(r).toEqual({ dislikes: ["funghi"], blockDish: null });
  });
  it("dish: blocca la famiglia del piatto", () => {
    expect(rejectionEffects("dish", [], " Lasagne ", [])).toEqual({ dislikes: [], blockDish: "lasagne" });
  });
});

describe("rifiuti ripetuti", () => {
  const now = new Date("2030-02-01T12:00:00Z");
  const r = (days: number, ingredients: string[], reason: "today" | "dish" = "today") => ({
    reason,
    created_at: new Date(now.getTime() - days * 86_400_000).toISOString(),
    ingredients,
  });

  it("3 rifiuti con lo stesso ingrediente in 30 giorni → domanda", () => {
    const list = [r(1, ["funghi", "riso", "sale"]), r(5, ["funghi", "pasta", "sale"]), r(20, ["funghi champignon", "funghi", "sale"])];
    expect(repeatedRejectionSuggestions(list, now, [], [])).toEqual(["funghi"]);
  });
  it("fuori finestra, altri motivi, ingredienti già noti o respinti → niente", () => {
    expect(repeatedRejectionSuggestions([r(1, ["funghi"]), r(5, ["funghi"]), r(40, ["funghi"])], now, [], [])).toEqual([]);
    expect(repeatedRejectionSuggestions([r(1, ["funghi"]), r(5, ["funghi"]), r(6, ["funghi"], "dish")], now, [], [])).toEqual([]);
    const three = [r(1, ["funghi"]), r(2, ["funghi"]), r(3, ["funghi"])];
    expect(repeatedRejectionSuggestions(three, now, [{ ingredient: "funghi", level: "dislike" }], [])).toEqual([]);
    expect(repeatedRejectionSuggestions(three, now, [], ["funghi"])).toEqual([]);
  });
  it("accetta date in formato SQLite", () => {
    const list = ["2030-01-30 10:00:00", "2030-01-29 10:00:00", "2030-01-28 10:00:00"].map((d) => ({ reason: "today" as const, created_at: d, ingredients: ["zucca"] }));
    expect(repeatedRejectionSuggestions(list, now, [], [])).toEqual(["zucca"]);
  });
});
