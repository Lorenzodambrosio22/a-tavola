import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { body, fail } from "../http";
import { first, newId, run, stmt } from "../db/sql";
import { getWeekRow } from "../services/weekView";
import { shoppingView } from "../services/shopping";
import { normalizeName } from "../../domain/text";
import { todayIn } from "../../domain/dates";
import { formatQuantity } from "../../domain/shopping";

export const shoppingRoutes = new Hono<AppEnv>();

shoppingRoutes.get("/shopping/:weekId", async (c) =>
  c.json(await shoppingView(c.env.DB, c.get("householdId"), c.req.param("weekId"), c.get("user").id)));

shoppingRoutes.post("/shopping/:weekId/items", async (c) => {
  const data = await body(c, z.object({
    ingredient: z.string().trim().min(1).max(80), grams: z.number().positive().max(100000).default(100),
    unit_label: z.string().trim().max(60).optional(), aisle: z.string().trim().min(1).max(60).default("Altro"),
  }));
  const db = c.env.DB;
  const week = await getWeekRow(db, c.get("householdId"), c.req.param("weekId"));
  if (!week) fail(404, "Settimana non trovata");
  if (week.status === "shopped") fail(409, "La lista è già confermata");
  const ingredient = normalizeName(data.ingredient);
  await run(db, `INSERT INTO shopping_items (id, week_id, ingredient, grams, unit_label, aisle, buy_on, manual)
    SELECT ?, ?, ?, ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM weeks WHERE id = ? AND status = 'draft')
    ON CONFLICT (week_id, ingredient, buy_on, manual) DO UPDATE SET grams = excluded.grams, unit_label = excluded.unit_label`,
    newId(), week.id, ingredient, data.grams, data.unit_label ?? formatQuantity(ingredient, data.grams), data.aisle, week.start_date, week.id);
  return c.json({ ok: true }, 201);
});

/** Inserisce un acquisto una sola volta; usato anche per le spese successive. */
function purchase(db: D1Database, householdId: string, weekId: string, date: string, itemId?: string) {
  return stmt(db, `INSERT OR IGNORE INTO pantry_items
    (id, household_id, ingredient, grams, bought_on, expires_at, shopping_item_id)
    SELECT lower(hex(randomblob(16))), ?, s.ingredient, s.grams, ?,
      date(?, '+' || COALESCE(r.shelf_days, 3) || ' days'), s.id
    FROM shopping_items s LEFT JOIN ingredients_ref r ON r.name = s.ingredient
    WHERE s.week_id = ? AND s.checked = 1 ${itemId ? "AND s.id = ?" : ""}`,
    householdId, date, date, weekId, ...(itemId ? [itemId] : []));
}

shoppingRoutes.patch("/shopping/:weekId/items/:id", async (c) => {
  const { checked } = await body(c, z.object({ checked: z.boolean() }));
  const db = c.env.DB;
  const week = await getWeekRow(db, c.get("householdId"), c.req.param("weekId"));
  if (!week) fail(404, "Settimana non trovata");
  const item = await first<{ id: string }>(db, "SELECT id FROM shopping_items WHERE id = ? AND week_id = ?", c.req.param("id"), week.id);
  if (!item) fail(404, "Voce non trovata");
  if (!checked && await first(db, "SELECT id FROM pantry_items WHERE shopping_item_id = ?", item.id)) {
    fail(409, "Acquisto già registrato: correggi la quantità in dispensa");
  }
  const statements = [stmt(db, "UPDATE shopping_items SET checked = ? WHERE id = ?", checked, item.id)];
  if (week.status === "shopped" && checked) statements.push(purchase(db, c.get("householdId"), week.id, todayIn(), item.id));
  await db.batch(statements);
  return c.json({ ok: true });
});

shoppingRoutes.delete("/shopping/:weekId/items/:id", async (c) => {
  const week = await getWeekRow(c.env.DB, c.get("householdId"), c.req.param("weekId"));
  if (!week) fail(404, "Settimana non trovata");
  if (week.status === "shopped") fail(409, "La lista è già confermata");
  const res = await run(c.env.DB, `DELETE FROM shopping_items WHERE id = ? AND week_id = ? AND manual = 1
    AND EXISTS (SELECT 1 FROM weeks WHERE id = ? AND status = 'draft')`, c.req.param("id"), week.id, week.id);
  if (!res.meta.changes) fail(404, "Voce manuale non trovata");
  return c.json({ ok: true });
});

shoppingRoutes.post("/shopping/:weekId/complete", async (c) => {
  const db = c.env.DB;
  const hid = c.get("householdId");
  const view = await shoppingView(db, hid, c.req.param("weekId"), c.get("user").id);
  if (view.status === "draft" && !view.items.some((i) => i.checked)) fail(409, "Spunta prima ciò che hai acquistato");
  await db.batch([
    purchase(db, hid, view.week_id, todayIn()),
    stmt(db, "UPDATE weeks SET status = 'shopped' WHERE id = ? AND household_id = ?", view.week_id, hid),
  ]);
  return c.json(await shoppingView(db, hid, view.week_id, c.get("user").id));
});
