/** Normalizza un nome di ingrediente: minuscolo, spazi compattati, senza punteggiatura ai bordi. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFC")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, "")
    .trim();
}

/** Versione senza accenti, usata solo per confronti tolleranti. */
export function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
