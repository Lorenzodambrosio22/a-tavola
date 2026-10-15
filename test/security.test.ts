import { describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { app } from "../src/server/index";
import { getAuth } from "../src/server/auth";
import { devOutbox, sendLoginCode } from "../src/server/email";
import { env, login } from "./helpers";

describe("configurazione produzione e origine delle modifiche", () => {
  it("non usa il segreto di sviluppo in produzione", () => {
    expect(() => getAuth({ ...env, APP_ENV: "production", BETTER_AUTH_SECRET: undefined }, "https://app.example.com")).toThrow("BETTER_AUTH_SECRET non configurato");
  });
  it("non scrive OTP nei log di produzione quando manca il servizio email", async () => {
    const email = "production-check@example.com";
    await expect(sendLoginCode({ ...env, APP_ENV: "production", RESEND_API_KEY: undefined }, email, "123456")).rejects.toThrow("RESEND_API_KEY non configurato");
    expect(devOutbox.has(email)).toBe(false);
  });
  it("rifiuta una modifica autenticata proveniente da un altro sito", async () => {
    const a = await login(`origin-${crypto.randomUUID()}@example.com`, "Ada");
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request("http://localhost/api/me", {
      method: "PATCH", headers: { Cookie: a.cookie, Origin: "https://other.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ name: "Changed" }),
    }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
    expect((await a.req("GET", "/api/me")).data.user.name).toBe("Ada");
  });
});
