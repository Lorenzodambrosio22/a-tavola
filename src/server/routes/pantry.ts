import { Hono } from "hono";
import { z } from "zod";
import type { PantryItem } from "../../shared/types";
import { addDays, todayIn } from "../../domain/dates";
import { body, fail } from "../http";
import { all, run } from "../db/sql";
import type { AppEnv } from "../env";

export const pantryRoutes = new Hono<AppEnv>();
pantryRoutes.get("/pantry", async (c) => {
  const today = todayIn();
  const items = await all<PantryItem>(c.env.DB,
    "SELECT id, ingredient, grams, bought_on, expires_at, status FROM pantry_items WHERE household_id = ? AND status = 'ok' AND grams > 0 ORDER BY expires_at, ingredient", c.get("householdId"));
  return c.json({ items, today, expiring: items.filter((i) => i.expires_at >= today && i.expires_at <= addDays(today, 2)), expired: items.filter((i) => i.expires_at < today) });
});
pantryRoutes.patch("/pantry/:id", async (c) => {
  const data = await body(c, z.union([
    z.object({ status: z.enum(["used", "trashed"]) }),
    z.object({ grams: z.number().min(0).max(100000) }),
  ]));
  const res = "grams" in data
    ? await run(c.env.DB, "UPDATE pantry_items SET grams = ?, status = ? WHERE id = ? AND household_id = ?", data.grams, data.grams > 0 ? "ok" : "used", c.req.param("id"), c.get("householdId"))
    : await run(c.env.DB, "UPDATE pantry_items SET status = ?, grams = 0 WHERE id = ? AND household_id = ?", data.status, c.req.param("id"), c.get("householdId"));
  if (!res.meta.changes) fail(404, "Ingrediente non trovato");
  return c.json({ ok: true });
});
