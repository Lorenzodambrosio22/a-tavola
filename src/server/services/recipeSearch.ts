import { fetchRecipeHtml } from "./recipeImages";

/**
 * Ricerca diretta sul sito di GialloZafferano: nessuna AI e nessuna API a pagamento.
 * Se il sito cambia la pagina dei risultati la ricerca restituisce null e si usa il fallback.
 */
const STOPWORDS = new Set(["di", "del", "della", "dei", "delle", "al", "alla", "alle", "ai", "allo", "con", "e", "in", "a", "da", "la", "il", "le", "lo", "gli", "i", "per", "su", "senza"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Sceglie il risultato che condivide più parole con il titolo; a parità vince il primo (più rilevante per il sito). */
export function bestRecipeLink(title: string, links: string[]): string | null {
  const wanted = new Set(words(title));
  let best: string | null = null;
  let bestScore = 0;
  for (const link of links) {
    const slug = words(decodeURIComponent(link.split("/").pop()!.replace(/\.html$/, "")));
    const hits = slug.filter((w) => wanted.has(w)).length;
    const score = hits - 0.1 * (slug.length - hits);
    if (hits > 0 && score > bestScore) [best, bestScore] = [link, score];
  }
  return best;
}

export function giallozafferanoLinks(html: string): string[] {
  const found = html.match(/https:\/\/ricette\.giallozafferano\.it\/[A-Za-z0-9%_-]+\.html/g) ?? [];
  return [...new Set(found)].slice(0, 30);
}

export async function searchRecipeUrl(title: string): Promise<string | null> {
  const query = words(title).slice(0, 8).join("+");
  if (!query) return null;
  const page = await fetchRecipeHtml(`https://www.giallozafferano.it/ricerca-ricette/${query}/`);
  return page ? bestRecipeLink(title, giallozafferanoLinks(page.html)) : null;
}
