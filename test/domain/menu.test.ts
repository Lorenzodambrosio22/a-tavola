import { describe, expect, it } from "vitest";
import { addDays, diffDays, isISODate, nextWeekday, weekday } from "../../src/domain/dates";
import { kcalPerServing } from "../../src/domain/nutrition";
import { scaleGrams, scaleIngredients } from "../../src/domain/portions";
import { defaultSpeed, planSlots, presence } from "../../src/domain/week";
import { extractJson, pickSourceUrl } from "../../src/server/ai/provider";

describe("date", () => {
  it("aritmetica su date ISO", () => {
    expect(addDays("2030-01-30", 3)).toBe("2030-02-02");
    expect(diffDays("2030-01-05", "2030-01-11")).toBe(6);
    expect(weekday("2030-01-05")).toBe(6);
    expect(nextWeekday("2030-01-07", 6)).toBe("2030-01-12");
    expect(nextWeekday("2030-01-05", 6)).toBe("2030-01-05");
    expect(isISODate("2030-02-30")).toBe(false);
  });
});

describe("settimana", () => {
  const members = [
    { id: "a", breakfast: true },
    { id: "b", breakfast: false },
  ];
  it("velocità di default", () => {
    expect(defaultSpeed("2030-01-05")).toBe("long"); // sabato
    expect(defaultSpeed("2030-01-07")).toBe("quick"); // lunedì
  });
  it("7 giorni, colazione se qualcuno la fa, assenze ricorrenti", () => {
    const plan = planSlots({
      startDate: "2030-01-05",
      members,
      recurring: [{ user_id: "b", weekday: 1, slot: "lunch" }],
      speeds: { "2030-01-07": "long" },
    });
    expect(plan).toHaveLength(21);
    const monLunch = plan.find((p) => p.date === "2030-01-07" && p.slot === "lunch")!;
    expect(monLunch.present).toEqual(["a"]);
    expect(monLunch.absent).toEqual(["b"]);
    expect(monLunch.speed).toBe("long");
    const bf = plan.find((p) => p.slot === "breakfast")!;
    expect(bf.eaters).toEqual(["a"]);
    expect(planSlots({ startDate: "2030-01-05", members: [{ id: "x", breakfast: false }], recurring: [] })).toHaveLength(14);
  });
  it("presenze", () => {
    expect(presence("dinner", members, ["a"])).toEqual({ present: ["b"], absent: ["a"] });
    expect(presence("breakfast", members, [])).toEqual({ present: ["a"], absent: [] });
  });
});

describe("porzioni e calorie", () => {
  it("scala i grammi sui presenti", () => {
    expect(scaleGrams(400, 3, 4)).toBe(300);
    expect(scaleGrams(5, 1, 4)).toBe(1.3);
    expect(scaleGrams(100, 0, 2)).toBe(0);
    expect(scaleIngredients([{ name: "pasta", grams: 320 }], 2, 4)).toEqual([{ name: "pasta", grams: 160 }]);
  });
  it("kcal per porzione e calorie parziali", () => {
    const table = new Map<string, number | null>([
      ["pasta", 359],
      ["passata di pomodoro", 36],
      ["sale", 0],
    ]);
    const r = kcalPerServing(
      [
        { name: "pasta", grams: 200 },
        { name: "passata di pomodoro", grams: 300 },
        { name: "Sale", grams: 5 },
      ],
      table,
      2,
    );
    expect(r).toEqual({ kcal: 413, partial: false, missing: [] });
    const p = kcalPerServing([{ name: "pasta", grams: 100 }, { name: "ingrediente misterioso", grams: 50 }], table, 1);
    expect(p).toEqual({ kcal: 359, partial: true, missing: ["ingrediente misterioso"] });
    expect(kcalPerServing([{ name: "x", grams: 1 }], table, 1).kcal).toBeNull();
  });
});

describe("output AI", () => {
  it("estrae JSON anche da blocchi markdown", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('ecco:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('testo {"a":3} fine')).toEqual({ a: 3 });
    expect(() => extractJson("niente")).toThrow();
  });
  it("salva solo URL presenti nei risultati, preferendo siti di ricette", () => {
    const c = ["https://blog.example.com/x", "https://www.giallozafferano.it/ricette/Lasagne.html"];
    expect(pickSourceUrl(c, "https://blog.example.com/x/")).toBe("https://blog.example.com/x");
    expect(pickSourceUrl(c, "https://inventato.it/lasagne")).toBe("https://www.giallozafferano.it/ricette/Lasagne.html");
    expect(pickSourceUrl(["https://blog.example.com/x"], null)).toBeNull();
    expect(pickSourceUrl([], "https://www.giallozafferano.it/x")).toBeNull();
  });
});
