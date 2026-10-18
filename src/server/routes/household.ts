import { Hono, type Context } from "hono";
import { z } from "zod";
import type { MeResponse } from "../../shared/types";
import { TASTE_DISHES } from "../../shared/tastes";
import type { AppEnv } from "../env";
import { body, fail } from "../http";
import {
  acceptInvite,
  createInvite,
  getHousehold,
  HouseholdError,
  leaveHousehold,
  listMembers,
  MAX_INVITE_USES,
  renameDefaultHousehold,
} from "../db/household";
import { all, first, run, stmt } from "../db/sql";

export const householdRoutes = new Hono<AppEnv>();

async function me(c: Context<AppEnv>): Promise<MeResponse> {
  const user = c.get("user");
  const hid = c.get("householdId");
  const [hh, members, u, tastes] = await Promise.all([
    getHousehold(c.env.DB, hid),
    listMembers(c.env.DB, hid),
    first<{ name: string; breakfast: number }>(c.env.DB, `SELECT name, breakfast FROM "user" WHERE id = ?`, user.id),
    all<{ dish_id: string }>(c.env.DB, "SELECT dish_id FROM taste_dishes WHERE user_id = ? ORDER BY dish_id", user.id),
  ]);
  return {
    user: { id: user.id, email: user.email, name: u?.name ?? "", breakfast: !!u?.breakfast, taste_dishes: tastes.map((t) => t.dish_id) },
    household: { id: hid, name: hh?.name ?? "", role: c.get("role"), provider: hh?.provider ?? null },
    members,
    isAdmin: c.get("isAdmin"),
    access: c.get("access"),
    onboarded: !!u?.name?.trim(),
  };
}

householdRoutes.get("/me", async (c) => c.json(await me(c)));

householdRoutes.patch("/me", async (c) => {
  const data = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(60).optional(),
      breakfast: z.boolean().optional(),
      taste_dishes: z.array(z.enum(TASTE_DISHES.map((d) => d.id))).max(TASTE_DISHES.length).optional(),
    }),
  );
  const user = c.get("user");
  const updates: D1PreparedStatement[] = [];
  if (data.name !== undefined && c.get("role") === "owner") {
    const old = await first<{ name: string }>(c.env.DB, `SELECT name FROM "user" WHERE id = ?`, user.id);
    await renameDefaultHousehold(c.env.DB, c.get("householdId"), { email: user.email, oldName: old?.name ?? "", newName: data.name });
  }
  if (data.name !== undefined) updates.push(stmt(c.env.DB, `UPDATE "user" SET name = ?, "updatedAt" = ? WHERE id = ?`, data.name, new Date().toISOString(), user.id));
  if (data.breakfast !== undefined) updates.push(stmt(c.env.DB, `UPDATE "user" SET breakfast = ? WHERE id = ?`, data.breakfast, user.id));
  if (data.taste_dishes !== undefined) {
    updates.push(stmt(c.env.DB, "DELETE FROM taste_dishes WHERE user_id = ?", user.id));
    for (const id of new Set(data.taste_dishes)) {
      updates.push(stmt(c.env.DB, "INSERT INTO taste_dishes (user_id, dish_id) VALUES (?, ?)", user.id, id));
    }
  }
  if (updates.length) await c.env.DB.batch(updates);
  return c.json(await me(c));
});

householdRoutes.patch("/household", async (c) => {
  const data = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(60).optional(),
      provider: z.enum(["claude", "workersAi"]).nullable().optional(),
    }),
  );
  if (c.get("role") !== "owner") fail(403, "Solo il proprietario può modificare il nucleo");
  const hid = c.get("householdId");
  if (data.name !== undefined) await run(c.env.DB, "UPDATE households SET name = ? WHERE id = ?", data.name, hid);
  if (data.provider !== undefined) await run(c.env.DB, "UPDATE households SET provider = ? WHERE id = ?", data.provider, hid);
  return c.json(await me(c));
});

householdRoutes.post("/household/invites", async (c) => {
  if (c.get("role") !== "owner") fail(403, "Solo il proprietario può invitare");
  // Il corpo è facoltativo: senza indicazioni il link vale per una persona
  const raw = await c.req.json().catch(() => ({}));
  const parsed = z.object({ max_uses: z.number().int().min(1).max(MAX_INVITE_USES).default(1) }).safeParse(raw ?? {});
  if (!parsed.success) fail(400, `Il link può valere da 1 a ${MAX_INVITE_USES} persone`);
  const inv = await createInvite(c.env.DB, c.get("householdId"), c.get("user").id, parsed.data.max_uses);
  const origin = new URL(c.req.url).origin;
  return c.json({ ...inv, url: `${origin}/invito/${inv.token}` });
});

householdRoutes.get("/household/invites/:token", async (c) => {
  const row = await first<{ name: string; expires_at: string; uses: number; max_uses: number }>(
    c.env.DB,
    `SELECT h.name, i.expires_at, i.uses, i.max_uses FROM household_invites i JOIN households h ON h.id = i.household_id WHERE i.token = ?`,
    c.req.param("token"),
  );
  if (!row) fail(404, "Invito non trovato");
  const valid = row.uses < row.max_uses && row.expires_at > new Date().toISOString();
  return c.json({ household_name: row.name, valid });
});

householdRoutes.post("/household/join", async (c) => {
  const { token } = await body(c, z.object({ token: z.string().min(8) }));
  try {
    await acceptInvite(c.env.DB, token, c.get("user").id);
  } catch (e) {
    if (e instanceof HouseholdError) fail(e.status, e.message);
    throw e;
  }
  const m = await first<{ household_id: string; role: "owner" | "member" }>(
    c.env.DB,
    "SELECT household_id, role FROM household_members WHERE user_id = ?",
    c.get("user").id,
  );
  c.set("householdId", m!.household_id);
  c.set("role", m!.role);
  return c.json(await me(c));
});

householdRoutes.post("/household/leave", async (c) => {
  try {
    const m = await leaveHousehold(c.env.DB, c.get("user"));
    c.set("householdId", m.household_id);
    c.set("role", m.role);
  } catch (e) {
    if (e instanceof HouseholdError) fail(e.status, e.message);
    throw e;
  }
  return c.json(await me(c));
});
