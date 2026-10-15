import { describe, expect, it } from "vitest";
import { adaptSiteIngredients, parseIngredientLine, parseYield } from "../../src/domain/recipeIngredients";

describe("ingredienti dai siti di ricette", () => {
  it("converte unità, pezzi e quantità senza unità", () => {
    expect(parseIngredientLine("Spalla di maiale senza osso 1,2 kg")).toEqual({ name: "Spalla di maiale senza osso", grams: 1200, qb: false });
    expect(parseIngredientLine("Aglio 2 spicchi")).toEqual({ name: "Aglio", grams: 10, qb: false });
    expect(parseIngredientLine("Amido di mais (maizena) 1 cucchiaio")).toEqual({ name: "Amido di mais", grams: 12, qb: false });
    expect(parseIngredientLine("Scalogno 1")).toEqual({ name: "Scalogno", grams: 30, qb: false });
    expect(parseIngredientLine("uova 6")).toEqual({ name: "uova", grams: 330, qb: false });
    expect(parseIngredientLine("zucchine 350")).toEqual({ name: "zucchine", grams: 350, qb: false });
    expect(parseIngredientLine("cipolle 70 g q.b.")).toEqual({ name: "cipolle", grams: 70, qb: false });
    expect(parseIngredientLine("vino bianco 0,5 bicchiere")).toEqual({ name: "vino bianco", grams: 75, qb: false });
    expect(parseIngredientLine("200 g di farina")).toEqual({ name: "farina", grams: 200, qb: false });
  });

  it("le voci q.b. o senza quantità servono solo al controllo dei vincoli", () => {
    expect(parseIngredientLine("Sale fino q.b.")).toEqual({ name: "Sale fino", grams: null, qb: true });
    expect(parseIngredientLine("olio d'oliva")).toEqual({ name: "olio d'oliva", grams: null, qb: true });
  });

  it("legge le porzioni in vari formati", () => {
    expect(parseYield("6")).toBe(6);
    expect(parseYield(["4", "4 porzioni"])).toBe(4);
    expect(parseYield("Dosi per 4 persone")).toBe(4);
    expect(parseYield(undefined)).toBeNull();
  });

  it("scala sulle porzioni della ricetta del menù ed esclude le voci q.b. dalla spesa", () => {
    const out = adaptSiteIngredients(["Spalla di maiale 1,2 kg", "Aglio 2 spicchi", "Sale fino q.b.", "Pepe nero q.b."], 6, 2)!;
    expect(out.ingredients).toEqual([{ name: "spalla di maiale", grams: 400 }, { name: "aglio", grams: 3.3 }]);
    expect(out.allNames).toEqual(["Spalla di maiale", "Aglio", "Sale fino", "Pepe nero"]);
  });

  it("rinuncia senza porzioni o con troppi pezzi di peso ignoto", () => {
    expect(adaptSiteIngredients(["Farina 200 g"], null, 2)).toBeNull();
    expect(adaptSiteIngredients(["Cavolfiore 1", "Broccolo 1", "Farina 200 g"], 4, 2)).toBeNull();
  });
});
