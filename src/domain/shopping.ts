import { addDays, diffDays } from "./dates";
import { capitalize, normalizeName } from "./text";

export interface IngredientUse {
  ingredient: string;
  grams: number;
  /** data del pasto */
  date: string;
}

export interface RefInfo {
  aisle: string;
  shelf_days: number;
  freezer_ok: boolean;
}

/** Ingrediente sconosciuto: reparto "Altro", durata prudente 3 giorni (§11). */
export const UNKNOWN_REF: RefInfo = { aisle: "Altro", shelf_days: 3, freezer_ok: false };

export interface ShoppingLine {
  ingredient: string;
  grams: number;
  unit_label: string;
  aisle: string;
  buy_on: string;
  frozen_hint: boolean;
}

export const AISLE_ORDER = [
  "Frutta e verdura",
  "Pane e forno",
  "Carne",
  "Pesce",
  "Salumi",
  "Formaggi",
  "Latte, uova e latticini",
  "Pasta, riso e cereali",
  "Legumi e conserve",
  "Condimenti e spezie",
  "Frutta secca e semi",
  "Dolci e colazione",
  "Bevande",
  "Surgelati",
  "Altro",
];

/** Peso medio di un pezzo, per l'etichetta "(~3)". */
const PIECE_GRAMS: Record<string, number> = {
  cipolle: 150,
  "cipolle rosse": 150,
  scalogno: 30,
  porri: 150,
  carote: 80,
  patate: 200,
  "patate dolci": 300,
  pomodori: 120,
  zucchine: 200,
  melanzane: 300,
  peperoni: 200,
  cetrioli: 250,
  finocchi: 250,
  carciofi: 150,
  avocado: 200,
  limoni: 120,
  lime: 60,
  arance: 200,
  mandarini: 80,
  mele: 180,
  pere: 180,
  banane: 150,
  kiwi: 80,
  pesche: 150,
  uova: 60,
  mozzarella: 125,
  "mozzarella di bufala": 250,
  burrata: 200,
  "lattuga": 300,
  "cavolfiore": 800,
  "broccoli": 400,
  "zucca": 1500,
  "piadine": 100,
  "pane per hamburger": 60,
};

const LIQUIDS = new Set([
  "latte",
  "latte parzialmente scremato",
  "panna fresca",
  "panna da cucina",
  "brodo vegetale",
  "vino bianco",
  "vino rosso",
  "acqua",
  "acqua frizzante",
  "succo d'arancia",
  "birra",
  "bevanda di soia",
  "bevanda di mandorla",
  "bevanda di avena",
  "olio extravergine d'oliva",
  "olio di semi",
  "latte di cocco",
  "aceto di vino",
  "aceto di mele",
  "aceto balsamico",
  "salsa di soia",
]);

function roundQty(g: number): number {
  if (g < 10) return Math.max(1, Math.round(g));
  if (g < 100) return Math.round(g / 5) * 5;
  return Math.round(g / 10) * 10;
}

function fmt(n: number): string {
  return n.toLocaleString("it-IT", { maximumFractionDigits: 1 });
}

/** Etichetta leggibile della quantità, es. "450 g (~3)", "1,2 kg", "750 ml". */
export function formatQuantity(ingredient: string, grams: number): string {
  const name = normalizeName(ingredient);
  const q = roundQty(grams);
  const liquid = LIQUIDS.has(name);
  let base: string;
  if (q >= 1000) base = `${fmt(q / 1000)} ${liquid ? "l" : "kg"}`;
  else base = `${q} ${liquid ? "ml" : "g"}`;
  const piece = PIECE_GRAMS[name];
  if (piece && grams >= piece * 0.6) {
    const n = Math.max(1, Math.round(grams / piece));
    base += ` (~${n})`;
  }
  return base;
}

/** "Cipolle, 450 g (~3)" */
export function shoppingLabel(ingredient: string, unitLabel: string): string {
  return unitLabel ? `${capitalize(ingredient)}, ${unitLabel}` : capitalize(ingredient);
}

/**
 * Lista della spesa (§8): somma gli usi per ingrediente; ogni uso il cui pasto cade oltre
 * la durata dell'ingrediente (data_pasto − giorno_spesa > shelf_days) va in "da comprare
 * dopo" con buy_on = data_pasto − 1 (o il giorno stesso se l'ingrediente non dura un giorno),
 * con suggerimento "oppure surgelato" se congelabile.
 */
export function buildShoppingList(uses: IngredientUse[], shoppingDate: string, ref: (name: string) => RefInfo | undefined): ShoppingLine[] {
  const acc = new Map<string, { ingredient: string; grams: number; buy_on: string; info: RefInfo; later: boolean }>();
  for (const u of uses) {
    const name = normalizeName(u.ingredient);
    if (!name || !(u.grams > 0)) continue;
    const info = ref(name) ?? UNKNOWN_REF;
    const delta = diffDays(shoppingDate, u.date);
    const later = delta > info.shelf_days;
    let buyOn = shoppingDate;
    if (later) {
      buyOn = info.shelf_days >= 1 ? addDays(u.date, -1) : u.date;
      if (buyOn < shoppingDate) buyOn = shoppingDate;
    }
    const key = `${name}|${buyOn}`;
    const prev = acc.get(key);
    if (prev) prev.grams += u.grams;
    else acc.set(key, { ingredient: name, grams: u.grams, buy_on: buyOn, info, later: later && buyOn !== shoppingDate });
  }
  const lines = [...acc.values()].map((x) => ({
    ingredient: x.ingredient,
    grams: Math.round(x.grams * 10) / 10,
    unit_label: formatQuantity(x.ingredient, x.grams),
    aisle: x.info.aisle,
    buy_on: x.buy_on,
    frozen_hint: x.later && x.info.freezer_ok,
  }));
  return sortLines(lines);
}

export function sortLines<T extends { aisle: string; ingredient: string; buy_on: string }>(lines: T[]): T[] {
  const idx = (a: string) => {
    const i = AISLE_ORDER.indexOf(a);
    return i < 0 ? AISLE_ORDER.length : i;
  };
  return [...lines].sort((a, b) => a.buy_on.localeCompare(b.buy_on) || idx(a.aisle) - idx(b.aisle) || a.ingredient.localeCompare(b.ingredient));
}

export interface StoredItem extends ShoppingLine {
  id: string;
  manual: boolean;
  checked: boolean;
}

export interface MergePlan {
  insert: ShoppingLine[];
  update: (ShoppingLine & { id: string })[];
  remove: string[];
}

/**
 * Ricalcolo prima della spesa: conserva voci manuali e spunte (per ingrediente + data),
 * aggiorna le quantità, toglie le voci calcolate che non servono più.
 */
export function mergeShopping(fresh: ShoppingLine[], existing: StoredItem[]): MergePlan {
  const byKey = new Map(existing.filter((e) => !e.manual).map((e) => [`${e.ingredient}|${e.buy_on}`, e]));
  const plan: MergePlan = { insert: [], update: [], remove: [] };
  const seen = new Set<string>();
  for (const f of fresh) {
    const k = `${f.ingredient}|${f.buy_on}`;
    seen.add(k);
    const e = byKey.get(k);
    if (!e) plan.insert.push(f);
    else if (e.grams !== f.grams || e.unit_label !== f.unit_label || e.aisle !== f.aisle || e.frozen_hint !== f.frozen_hint) {
      plan.update.push({ ...f, id: e.id });
    }
  }
  for (const [k, e] of byKey) if (!seen.has(k)) plan.remove.push(e.id);
  return plan;
}
