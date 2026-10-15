import type { PantryItem } from "../shared/types";
import { normalizeName } from "./text";

/** Consumo FIFO per scadenza, senza quantità negative né uso di prodotti scaduti. */
export function allocateConsumption(items: PantryItem[], ingredient: string, grams: number, date: string) {
  let remaining = Math.max(0, grams);
  const allocations: { id: string; grams: number }[] = [];
  const lots = items.filter((i) => i.status === "ok" && i.grams > 0 && i.bought_on <= date && i.expires_at >= date && normalizeName(i.ingredient) === normalizeName(ingredient))
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at) || a.bought_on.localeCompare(b.bought_on) || a.id.localeCompare(b.id));
  for (const lot of lots) {
    const used = Math.min(remaining, lot.grams);
    if (used > 0) allocations.push({ id: lot.id, grams: used });
    remaining -= used;
    if (remaining <= 0) break;
  }
  return { allocations, missing: Math.round(remaining * 10) / 10 };
}
