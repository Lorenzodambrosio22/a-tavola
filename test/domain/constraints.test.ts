import { describe, expect, it } from "vitest";
import {
  absentAllergenWarnings,
  buildAllergenGroups,
  findViolations,
  matchesTerm,
  mergePresentConstraints,
  strongerLevel,
  wordVariants,
  type ConstraintRow,
} from "../../src/domain/constraints";

const groups = buildAllergenGroups([
  { group_name: "frutta a guscio", ingredient: "noci" },
  { group_name: "frutta a guscio", ingredient: "nocciole" },
  { group_name: "frutta a guscio", ingredient: "mandorle" },
  { group_name: "glutine", ingredient: "pasta" },
  { group_name: "glutine", ingredient: "farina 00" },
  { group_name: "glutine", ingredient: "pane" },
]);

describe("matchesTerm", () => {
  it("riconosce uguaglianza, parole intere e singolare/plurale", () => {
    expect(matchesTerm("noci", "noci")).toBe(true);
    expect(matchesTerm("noci tritate", "noce")).toBe(true);
    expect(matchesTerm("uova", "uovo")).toBe(true);
    expect(matchesTerm("Cipolla rossa", "cipolle")).toBe(true);
    expect(matchesTerm("funghi porcini", "fungo")).toBe(true);
    expect(matchesTerm("arance", "arancia")).toBe(true);
    expect(matchesTerm("latte intero", "latte")).toBe(true);
    expect(matchesTerm("farina 00", "farina 00")).toBe(true);
  });
  it("non confonde parole diverse", () => {
    expect(matchesTerm("pesca", "pesce")).toBe(false);
    expect(matchesTerm("panna", "pane")).toBe(false);
    expect(matchesTerm("noce moscata", "nocciole")).toBe(false);
    expect(matchesTerm("pomodoro", "pomodori secchi")).toBe(false);
  });
  it("varianti", () => {
    expect(wordVariants("pesche")).toContain("pesca");
    expect(wordVariants("pesce")).not.toContain("pesca");
  });
});

describe("controllo di sicurezza", () => {
  const constraints: ConstraintRow[] = [
    { user_id: "anna", ingredient: "frutta a guscio", level: "allergy" },
    { user_id: "bruno", ingredient: "funghi", level: "never" },
    { user_id: "bruno", ingredient: "peperoni", level: "dislike" },
    { user_id: "carla", ingredient: "glutine", level: "allergy" },
  ];
  const blocked = [{ user_id: "bruno", dish_family: "lasagne" }];
  const pesto = { ingredients: ["basilico", "pinoli", "mandorle", "pasta"], dish_family: "pasta al pesto" };

  it("i vincoli valgono solo per i presenti (allergie comprese)", () => {
    expect(findViolations(pesto, ["bruno"], constraints, blocked, groups)).toEqual([]);
    const v = findViolations(pesto, ["anna", "bruno"], constraints, blocked, groups);
    expect(v).toEqual([
      { user_id: "anna", kind: "ingredient", term: "frutta a guscio", level: "allergy", ingredient: "mandorle" },
    ]);
  });

  it("espande i gruppi allergeni", () => {
    const v = findViolations(pesto, ["carla"], constraints, blocked, groups);
    expect(v.map((x) => x.ingredient)).toEqual(["pasta"]);
  });

  it("'mai' e piatti bloccati sono violazioni, 'non mi piace' no", () => {
    const lasagne = { ingredients: ["funghi", "peperoni"], dish_family: "Lasagne" };
    const v = findViolations(lasagne, ["bruno"], constraints, blocked, groups);
    expect(v.map((x) => x.kind).sort()).toEqual(["dish", "ingredient"]);
  });

  it("badge per allergeni di assenti", () => {
    const w = absentAllergenWarnings(pesto, ["anna", "bruno"], constraints, groups);
    expect(w).toEqual([{ user_id: "anna", allergen: "frutta a guscio", ingredient: "mandorle" }]);
  });

  it("unione dei vincoli dei presenti", () => {
    const m = mergePresentConstraints(
      ["anna", "bruno"],
      [...constraints, { user_id: "anna", ingredient: "peperoni", level: "never" }],
      blocked,
      groups,
    );
    expect(m.forbidden).toEqual(["frutta a guscio", "funghi", "mandorle", "nocciole", "noci", "peperoni"]);
    expect(m.dislike).toEqual([]);
    expect(m.blockedDishes).toEqual(["lasagne"]);
  });

  it("strongerLevel", () => {
    expect(strongerLevel("dislike", "never")).toBe("never");
    expect(strongerLevel("allergy", "little")).toBe("allergy");
  });
});
