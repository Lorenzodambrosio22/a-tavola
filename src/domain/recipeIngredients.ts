import type { Ingredient } from "../shared/types";
import { scaleGrams } from "./portions";

/**
 * Ingredienti delle ricette dei siti ("Spalla di maiale 1,2 kg", "Aglio 2 spicchi",
 * "Sale q.b.") convertiti in grammi, senza AI. Le voci "q.b." non vanno nella spesa ma
 * restano disponibili per il controllo di allergie e divieti.
 */
export interface ParsedLine {
  name: string;
  grams: number | null;
  qb: boolean;
}

/** Grammi per unità di misura. */
const UNIT_GRAMS: [RegExp, number][] = [
  [/^(kg|chili|chilo)$/, 1000],
  [/^(g|gr|grammi?)$/, 1],
  [/^(l|litri?|lt)$/, 1000],
  [/^(dl)$/, 100],
  [/^(cl)$/, 10],
  [/^(ml)$/, 1],
  [/^cucchiain[oi]$/, 4],
  [/^cucchia(io|i)$/, 12],
  [/^bicchier[ei]$/, 150],
  [/^tazz[ae]$|^tazzin[ae]$/, 150],
  [/^spicch[io]$/, 5],
  [/^rametti?$|^rametto$/, 2],
  [/^foglie?$/, 1],
  [/^ciuff[oi]$|^mazzett[oi]$/, 20],
  [/^pizzic[oh]i?$|^pizzico$/, 1],
  [/^fett[ae]$/, 30],
  [/^bustin[ae]$/, 16],
  [/^panett[oi]$/, 25],
  [/^vasett[oi]$/, 125],
  [/^scatol[ae]$|^lattin[ae]$/, 240],
  [/^confezion[ei]$/, 250],
];

/** Peso medio di un pezzo, per righe senza unità ("Uova 2", "Scalogno 1"). */
const PIECE_GRAMS: [RegExp, number][] = [
  [/^uov[oa]|^tuorl|^album/, 55],
  [/^scalogn/, 30],
  [/^cipoll/, 150],
  [/^aglio/, 5],
  [/^carot/, 80],
  [/^patat/, 200],
  [/^zucchin/, 200],
  [/^melanzan/, 300],
  [/^peperon(?!cin)/, 200],
  [/^peperoncin/, 3],
  [/^pomodor(?!ini)/, 120],
  [/^pomodorin/, 15],
  [/^limon/, 120],
  [/^arance?|^arancia/, 200],
  [/^mel[ae]\b/, 180],
  [/^ser[ae]?\b|^pere?\b/, 180],
  [/^sedan/, 50],
  [/^finocch/, 250],
  [/^porr/, 150],
  [/^alloro|^foglia/, 1],
  [/^mozzarell/, 125],
  [/^petto di pollo|^petti di pollo/, 250],
  [/^cosce? di pollo|^sovracosc/, 200],
  [/^salsicc/, 100],
  [/^piadin/, 100],
  [/^panin/, 80],
  [/^tortill/, 60],
];

const QB = /\bq\.?\s*b\.?(?=\s|$)|\bquanto basta\b|\ba piacere\b|\bper (?:spolverare|guarnire|ungere|friggere)\b/i;
const NUMBER = "(\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?|½|¼|¾|\\d+/\\d+)";
const TRAILING = new RegExp(`^(.*?)\\s+${NUMBER}\\s*([a-zàèéìòù.]+)?\\s*$`, "i");
const LEADING = new RegExp(`^${NUMBER}\\s*([a-zàèéìòù.]+)?\\s+(?:di\\s+|d')?(.+)$`, "i");

function toNumber(raw: string): number {
  if (raw === "½") return 0.5;
  if (raw === "¼") return 0.25;
  if (raw === "¾") return 0.75;
  if (raw.includes("/")) {
    const [a, b] = raw.split("/").map(Number);
    return b ? a / b : NaN;
  }
  // "5-7": media dell'intervallo
  const parts = raw.split(/\s*[-–]\s*/).map((p) => Number(p.replace(",", ".")));
  return parts.reduce((s, n) => s + n, 0) / parts.length;
}

function unitGrams(unit: string): number | null {
  const u = unit.toLowerCase().replace(/\.$/, "");
  return UNIT_GRAMS.find(([re]) => re.test(u))?.[1] ?? null;
}

function pieceGrams(name: string): number | null {
  const n = name.toLowerCase();
  return PIECE_GRAMS.find(([re]) => re.test(n))?.[1] ?? null;
}

function cleanName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, "")
    .trim();
}

export function parseIngredientLine(line: string): ParsedLine | null {
  const text = line.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const withoutQb = text.replace(QB, " ").replace(/\s+/g, " ").trim();

  const parse = (name: string, amount: string, unit: string | undefined): ParsedLine | null => {
    const n = toNumber(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    const clean = cleanName(name);
    if (!clean) return null;
    if (unit) {
      const g = unitGrams(unit);
      if (g != null) return { name: clean, grams: n * g, qb: false };
      // "Zucchine 350" seguito da una parola che non è un'unità: la parola fa parte del nome
      return null;
    }
    // Senza unità: un numero grande sono grammi ("zucchine 350"), uno piccolo sono pezzi
    if (n > 20) return { name: clean, grams: n, qb: false };
    const piece = pieceGrams(clean);
    return { name: clean, grams: piece != null ? n * piece : null, qb: false };
  };

  const t = TRAILING.exec(withoutQb);
  if (t) {
    const parsed = parse(t[1], t[2], t[3]);
    if (parsed) return parsed;
  }
  const l = LEADING.exec(withoutQb);
  if (l) {
    const parsed = parse(l[3], l[1], l[2]) ?? (unitGrams(l[2] ?? "") == null ? parse(`${l[2] ?? ""} ${l[3]}`, l[1], undefined) : null);
    if (parsed) return parsed;
  }
  // Senza quantità ("Sale fino", "Pepe q.b."): solo per il controllo dei vincoli
  const name = cleanName(withoutQb);
  return name ? { name, grams: null, qb: true } : null;
}

/** Numero di porzioni da recipeYield: "6", "4 persone", ["4", "4 porzioni"], 4. */
export function parseYield(value: unknown): number | null {
  const list = Array.isArray(value) ? value : [value];
  for (const v of list) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(/\d+/.exec(v)?.[0]) : NaN;
    if (Number.isFinite(n) && n > 0 && n <= 50) return n;
  }
  return null;
}

export interface SiteIngredients {
  /** Ingredienti da comprare, in grammi, scalati sulle porzioni della nostra ricetta. */
  ingredients: Ingredient[];
  /** Tutti i nomi, anche "q.b.", per il controllo di allergie e divieti. */
  allNames: string[];
}

/**
 * Converte e scala gli ingredienti del sito. Restituisce null se le porzioni non sono note o
 * se troppe righe non si convertono: in quel caso si tengono gli ingredienti del menù.
 */
export function adaptSiteIngredients(lines: string[], siteYield: number | null, servings: number): SiteIngredients | null {
  const parsed = lines.map(parseIngredientLine).filter((p): p is ParsedLine => !!p);
  const allNames = parsed.map((p) => p.name);
  if (!siteYield || !parsed.length) return null;
  const measured = parsed.filter((p) => p.grams != null);
  // Pezzi senza peso noto ("Cavolfiore 1") falserebbero la spesa: se sono troppi si rinuncia
  const unknown = parsed.filter((p) => p.grams == null && !p.qb);
  if (!measured.length || unknown.length > Math.max(1, Math.floor(parsed.length / 4))) return null;
  const ingredients = measured
    .map((p) => ({ name: p.name.toLowerCase(), grams: scaleGrams(p.grams!, servings, siteYield) }))
    // L'acqua del rubinetto non va nella spesa
    .filter((i) => i.grams > 0 && !/^acqua\b(?! (?:frizzante|tonica|di cocco))/.test(i.name));
  return { ingredients, allNames };
}
