import type { Member, ProviderName } from "../../shared/types";
import { all, first, newId, run, stmt } from "./sql";

export interface Membership {
  household_id: string;
  role: "owner" | "member";
}

export async function getMembership(db: D1Database, userId: string): Promise<Membership | null> {
  return first<Membership>(db, "SELECT household_id, role FROM household_members WHERE user_id = ?", userId);
}

export async function createPersonalHousehold(db: D1Database, userId: string, name: string): Promise<Membership> {
  const id = newId();
  await db.batch([
    stmt(db, "INSERT INTO households (id, name) VALUES (?, ?)", id, name),
    stmt(db, "INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')", id, userId),
  ]);
  return { household_id: id, role: "owner" };
}

/** Ogni utente ha sempre un nucleo: se manca, crea quello personale. */
export async function ensureMembership(db: D1Database, user: { id: string; name: string; email: string }): Promise<Membership> {
  const m = await getMembership(db, user.id);
  if (m) return m;
  try {
    return await createPersonalHousehold(db, user.id, householdName(user));
  } catch {
    // Richiesta concorrente: il nucleo è già stato creato
    const again = await getMembership(db, user.id);
    if (again) return again;
    throw new Error("Impossibile creare il nucleo");
  }
}

export function householdName(user: { name: string; email: string }): string {
  const who = user.name?.trim() || user.email.split("@")[0];
  return `Casa di ${who}`;
}

export async function getHousehold(db: D1Database, id: string) {
  return first<{ id: string; name: string; provider: ProviderName | null }>(
    db,
    "SELECT id, name, provider FROM households WHERE id = ?",
    id,
  );
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  breakfast: number;
}

export async function listMembers(db: D1Database, householdId: string): Promise<Member[]> {
  const rows = await all<MemberRow>(
    db,
    `SELECT u.id, u.name, u.email, m.role, u.breakfast
       FROM household_members m JOIN "user" u ON u.id = m.user_id
      WHERE m.household_id = ?
      ORDER BY m.joined_at, u.email`,
    householdId,
  );
  return rows.map((r) => ({ ...r, breakfast: !!r.breakfast }));
}

export const MAX_INVITE_USES = 10;

export async function createInvite(db: D1Database, householdId: string, userId: string, maxUses = 1, now = new Date()) {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expires = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  await run(
    db,
    "INSERT INTO household_invites (token, household_id, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)",
    token,
    householdId,
    userId,
    expires,
    maxUses,
  );
  return { token, expires_at: expires, max_uses: maxUses };
}

export class HouseholdError extends Error {
  constructor(
    message: string,
    public status: 400 | 403 | 404 | 409 | 410 = 400,
  ) {
    super(message);
  }
}

/** Rimuove l'utente dal nucleo; gestisce nucleo vuoto e passaggio di proprietà. Restituisce true se il nucleo è stato eliminato. */
async function detach(db: D1Database, userId: string, householdId: string, moveRecipesTo: string | null): Promise<boolean> {
  await run(db, "DELETE FROM household_members WHERE user_id = ?", userId);
  const remaining = await all<{ user_id: string; role: string }>(
    db,
    "SELECT user_id, role FROM household_members WHERE household_id = ? ORDER BY joined_at",
    householdId,
  );
  if (remaining.length === 0) {
    if (moveRecipesTo) {
      await run(db, "UPDATE recipes SET household_id = ? WHERE household_id = ?", moveRecipesTo, householdId);
    }
    await run(db, "DELETE FROM households WHERE id = ?", householdId);
    return true;
  }
  if (!remaining.some((r) => r.role === "owner")) {
    await run(
      db,
      "UPDATE household_members SET role = 'owner' WHERE household_id = ? AND user_id = ?",
      householdId,
      remaining[0].user_id,
    );
  }
  return false;
}

/** Se il nucleo ha ancora il nome automatico, lo allinea al nuovo nome dell'utente. */
export async function renameDefaultHousehold(
  db: D1Database,
  householdId: string,
  user: { email: string; oldName: string; newName: string },
) {
  const defaults = [householdName({ name: user.oldName, email: user.email }), householdName({ name: "", email: user.email })];
  await run(
    db,
    "UPDATE households SET name = ? WHERE id = ? AND name IN (?, ?)",
    householdName({ name: user.newName, email: user.email }),
    householdId,
    ...defaults,
  );
}

export async function acceptInvite(db: D1Database, token: string, userId: string, now = new Date()) {
  const inv = await first<{ token: string; household_id: string; expires_at: string; uses: number; max_uses: number }>(
    db,
    "SELECT token, household_id, expires_at, uses, max_uses FROM household_invites WHERE token = ?",
    token,
  );
  if (!inv) throw new HouseholdError("Invito non trovato", 404);
  if (inv.uses >= inv.max_uses) throw new HouseholdError("Invito già usato", 410);
  if (inv.expires_at < now.toISOString()) throw new HouseholdError("Invito scaduto", 410);
  const target = await getHousehold(db, inv.household_id);
  if (!target) throw new HouseholdError("Il nucleo non esiste più", 404);

  const current = await getMembership(db, userId);
  if (current?.household_id === inv.household_id) throw new HouseholdError("Fai già parte di questo nucleo", 409);

  // Conta subito l'utilizzo; la condizione impedisce di superare il massimo con richieste concorrenti
  const upd = await run(
    db,
    "UPDATE household_invites SET uses = uses + 1, used_at = ? WHERE token = ? AND uses < max_uses",
    now.toISOString(),
    token,
  );
  if (!upd.meta.changes) throw new HouseholdError("Invito già usato", 410);

  if (current) await detach(db, userId, current.household_id, inv.household_id);
  await run(
    db,
    "INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')",
    inv.household_id,
    userId,
  );
  return target;
}

export async function leaveHousehold(db: D1Database, user: { id: string; name: string; email: string }) {
  const m = await getMembership(db, user.id);
  if (!m) return ensureMembership(db, user);
  const count = await first<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?",
    m.household_id,
  );
  if ((count?.n ?? 0) <= 1) throw new HouseholdError("Sei già nel tuo nucleo personale", 409);
  await detach(db, user.id, m.household_id, null);
  return createPersonalHousehold(db, user.id, householdName(user));
}
