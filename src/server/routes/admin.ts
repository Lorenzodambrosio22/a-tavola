import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { body, fail } from "../http";
import { singleProvider, type WeekRequest } from "../ai";
import { isISODate } from "../../domain/dates";
import { planSlots } from "../../domain/week";
import { all, first, run } from "../db/sql";
import { effectiveAccess, isAdmin } from "../access";
import { sendAccessGranted } from "../email";
import { usageOf } from "../services/aiQuota";
import { householdOwnRecipes, loadHouseholdCtx, namesOf, peoplePrefs } from "../services/context";
import { pantryForPrompt, recentMeals, recipeRefs, violationsFor } from "../services/menu";
import { invalidateRefCache, normalizeIngredients } from "../services/ingredients";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("/admin/*", async (c, next) => {
  if (!c.get("isAdmin")) fail(403, "Accesso riservato all'amministratore");
  await next();
});

/** Richieste di accesso: prima quelle in attesa, poi le più recenti. */
adminRoutes.get("/admin/users", async (c) => {
  const users = await all<{ id: string; name: string; email: string; access: string; createdAt: string }>(
    c.env.DB,
    `SELECT id, name, email, access, "createdAt" FROM "user"
      ORDER BY CASE access WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, "createdAt" DESC LIMIT 200`,
  );
  return c.json({ users: users.map((u) => ({ ...u, access: effectiveAccess(c.env, u.email, u.access) })) });
});

adminRoutes.post("/admin/users/:id/:decision{approve|reject}", async (c) => {
  const db = c.env.DB;
  const u = await first<{ email: string; access: string }>(db, `SELECT email, access FROM "user" WHERE id = ?`, c.req.param("id"));
  if (!u) fail(404, "Utente non trovato");
  if (isAdmin(c.env, u.email)) fail(409, "L'amministratore ha sempre accesso");
  const access = c.req.param("decision") === "approve" ? "approved" : "rejected";
  await run(db, `UPDATE "user" SET access = ?, "updatedAt" = ? WHERE id = ?`, access, new Date().toISOString(), c.req.param("id"));
  let emailSent = false;
  if (access === "approved" && u.access !== "approved") {
    const appUrl = c.env.BETTER_AUTH_URL || new URL(c.req.url).origin;
    emailSent = await sendAccessGranted(c.env, u.email, appUrl).then(
      () => true,
      (e) => (console.error("Email di attivazione non inviata", (e as Error).message), false),
    );
  }
  return c.json({ ok: true, access, email_sent: emailSent });
});

/** Consumo AI di oggi (o del giorno indicato). */
adminRoutes.get("/admin/usage", async (c) => {
  const day = c.req.query("day");
  return c.json(await usageOf(c.env, day && isISODate(day) ? day : undefined));
});

adminRoutes.post("/admin/compare", async (c) => {
  const { start_date } = await body(c, z.object({ start_date: z.string().refine(isISODate) }));
  const db = c.env.DB;
  const hid = c.get("householdId");
  const ctx = await loadHouseholdCtx(db, hid);
  const slots = planSlots({ startDate: start_date, members: ctx.members, recurring: ctx.recurring, speeds: {} }).filter((s) => s.present.length);
  const request: WeekRequest = {
    meals: slots.map((s) => ({ date: s.date, slot: s.slot, speed: s.speed, present: namesOf(ctx, s.present) })),
    people: peoplePrefs(ctx, ctx.members.map((m) => m.id)),
    recent: await recentMeals(db, hid, start_date),
    household_recipes: recipeRefs(await householdOwnRecipes(db, hid)), favorites: [],
    pantry: await pantryForPrompt(db, hid),
  };
  const results = await Promise.all((["claude", "workersAi"] as const).map(async (name) => {
    const provider = singleProvider(c.env, name);
    const started = Date.now();
    if (!provider) return { provider: name, error: "Provider non configurato", latency_ms: 0, usage: null, meals: [], violations: 0, missing: slots.length };
    try {
      const result = await provider.generateWeek(request);
      let violations = 0;
      const meals = [];
      for (const m of result.meals) {
        const slot = slots.find((s) => s.date === m.date && s.slot === m.slot);
        if (!slot) continue;
        const ingredients = await normalizeIngredients(db, null, m.ingredients);
        const count = violationsFor(ctx, slot.present, ingredients, m.dish_family).length;
        violations += count;
        meals.push({ ...m, violation_count: count });
      }
      const unique = new Set(meals.map((m) => `${m.date}|${m.slot}`));
      return { provider: name, error: null, latency_ms: Date.now() - started, usage: provider.usage, meals, violations, missing: slots.length - unique.size };
    } catch {
      return { provider: name, error: "Generazione non riuscita", latency_ms: Date.now() - started, usage: provider.usage, meals: [], violations: 0, missing: slots.length };
    }
  }));
  return c.json({ results });
});

/** Riferimento consultabile; correzioni globali riservate all'admin. */
adminRoutes.get("/ingredients", async (c) => c.json({ ingredients: await all(c.env.DB, "SELECT * FROM ingredients_ref ORDER BY name") }));
adminRoutes.patch("/admin/ingredients/:name", async (c) => {
  const data = await body(c, z.object({ kcal_100g: z.number().min(0).max(1000).nullable(), shelf_days: z.number().int().min(0).max(3650), aisle: z.string().trim().min(1).max(60), freezer_ok: z.boolean() }));
  const res = await run(c.env.DB, "UPDATE ingredients_ref SET kcal_100g = ?, shelf_days = ?, aisle = ?, freezer_ok = ? WHERE name = ?", data.kcal_100g, data.shelf_days, data.aisle, data.freezer_ok, c.req.param("name"));
  if (!res.meta.changes) fail(404, "Ingrediente non trovato");
  invalidateRefCache();
  return c.json({ ok: true });
});
