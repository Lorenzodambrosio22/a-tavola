import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { getAuth } from "./auth";
import type { AppEnv } from "./env";
import { ensureMembership } from "./db/household";

export function fail(status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 502 | 503, message: string): never {
  throw new HTTPException(status, { message });
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = getAuth(c.env, c.req.url);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) fail(401, "Accesso richiesto");
  const user = { id: session.user.id, email: session.user.email, name: session.user.name ?? "" };
  const m = await ensureMembership(c.env.DB, user);
  c.set("user", user);
  c.set("householdId", m.household_id);
  c.set("role", m.role);
  await next();
};

export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    fail(400, "JSON non valido");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(400, `Dati non validi: ${issue?.path.join(".") || ""} ${issue?.message ?? ""}`.trim());
  }
  return parsed.data;
}
