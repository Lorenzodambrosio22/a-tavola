import { useState } from "react";

/** Foto della pagina sorgente, senza download né immagini generate. */
export function RecipePhoto({ image, source, title, compact = false }: { image?: string | null; source?: string | null; title: string; compact?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!image || !source || failed === image) return null;
  let host: string;
  try {
    const photo = new URL(image), page = new URL(source);
    if (photo.protocol !== "https:" || page.protocol !== "https:") return null;
    host = page.hostname.replace(/^www\./, "");
  } catch { return null; }
  return <figure className={`recipe-photo ${compact ? "compact" : ""}`}>
    <img src={image} alt={`Foto di ${title} dal sito della ricetta`} loading={compact ? "lazy" : "eager"} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(image)} width="960" height="600" />
    <figcaption><a href={source} target="_blank" rel="noopener noreferrer" aria-label={`Foto e ricetta su ${host}`}>{host} ↗</a></figcaption>
  </figure>;
}
