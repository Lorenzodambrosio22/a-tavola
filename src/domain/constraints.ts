import type { ConstraintLevel } from "../shared/types";
import { foldAccents, normalizeName } from "./text";

export interface ConstraintRow {
  user_id: string;
  ingredient: string;
  level: ConstraintLevel;
}

export interface BlockedRow {
  user_id: string;
  dish_family: string;
}

/** gruppo allergene (es. "frutta a guscio") → ingredienti normalizzati */
export type AllergenGroups = Map<string, string[]>;

export const LEVEL_RANK: Record<ConstraintLevel, number> = { allergy: 4, never: 3, little: 2, dislike: 1 };

export function isForbidden(level: ConstraintLevel): boolean {
  return level === "allergy" || level === "never";
}

/** Restituisce il livello più forte tra i due. */
export function strongerLevel(a: ConstraintLevel, b: ConstraintLevel): ConstraintLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export function buildAllergenGroups(rows: { group_name: string; ingredient: string }[]): AllergenGroups {
  const g: AllergenGroups = new Map();
  for (const r of rows) {
    const k = normalizeName(r.group_name);
    const list = g.get(k) ?? [];
    list.push(normalizeName(r.ingredient));
    g.set(k, list);
  }
  return g;
}

/** Un vincolo su un gruppo (es. "glutine") vale per tutti gli ingredienti del gruppo, oltre che per il termine stesso. */
export function expandTerm(term: string, groups: AllergenGroups): string[] {
  const t = normalizeName(term);
  const members = groups.get(t) ?? [];
  return [t, ...members.filter((m) => m !== t)];
}

/** Varianti singolare/plurale italiane di una parola (uovo/uova/uovi, noce/noci, cipolla/cipolle, pesca/pesche). */
export function wordVariants(word: string): string[] {
  const w = foldAccents(word);
  const out = new Set([w]);
  if (w.length < 3) return [...out];
  const stem = w.slice(0, -1);
  const last = w.at(-1);
  if (last === "o") {
    ["i", "a"].forEach((s) => out.add(stem + s));
    if (/[cg]$/.test(stem)) out.add(stem + "hi"); // fungo → funghi
  }
  if (last === "a") {
    out.add(stem + "e");
    if (/[cg]$/.test(stem)) out.add(stem + "he"); // pesca → pesche
    if (/[cg]i$/.test(stem)) out.add(stem.slice(0, -1) + "e"); // arancia → arance
  }
  if (last === "e") {
    out.add(stem + "i");
    if (/(c|g)h$/.test(stem)) out.add(stem.slice(0, -1) + "a"); // pesche → pesca
    else if (/[cg]$/.test(stem)) out.add(stem + "ia"); // arance → arancia (ma pesce ≠ pesca)
    else out.add(stem + "a"); // carote → carota
  }
  if (last === "i") {
    ["o", "e"].forEach((s) => out.add(stem + s));
    if (/[cg]h$/.test(stem)) out.add(stem.slice(0, -1) + "o"); // funghi → fungo
  }
  return [...out];
}

function words(s: string): string[] {
  return foldAccents(normalizeName(s))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True se l'ingrediente corrisponde al termine vietato: uguale, oppure contiene
 * il termine come sequenza di parole intere (con varianti singolare/plurale).
 * Esempi: "noci tritate" ~ "noce"; "latte intero" ~ "latte"; "pesca" !~ "pesce".
 */
export function matchesTerm(ingredient: string, term: string): boolean {
  const iw = words(ingredient);
  const tw = words(term);
  if (!tw.length || !iw.length) return false;
  const variants = tw.map(wordVariants);
  for (let i = 0; i + tw.length <= iw.length; i++) {
    let ok = true;
    for (let j = 0; j < tw.length; j++) {
      if (!variants[j].includes(iw[i + j])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export interface Violation {
  user_id: string;
  kind: "ingredient" | "dish";
  /** termine del vincolo (o famiglia di piatto bloccata) */
  term: string;
  level?: "allergy" | "never";
  ingredient?: string;
}

export interface MealToCheck {
  ingredients: string[];
  dish_family: string;
}

/**
 * Controllo di sicurezza (§6.3): confronta il piatto con allergie e "mai" dei
 * presenti e con i loro piatti bloccati. Codice nostro, mai delegato all'AI.
 */
export function findViolations(
  meal: MealToCheck,
  presentIds: string[],
  constraints: ConstraintRow[],
  blocked: BlockedRow[],
  groups: AllergenGroups,
): Violation[] {
  const present = new Set(presentIds);
  const out: Violation[] = [];
  for (const c of constraints) {
    if (!present.has(c.user_id) || !isForbidden(c.level)) continue;
    const terms = expandTerm(c.ingredient, groups);
    for (const ing of meal.ingredients) {
      if (terms.some((t) => matchesTerm(ing, t))) {
        out.push({ user_id: c.user_id, kind: "ingredient", term: c.ingredient, level: c.level as "allergy" | "never", ingredient: ing });
      }
    }
  }
  const fam = normalizeName(meal.dish_family || "");
  if (fam) {
    for (const b of blocked) {
      if (present.has(b.user_id) && normalizeName(b.dish_family) === fam) {
        out.push({ user_id: b.user_id, kind: "dish", term: b.dish_family });
      }
    }
  }
  return out;
}

export interface AbsentWarning {
  user_id: string;
  allergen: string;
  ingredient: string;
}

/** Badge di avviso: il piatto contiene un allergene di una persona assente. */
export function absentAllergenWarnings(
  meal: MealToCheck,
  absentIds: string[],
  constraints: ConstraintRow[],
  groups: AllergenGroups,
): AbsentWarning[] {
  const absent = new Set(absentIds);
  const out: AbsentWarning[] = [];
  for (const c of constraints) {
    if (!absent.has(c.user_id) || c.level !== "allergy") continue;
    const terms = expandTerm(c.ingredient, groups);
    const hit = meal.ingredients.find((ing) => terms.some((t) => matchesTerm(ing, t)));
    if (hit) out.push({ user_id: c.user_id, allergen: c.ingredient, ingredient: hit });
  }
  return out;
}

export interface MergedPreferences {
  /** allergie + mai dei presenti, gruppi espansi */
  forbidden: string[];
  little: string[];
  dislike: string[];
  blockedDishes: string[];
}

/** Unione dei vincoli dei soli presenti, da passare al provider AI. */
export function mergePresentConstraints(
  presentIds: string[],
  constraints: ConstraintRow[],
  blocked: BlockedRow[],
  groups: AllergenGroups,
): MergedPreferences {
  const present = new Set(presentIds);
  const best = new Map<string, ConstraintLevel>();
  for (const c of constraints) {
    if (!present.has(c.user_id)) continue;
    const k = normalizeName(c.ingredient);
    const prev = best.get(k);
    best.set(k, prev ? strongerLevel(prev, c.level) : c.level);
  }
  const forbidden = new Set<string>();
  const little: string[] = [];
  const dislike: string[] = [];
  for (const [ing, level] of best) {
    if (isForbidden(level)) expandTerm(ing, groups).forEach((t) => forbidden.add(t));
    else if (level === "little") little.push(ing);
    else dislike.push(ing);
  }
  const blockedDishes = [...new Set(blocked.filter((b) => present.has(b.user_id)).map((b) => normalizeName(b.dish_family)))];
  return {
    forbidden: [...forbidden].sort(),
    little: little.filter((x) => !forbidden.has(x)).sort(),
    dislike: dislike.filter((x) => !forbidden.has(x)).sort(),
    blockedDishes: blockedDishes.sort(),
  };
}
