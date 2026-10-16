import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/server/index";
import { raw } from "./helpers";

async function withEnv(extra: Record<string, string>, method: string, path: string, body?: unknown) {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ...extra },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("accesso con Google", () => {
  it("è spento senza chiavi", async () => {
    const res = await raw("GET", "/api/auth-options");
    expect(await res.json()).toEqual({ google: false });
  });

  it("con le chiavi rimanda a Google tornando alla pagina dell'invito", async () => {
    const keys = { GOOGLE_CLIENT_ID: "test-id.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret" };
    const opts = await withEnv(keys, "GET", "/api/auth-options");
    expect(await opts.json()).toEqual({ google: true });

    const res = await withEnv(keys, "POST", "/api/auth/sign-in/social", { provider: "google", callbackURL: "/invito/abc" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { url: string };
    const url = new URL(data.url);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe(keys.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost/api/auth/callback/google");
  });
});
