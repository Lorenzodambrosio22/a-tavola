import { fetchRecipeHtml } from "./recipeImages";

/**
 * Ricerca diretta sui siti di ricette: nessuna AI e nessuna API a pagamento.
 * Se un sito cambia la pagina dei risultati, quel sito non restituisce link e si passa al successivo.
 */
const STOPWORDS = new Set(["di", "del", "della", "dei", "delle", "al", "alla", "alle", "ai", "allo", "con", "e", "in", "a", "da", "la", "il", "le", "lo", "gli", "i", "per", "su", "senza"]);

interface Site {
  search: (query: string) => string;
  links: RegExp;
}

/** In ordine di preferenza. Servono pagine con Recipe JSON-LD (foto, ingredienti, porzioni, procedimento). */
const SITES: Site[] = [
  {
    search: (q) => `https://www.giallozafferano.it/ricerca-ricette/${q}/`,
    links: /https:\/\/ricette\.giallozafferano\.it\/[A-Za-z0-9%_-]+\.html/g,
  },
  {
    search: (q) => `https://www.fattoincasadabenedetta.it/?s=${q}`,
    links: /https:\/\/www\.fattoincasadabenedetta\.it\/ricetta\/[a-z0-9-]+\//g,
  },
];

const PER_SITE = 2;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function slugWords(link: string): string[] {
  const last = link.replace(/\/$/, "").split("/").pop()!.replace(/\.html$/, "");
  try {
    return words(decodeURIComponent(last));
  } catch {
    return words(last);
  }
}

/** Parole sul metodo di cottura: non distinguono un piatto dall'altro. */
const METHOD = new Set(["forno", "piastra", "padella", "griglia", "vapore", "casa", "ricetta", "facile", "veloce", "classica", "classico"]);

/** Parole singole dei nomi degli ingredienti noti ("olio extravergine" → olio, extravergine). */
export function ingredientWords(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) for (const w of words(n)) if (w.length > 3) out.add(w);
  return out;
}

/**
 * Tiene solo i risultati che sono lo stesso piatto:
 * - la prima parola del risultato compare nel titolo ("Stinco di maiale" non vale per "Arrosto di maiale");
 * - almeno il 75% delle parole del titolo compare nel risultato;
 * - al massimo due parole in più, nessuna delle quali è un ingrediente ("Penne ai carciofi e pomodoro"
 *   non vale per "Penne al pomodoro") o un metodo di cottura diverso da quello del titolo.
 * Ordina per somiglianza; a parità resta l'ordine del sito.
 */
export function rankRecipeLinks(title: string, links: string[], ingredients: Set<string> = new Set()): string[] {
  const all = words(title);
  const wanted = new Set(all.filter((w) => !METHOD.has(w)));
  const methods = new Set(all.filter((w) => METHOD.has(w)));
  if (!wanted.size) return [];
  return links
    .map((link, index) => {
      const full = slugWords(link);
      const otherMethod = methods.size > 0 && full.some((w) => METHOD.has(w) && !methods.has(w));
      const slug = full.filter((w) => !METHOD.has(w));
      const extras = slug.filter((w) => !wanted.has(w));
      const hits = slug.length - extras.length;
      const ok =
        slug.length > 0 &&
        wanted.has(slug[0]) &&
        hits / wanted.size >= 0.75 &&
        extras.length <= 2 &&
        !extras.some((w) => ingredients.has(w)) &&
        !otherMethod;
      return { link, index, ok, score: hits - 0.3 * extras.length };
    })
    .filter((r) => r.ok)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.link);
}

export function bestRecipeLink(title: string, links: string[]): string | null {
  return rankRecipeLinks(title, links)[0] ?? null;
}

export function resultLinks(html: string, pattern: RegExp): string[] {
  return [...new Set(html.match(pattern) ?? [])].slice(0, 30);
}

export interface SearchResult {
  /** Pagine candidate, dal sito preferito al successivo. */
  urls: string[];
  /** Almeno un sito non ha risposto: conviene riprovare più tardi invece di ripiegare sull'AI. */
  incomplete: boolean;
}

export async function searchRecipeUrls(title: string, ingredients: Set<string> = new Set()): Promise<SearchResult> {
  const query = words(title).slice(0, 8).join("+");
  if (!query) return { urls: [], incomplete: false };
  const urls: string[] = [];
  let incomplete = false;
  for (const site of SITES) {
    const page = await fetchRecipeHtml(site.search(query));
    if (!page) {
      incomplete = true;
      continue;
    }
    urls.push(...rankRecipeLinks(title, resultLinks(page.html, site.links), ingredients).slice(0, PER_SITE));
  }
  return { urls, incomplete };
}
