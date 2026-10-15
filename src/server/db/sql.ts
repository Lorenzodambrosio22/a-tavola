export type Param = string | number | null | boolean;

function norm(params: Param[]): (string | number | null)[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
}

export function stmt(db: D1Database, sql: string, ...params: Param[]): D1PreparedStatement {
  return db.prepare(sql).bind(...norm(params));
}

export async function all<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T[]> {
  const r = await stmt(db, sql, ...params).all<T>();
  return r.results ?? [];
}

export async function first<T>(db: D1Database, sql: string, ...params: Param[]): Promise<T | null> {
  return (await stmt(db, sql, ...params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: Param[]): Promise<D1Result> {
  return stmt(db, sql, ...params).run();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Placeholder "?, ?, ?" per clausole IN. */
export function qs(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}
