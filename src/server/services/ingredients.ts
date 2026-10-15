import type { Ingredient } from "../../shared/types";
import { buildAllergenGroups, wordVariants, type AllergenGroups } from "../../domain/constraints";
import { normalizeName } from "../../domain/text";
import type { AiProvider } from "../ai";
import { all, stmt } from "../db/sql";

export interface RefRow {
  name: string;
  kcal_100g: number | null;
  aisle: string;
  shelf_days: number;
  freezer_ok: number;
}

const TTL = 5 * 60 * 1000;
let refCache: { at: number; map: Map<string, RefRow> } | null = null;
let groupCache: { at: number; groups: AllergenGroups } | null = null;

export function invalidateRefCache() {
  refCache = null;
}

export async function getRef(db: D1Database): Promise<Map<string, RefRow>> {
  if (refCache && Date.now() - refCache.at < TTL) return refCache.map;
  const rows = await all<RefRow>(db, "SELECT name, kcal_100g, aisle, shelf_days, freezer_ok FROM ingredients_ref");
  refCache = { at: Date.now(), map: new Map(rows.map((r) => [r.name, r])) };
  return refCache.map;
}

export async function getAllergenGroups(db: D1Database): Promise<AllergenGroups> {
  if (groupCache && Date.now() - groupCache.at < TTL) return groupCache.groups;
  const rows = await all<{ group_name: string; ingredient: string }>(db, "SELECT group_name, ingredient FROM allergen_groups");
  groupCache = { at: Date.now(), groups: buildAllergenGroups(rows) };
  return groupCache.groups;
}

export function kcalTable(ref: Map<string, RefRow>): Map<string, number | null> {
  return new Map([...ref].map(([k, v]) => [k, v.kcal_100g]));
}

/** Cerca nel riferimento il nome o una sua variante singolare/plurale (sull'ultima parola o sulla prima). */
function refVariant(name: string, ref: Map<string, RefRow>): string | null {
  if (ref.has(name)) return name;
  const words = name.split(" ");
  for (const idx of [0, words.length - 1]) {
    for (const v of wordVariants(words[idx])) {
      const cand = [...words.slice(0, idx), v, ...words.slice(idx + 1)].join(" ");
      if (ref.has(cand)) return cand;
    }
  }
  return null;
}

/**
 * Normalizza nomi di ingredienti: riferimento → alias in cache → varianti → mapIngredient
 * dell'AI (risultato salvato in ingredient_aliases). Se l'AI non risponde, resta il nome
 * normalizzato: il controllo di sicurezza non dipende mai dall'AI.
 */
export async function canonicalize(db: D1Database, provider: AiProvider | null, names: string[]): Promise<Map<string, string>> {
  const ref = await getRef(db);
  const out = new Map<string, string>();
  const pending = new Set<string>();
  for (const raw of names) {
    const n = normalizeName(raw);
    if (!n) continue;
    const hit = refVariant(n, ref);
    if (hit) out.set(n, hit);
    else pending.add(n);
  }
  if (pending.size) {
    const list = [...pending];
    const aliases = await all<{ alias: string; name: string }>(
      db,
      `SELECT alias, name FROM ingredient_aliases WHERE alias IN (${list.map(() => "?").join(",")})`,
      ...list,
    );
    for (const a of aliases) {
      out.set(a.alias, a.name);
      pending.delete(a.alias);
    }
  }
  if (pending.size && provider) {
    try {
      const mapped = await provider.mapIngredient([...pending], [...ref.keys()]);
      const toSave: [string, string][] = [];
      for (const n of pending) {
        const m = mapped[n];
        if (!m) continue;
        const canonical = refVariant(m, ref) ?? m;
        out.set(n, canonical);
        toSave.push([n, canonical]);
      }
      if (toSave.length) {
        await db.batch(toSave.map(([a, c]) => stmt(db, "INSERT OR REPLACE INTO ingredient_aliases (alias, name) VALUES (?, ?)", a, c)));
      }
    } catch (e) {
      console.warn("mapIngredient non disponibile:", (e as Error).message);
    }
  }
  for (const n of pending) if (!out.has(n)) out.set(n, n);
  return out;
}

/** Applica la normalizzazione a una lista di ingredienti, unendo i doppioni e conservando il nome originale. */
export async function normalizeIngredients(db: D1Database, provider: AiProvider | null, ingredients: Ingredient[]): Promise<Ingredient[]> {
  const map = await canonicalize(db, provider, ingredients.map((i) => i.name));
  const merged = new Map<string, Ingredient>();
  for (const i of ingredients) {
    const n = normalizeName(i.name);
    if (!n) continue;
    const name = map.get(n) ?? n;
    const prev = merged.get(name);
    const raws = new Set([prev?.raw, n !== name ? n : undefined].filter(Boolean) as string[]);
    merged.set(name, {
      name,
      grams: Math.round(((prev?.grams ?? 0) + Number(i.grams || 0)) * 10) / 10,
      ...(raws.size ? { raw: [...raws].join(", ") } : {}),
    });
  }
  return [...merged.values()];
}

/** Nomi da controllare per le allergie: canonico + originale. */
export function namesForCheck(ingredients: Ingredient[]): string[] {
  const out: string[] = [];
  for (const i of ingredients) {
    out.push(i.name);
    if (i.raw) out.push(...i.raw.split(", "));
  }
  return out;
}
