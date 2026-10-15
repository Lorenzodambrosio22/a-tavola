import type { Recipe } from "../../shared/types";
import { RECIPE_DOMAINS } from "../ai/prompts";
import { first, run } from "../db/sql";

const MAX_HTML_BYTES = 2 * 1024 * 1024;

function decodeAttribute(value: string | null): string | null {
  if (!value) return null;
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return named[code.toLowerCase()] ?? entity;
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
  });
}

/** Solo pagine dei siti di ricette già supportati, anche dopo ogni redirect. */
export function recipePageUrl(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return RECIPE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) ? url : null;
  } catch { return null; }
}

function imageUrl(value: unknown, base: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}

function schemaImage(value: unknown, base: string): string | null {
  if (typeof value === "string") return imageUrl(value, base);
  if (Array.isArray(value)) return value.map((v) => schemaImage(v, base)).find(Boolean) ?? null;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return imageUrl(o.contentUrl, base) ?? imageUrl(o.url, base);
  }
  return null;
}

function instructionText(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") return value.split(/\n+/);
  if (Array.isArray(value)) return value.flatMap((v) => instructionText(v, depth + 1));
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.itemListElement) return instructionText(o.itemListElement, depth + 1);
    return instructionText(o.text ?? o.name, depth + 1);
  }
  return [];
}

const QUANTITY_AFTER = /^\s*(?:g|gr|kg|ml|cl|l|°|cm|minut|or[ae]\b|second|uov|cucchia|spicch|fett|pezz|volt|giorn|porzion)/i;

/**
 * Passi dalla Recipe JSON-LD. GialloZafferano inserisce i rimandi alle foto come numeri
 * progressivi su tutto il procedimento ("la cottura 1 ; … salate 2 e"): si tolgono seguendo
 * quel contatore, lasciando le quantità vere ("per 5 minuti").
 */
export function cleanSteps(value: unknown): string | null {
  let next = 1;
  const steps = instructionText(value)
    .map((s) =>
      s
        .replace(/<[^>]*>/g, " ")
        .replace(/\s(\d{1,2})(?=\s|[;.,:!?)]|$)/g, (match, n: string, offset: number, all: string) => {
          if (Number(n) !== next || QUANTITY_AFTER.test(all.slice(offset + match.length))) return match;
          next++;
          return "";
        })
        .replace(/\s+([;.,:!?])/g, "$1")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => s.length > 2);
  return steps.length ? steps.map((s, i) => `${i + 1}. ${s}`).join("\n\n").slice(0, 12_000) : null;
}

function recipeSchema(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 10 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) return value.map((v) => recipeSchema(v, depth + 1)).find(Boolean) ?? null;
  const o = value as Record<string, unknown>;
  const types = Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]];
  if (types.some((t) => typeof t === "string" && /(^|[\/#])Recipe$/.test(t))) return o;
  return recipeSchema(o["@graph"], depth + 1) ?? recipeSchema(o.mainEntity, depth + 1);
}

export interface RecipePage { image: string | null; steps: string | null }

/** Foto (Recipe JSON-LD, poi Open Graph e Twitter Card) e procedimento dalla pagina originale. */
export async function extractRecipePage(html: string, pageUrl: string): Promise<RecipePage> {
  let recipeImage: string | null = null, steps: string | null = null, og: string | null = null, twitter: string | null = null;
  let json = "";
  const rewriter = new HTMLRewriter()
    .on("meta", { element(el) {
      const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").toLowerCase();
      const url = imageUrl(decodeAttribute(el.getAttribute("content")), pageUrl);
      if (["og:image", "og:image:url", "og:image:secure_url"].includes(key) && !og) og = url;
      if (["twitter:image", "twitter:image:src"].includes(key) && !twitter) twitter = url;
    } })
    .on('script[type="application/ld+json"]', {
      element(el) {
        json = "";
        el.onEndTag(() => {
          try {
            const recipe = recipeSchema(JSON.parse(json));
            if (recipe) {
              recipeImage ??= schemaImage(recipe.image, pageUrl);
              steps ??= cleanSteps(recipe.recipeInstructions);
            }
          } catch { /* Prova gli altri metadati. */ }
        });
      },
      text(chunk) { if (json.length < 256_000) json += chunk.text; },
    });
  await rewriter.transform(new Response(html, { headers: { "Content-Type": "text/html" } })).text();
  return { image: recipeImage ?? og ?? twitter, steps };
}

export async function extractRecipeImage(html: string, pageUrl: string): Promise<string | null> {
  return (await extractRecipePage(html, pageUrl)).image;
}

async function readHtml(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

/** Scarica una pagina dei siti supportati, seguendo solo redirect verso gli stessi siti. */
export async function fetchRecipeHtml(pageUrl: string): Promise<{ html: string; url: string } | null> {
  let url = recipePageUrl(pageUrl);
  if (!url) return null;
  const signal = AbortSignal.timeout(6000);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetch(url.href, { redirect: "manual", signal, headers: { Accept: "text/html,application/xhtml+xml" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        await response.body?.cancel();
        url = location ? recipePageUrl(location, url.href) : null;
        if (!url) return null;
        continue;
      }
      if (!response.ok || !/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get("Content-Type") ?? "")) {
        await response.body?.cancel(); return null;
      }
      const html = await readHtml(response);
      return html ? { html, url: url.href } : null;
    }
  } catch { /* Il sito non risponde o blocca l'anteprima: la ricetta rimane utilizzabile. */ }
  return null;
}

export async function fetchRecipePage(sourceUrl: string): Promise<RecipePage | null> {
  const page = await fetchRecipeHtml(sourceUrl);
  return page ? extractRecipePage(page.html, page.url) : null;
}

export async function fetchRecipeImage(sourceUrl: string): Promise<string | null> {
  return (await fetchRecipePage(sourceUrl))?.image ?? null;
}

/** Riutilizza la foto per 7 giorni; attende 24 ore dopo un tentativo senza foto. Nessuna AI. */
export async function ensureRecipeImage(db: D1Database, recipe: Recipe): Promise<Recipe> {
  if (!recipe.source_url) return recipe;
  const checked = await first<{ image_checked_at: string | null }>(db, "SELECT image_checked_at FROM recipes WHERE id = ?", recipe.id);
  const ttl = (recipe.image_url ? 7 : 1) * 86_400_000;
  if (checked?.image_checked_at && Date.now() - Date.parse(checked.image_checked_at) < ttl) return recipe;
  const image = await fetchRecipeImage(recipe.source_url);
  await run(db, "UPDATE recipes SET image_url = ?, image_checked_at = ? WHERE id = ? AND source_url = ?", image, new Date().toISOString(), recipe.id, recipe.source_url);
  return { ...recipe, image_url: image };
}
