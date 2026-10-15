// Date come stringhe ISO "YYYY-MM-DD" (giorni di calendario, senza fuso).

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * DAY_MS);
}

/** Giorni da `a` a `b` (b − a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 0 = domenica … 6 = sabato */
export function weekday(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}

/** Data di oggi nel fuso indicato (default Europa/Roma). */
export function todayIn(timeZone = "Europe/Rome", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA → YYYY-MM-DD
}

/** Prossimo giorno con il weekday indicato a partire da `from` (incluso). */
export function nextWeekday(from: string, wd: number): string {
  const delta = (wd - weekday(from) + 7) % 7;
  return addDays(from, delta);
}
