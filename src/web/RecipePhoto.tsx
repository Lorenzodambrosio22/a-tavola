import { useState } from "react";

/** Disegno di riserva per le schede: un'icona del tipo di piatto, ricavata dal titolo. */
const KINDS: [RegExp, string][] = [
  [/zupp|minestr|vellutat|brodo|passato/, "🥣"],
  [/insalat/, "🥗"],
  [/pizz|piadin|focacc|toast|panin|tramezz/, "🫓"],
  [/risott|riso/, "🍚"],
  [/pasta|spaghett|penne|fusill|rigaton|lasagn|tagliatell|gnocch|linguin|maccheron|orecchiett|ravioli|tortell/, "🍝"],
  [/pesce|merluzz|salmon|tonno|orata|branzin|spigol|gamber|cozz|vongol|calamar|sgombr|baccal/, "🐟"],
  [/pollo|tacchin/, "🍗"],
  [/manzo|maiale|vitello|brasat|arrost|saltimbocc|cotolett|bistecc|polpett|hamburger|salsicc|spezzatin/, "🥩"],
  [/uov|frittat|omelette/, "🍳"],
  [/torta|dolce|biscott|crostat|budino|yogurt|frutta/, "🍰"],
  [/legum|fagiol|ceci|lenticch|verdur|zucchin|melanzan|parmigian/, "🥦"],
];

function dishIcon(title: string): string {
  const t = title.toLowerCase();
  return KINDS.find(([re]) => re.test(t))?.[1] ?? "🍽️";
}

function Placeholder({ title }: { title: string }) {
  return <div className="recipe-photo compact placeholder" aria-hidden="true"><span>{dishIcon(title)}</span></div>;
}

/** Foto della pagina sorgente, senza download né immagini generate. Nelle schede, senza foto, un disegno di riserva. */
export function RecipePhoto({ image, source, title, compact = false }: { image?: string | null; source?: string | null; title: string; compact?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const fallback = compact ? <Placeholder title={title} /> : null;
  if (!image || !source || failed === image) return fallback;
  let host: string;
  try {
    const photo = new URL(image), page = new URL(source);
    if (photo.protocol !== "https:" || page.protocol !== "https:") return fallback;
    host = page.hostname.replace(/^www\./, "");
  } catch { return fallback; }
  return <figure className={`recipe-photo ${compact ? "compact" : ""}`}>
    <img src={image} alt={`Foto di ${title} dal sito della ricetta`} loading={compact ? "lazy" : "eager"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(image)} width="960" height="600" />
    <figcaption><a href={source} target="_blank" rel="noopener noreferrer" aria-label={`Foto e ricetta su ${host}`}>{host} ↗</a></figcaption>
  </figure>;
}
