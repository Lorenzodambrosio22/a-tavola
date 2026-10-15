import type { ConstraintLevel, RejectReason } from "../shared/types";
import { LEVEL_RANK } from "./constraints";
import { normalizeName } from "./text";

export interface ExistingConstraint {
  ingredient: string;
  level: ConstraintLevel;
}

export interface RejectionEffects {
  /** vincoli `dislike` imparati da creare */
  dislikes: string[];
  /** famiglia di piatto da bloccare */
  blockDish: string | null;
}

/**
 * Da un rifiuto ai vincoli da creare (§7):
 * - today → nulla (solo sostituzione)
 * - ingredient → `dislike` imparato per ciascun ingrediente, senza declassare vincoli più forti
 * - dish → piatto bloccato (dish_family)
 */
export function rejectionEffects(
  reason: RejectReason,
  ingredients: string[],
  dishFamily: string,
  existing: ExistingConstraint[],
): RejectionEffects {
  if (reason === "dish") {
    const fam = normalizeName(dishFamily);
    return { dislikes: [], blockDish: fam || null };
  }
  if (reason === "ingredient") {
    const have = new Map(existing.map((c) => [normalizeName(c.ingredient), c.level]));
    const out = new Set<string>();
    for (const raw of ingredients) {
      const n = normalizeName(raw);
      if (!n) continue;
      const lv = have.get(n);
      if (lv && LEVEL_RANK[lv] >= LEVEL_RANK.dislike) continue; // esiste già uguale o più forte
      out.add(n);
    }
    return { dislikes: [...out], blockDish: null };
  }
  return { dislikes: [], blockDish: null };
}

/** Ingredienti onnipresenti da non considerare nei rifiuti ripetuti. */
export const STAPLES = new Set([
  "sale",
  "sale grosso",
  "pepe nero",
  "olio extravergine d'oliva",
  "olio di semi",
  "acqua",
  "zucchero",
  "brodo vegetale",
]);

export interface PastRejection {
  reason: RejectReason;
  created_at: string; // ISO
  ingredients: string[];
}

/**
 * Rifiuti "solo oggi" ripetuti: 3 rifiuti di piatti con lo stesso ingrediente in 30 giorni
 * → domanda "Forse non ti piace X?". Esclude ingredienti già vincolati o già respinti.
 */
export function repeatedRejectionSuggestions(
  rejections: PastRejection[],
  now: Date,
  existing: ExistingConstraint[],
  dismissed: string[],
  threshold = 3,
  windowDays = 30,
): string[] {
  const since = now.getTime() - windowDays * 86_400_000;
  const skip = new Set([...existing.map((c) => normalizeName(c.ingredient)), ...dismissed.map(normalizeName), ...STAPLES]);
  const counts = new Map<string, number>();
  for (const r of rejections) {
    if (r.reason !== "today") continue;
    const t = Date.parse(r.created_at.includes("T") ? r.created_at : r.created_at.replace(" ", "T") + "Z");
    if (!(t >= since)) continue;
    for (const ing of new Set(r.ingredients.map(normalizeName))) {
      if (!ing || skip.has(ing)) continue;
      counts.set(ing, (counts.get(ing) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
}
