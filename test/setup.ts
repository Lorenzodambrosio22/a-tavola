import { applyD1Migrations, env } from "cloudflare:test";
import { vi } from "vitest";

// Nessun servizio esterno nei test; le foto usano pagine HTML registrate.
vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("", { status: 503 })));

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
