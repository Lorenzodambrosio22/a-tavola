import { afterEach, describe, expect, it } from "vitest";
import { setProviderFactory } from "../src/server/ai";
import { devMails, sendAccessRequest } from "../src/server/email";
import { FakeBackend, RECORDED, useFakes } from "./fixtures/fake";
import { START } from "./family";
import { env, login } from "./helpers";

afterEach(() => setProviderFactory(null));

const uniq = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}@example.com`;

describe("accesso su approvazione", () => {
  it("chi si iscrive resta in attesa e l'admin riceve un'email con il link", async () => {
    const email = uniq("nuovo");
    const u = await login(email, undefined, { approve: false });
    const me = await u.req("GET", "/api/me");
    expect(me.status).toBe(200);
    expect(me.data.access).toBe("pending");
    const mail = devMails.find((m) => m.to === "admin@example.com" && m.text.includes(email));
    expect(mail?.text).toContain(`/admin/accessi?utente=${u.userId}`);
  });

  it("un utente non approvato riceve 403 sulle route AI e l'AI non viene chiamata", async () => {
    const u = await login(uniq("attesa"), undefined, { approve: false });
    const claude = new FakeBackend("claude").queue("week", RECORDED.week).queue("estimate", JSON.stringify({ dish_family: "x", minutes: 10, ingredients: [] }));
    useFakes(claude);
    const calls = [
      u.req("POST", "/api/weeks/generate", { start_date: START }),
      u.req("POST", "/api/recipes", { mode: "own_known", title: "Polpette", servings: 4 }),
      u.req("POST", "/api/recipes", { mode: "own_ai", title: "Lasagne", servings: 4 }),
      u.req("POST", "/api/meals/qualsiasi/replace"),
      u.req("POST", "/api/admin/compare", { start_date: START }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    // Anche le altre API sono chiuse finché non arriva l'approvazione
    expect((await u.req("PATCH", "/api/me", { name: "Furbo" })).status).toBe(403);
    expect(claude.calls).toHaveLength(0);
  });

  it("l'admin approva: l'utente riceve l'email e può usare l'app", async () => {
    const email = uniq("approvato");
    const u = await login(email, undefined, { approve: false });
    const admin = await login("admin@example.com");
    const list = await admin.req("GET", "/api/admin/users");
    expect(list.data.users.find((x: any) => x.id === u.userId)?.access).toBe("pending");

    const res = await admin.req("POST", `/api/admin/users/${u.userId}/approve`);
    expect(res.status).toBe(200);
    expect(res.data.email_sent).toBe(true);
    expect(devMails.some((m) => m.to === email && m.subject.includes("attivo"))).toBe(true);

    expect((await u.req("GET", "/api/me")).data.access).toBe("approved");
    useFakes(new FakeBackend("claude").queue("week", RECORDED.week));
    expect((await u.req("POST", "/api/weeks/generate", { start_date: START })).status).toBe(201);
  });

  it("l'admin può rifiutare; solo l'admin gestisce le richieste", async () => {
    const u = await login(uniq("rifiutato"), undefined, { approve: false });
    const other = await login(uniq("altro"));
    expect((await other.req("POST", `/api/admin/users/${u.userId}/approve`)).status).toBe(403);
    expect((await other.req("GET", "/api/admin/users")).status).toBe(403);

    const admin = await login("admin@example.com");
    expect((await admin.req("POST", `/api/admin/users/${u.userId}/reject`)).status).toBe(200);
    expect((await u.req("GET", "/api/me")).data.access).toBe("rejected");
    expect((await u.req("POST", "/api/weeks/generate", { start_date: START })).status).toBe(403);
  });

  it("le email sono nello stile dell'app e non lasciano passare HTML dal nome", async () => {
    const email = uniq("html");
    await sendAccessRequest(env, "admin@example.com", { name: "<b>Eva</b>", email }, "http://localhost/admin/accessi?utente=x");
    const mail = devMails.findLast((m) => m.to === "admin@example.com" && m.text.includes(email))!;
    expect(mail.html).toContain("Qualcuno chiede");
    expect(mail.html).toContain("&#60;b&#62;Eva");
    expect(mail.html).not.toContain("<b>Eva</b>");
  });

  it("l'admin è approvato da subito", async () => {
    const admin = await login("admin@example.com", undefined, { approve: false });
    expect((await admin.req("GET", "/api/me")).data.access).toBe("approved");
  });
});
