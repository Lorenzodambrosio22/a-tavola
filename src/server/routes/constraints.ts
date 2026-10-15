import { Hono } from "hono";
import { z } from "zod";
import type { FoodConstraint, RecurringAbsence } from "../../shared/types";
import { normalizeName } from "../../domain/text";
import type { AppEnv } from "../env";
import { body, fail } from "../http";
import { all, first, newId, run, stmt } from "../db/sql";

export const constraintRoutes = new Hono<AppEnv>();

const LEVEL = z.enum(["allergy", "never", "little", "dislike"]);

constraintRoutes.get("/constraints", async (c) => {
  const rows = await all<FoodConstraint>(
    c.env.DB,
    "SELECT id, ingredient, level, source, created_at FROM food_constraints WHERE user_id = ? ORDER BY level, ingredient",
    c.get("user").id,
  );
  return c.json({ constraints: rows });
});

/** Aggiunge o aggiorna un vincolo manuale (l'utente può scegliere qualsiasi livello). */
constraintRoutes.post("/constraints", async (c) => {
  const data = await body(c, z.object({ ingredient: z.string().trim().min(1).max(60), level: LEVEL }));
  const userId = c.get("user").id;
  const ingredient = normalizeName(data.ingredient);
  await run(
    c.env.DB,
    `INSERT INTO food_constraints (id, user_id, ingredient, level, source) VALUES (?, ?, ?, ?, 'manual')
     ON CONFLICT (user_id, ingredient) DO UPDATE SET level = excluded.level, source = 'manual'`,
    newId(),
    userId,
    ingredient,
    data.level,
  );
  const row = await first<FoodConstraint>(
    c.env.DB,
    "SELECT id, ingredient, level, source, created_at FROM food_constraints WHERE user_id = ? AND ingredient = ?",
    userId,
    ingredient,
  );
  return c.json({ constraint: row }, 201);
});

/** Cambia livello (es. promuovere un "non mi piace" imparato a "mai"). */
constraintRoutes.patch("/constraints/:id", async (c) => {
  const data = await body(c, z.object({ level: LEVEL }));
  const r = await run(
    c.env.DB,
    "UPDATE food_constraints SET level = ? WHERE id = ? AND user_id = ?",
    data.level,
    c.req.param("id"),
    c.get("user").id,
  );
  if (!r.meta.changes) fail(404, "Vincolo non trovato");
  return c.json({ ok: true });
});

constraintRoutes.delete("/constraints/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM food_constraints WHERE id = ? AND user_id = ?", c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});

/** "Cose che ho imparato su di te": vincoli imparati + piatti bloccati. */
constraintRoutes.get("/learned", async (c) => {
  const userId = c.get("user").id;
  const [learned, blocked] = await Promise.all([
    all<FoodConstraint>(
      c.env.DB,
      "SELECT id, ingredient, level, source, created_at FROM food_constraints WHERE user_id = ? AND source = 'learned' ORDER BY created_at DESC",
      userId,
    ),
    all<{ dish_family: string; created_at: string }>(
      c.env.DB,
      "SELECT dish_family, created_at FROM blocked_dishes WHERE user_id = ? ORDER BY created_at DESC",
      userId,
    ),
  ]);
  return c.json({ learned, blocked });
});

constraintRoutes.delete("/blocked/:family", async (c) => {
  await run(
    c.env.DB,
    "DELETE FROM blocked_dishes WHERE user_id = ? AND dish_family = ?",
    c.get("user").id,
    decodeURIComponent(c.req.param("family")),
  );
  return c.json({ ok: true });
});

constraintRoutes.get("/absences/recurring", async (c) => {
  const rows = await all<RecurringAbsence>(
    c.env.DB,
    "SELECT weekday, slot FROM recurring_absences WHERE user_id = ? ORDER BY weekday, slot",
    c.get("user").id,
  );
  return c.json({ absences: rows });
});

constraintRoutes.put("/absences/recurring", async (c) => {
  const data = await body(
    c,
    z.object({
      absences: z
        .array(z.object({ weekday: z.number().int().min(0).max(6), slot: z.enum(["breakfast", "lunch", "dinner"]) }))
        .max(21),
    }),
  );
  const userId = c.get("user").id;
  const db = c.env.DB;
  await db.batch([
    stmt(db, "DELETE FROM recurring_absences WHERE user_id = ?", userId),
    ...data.absences.map((a) =>
      stmt(db, "INSERT OR IGNORE INTO recurring_absences (user_id, weekday, slot) VALUES (?, ?, ?)", userId, a.weekday, a.slot),
    ),
  ]);
  return c.json({ absences: data.absences });
});
