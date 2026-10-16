import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Env } from "./env";
import { getAuth } from "./auth";
import { requireAuth } from "./http";
import { householdRoutes } from "./routes/household";
import { constraintRoutes } from "./routes/constraints";
import { weekRoutes } from "./routes/weeks";
import { recipeRoutes } from "./routes/recipes";
import { rejectionRoutes } from "./routes/rejections";
import { AiUnavailable } from "./ai";
import { shoppingRoutes } from "./routes/shopping";
import { pantryRoutes } from "./routes/pantry";
import { adminRoutes } from "./routes/admin";
import { consumePastMeals } from "./services/pantry";
import { addDays, todayIn } from "../domain/dates";

export const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  if (err instanceof AiUnavailable) {
    return c.json({ error: "Il servizio AI non risponde. Riprova tra poco." }, 503);
  }
  console.error(err);
  return c.json({ error: "Errore interno, riprova tra poco" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

// Metodi di accesso disponibili (pubblico, per la pagina di login)
app.get("/api/auth-options", (c) => c.json({ google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) }));

// Better Auth (login con codice via email o con Google)
app.on(["GET", "POST"], "/api/auth/*", (c) => getAuth(c.env, c.req.url).handler(c.req.raw));

// API protette
const api = new Hono<AppEnv>();
api.use("*", requireAuth);
api.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: "Origine della richiesta non consentita" }, 403);
  }
  await next();
});
api.route("/", householdRoutes);
api.route("/", constraintRoutes);
api.route("/", weekRoutes);
api.route("/", recipeRoutes);
api.route("/", rejectionRoutes);
api.route("/", shoppingRoutes);
api.route("/", pantryRoutes);
api.route("/", adminRoutes);
app.route("/api", api);

app.all("/api/*", (c) => c.json({ error: "Non trovato" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(consumePastMeals(env.DB, addDays(todayIn(), -1)));
  },
} satisfies ExportedHandler<Env>;
