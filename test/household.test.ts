import { describe, expect, it } from "vitest";
import { env, login, raw } from "./helpers";

describe("auth e nucleo", () => {
  it("rifiuta le API senza sessione", async () => {
    const res = await raw("GET", "/api/me");
    expect(res.status).toBe(401);
  });

  it("al primo accesso crea un nucleo personale (owner)", async () => {
    const a = await login("anna@example.com");
    const { status, data } = await a.req("GET", "/api/me");
    expect(status).toBe(200);
    expect(data.household.role).toBe("owner");
    expect(data.members).toHaveLength(1);
    expect(data.onboarded).toBe(false);
  });

  it("onboarding: nome e colazione", async () => {
    const a = await login("bruno@example.com");
    const { data } = await a.req("PATCH", "/api/me", { name: "Bruno", breakfast: true });
    expect(data.user.name).toBe("Bruno");
    expect(data.user.breakfast).toBe(true);
    expect(data.onboarded).toBe(true);
  });

  it("invito monouso: chi accetta lascia il suo nucleo (eliminato se vuoto) e porta le ricette", async () => {
    const owner = await login("owner1@example.com", "Olga");
    const guest = await login("guest1@example.com", "Gino");
    const guestHh = (await guest.req("GET", "/api/me")).data.household.id;
    await env.DB.prepare(
      "INSERT INTO recipes (id, household_id, title, kind) VALUES ('r-guest', ?, 'Torta della nonna', 'own')",
    )
      .bind(guestHh)
      .run();

    const inv = await owner.req("POST", "/api/household/invites");
    expect(inv.status).toBe(200);
    expect(inv.data.url).toContain("/invito/");

    const join = await guest.req("POST", "/api/household/join", { token: inv.data.token });
    expect(join.status).toBe(200);
    expect(join.data.household.role).toBe("member");
    expect(join.data.members.map((m: any) => m.name).sort()).toEqual(["Gino", "Olga"]);

    const oldHh = await env.DB.prepare("SELECT id FROM households WHERE id = ?").bind(guestHh).first();
    expect(oldHh).toBeNull();
    const moved = await env.DB.prepare("SELECT household_id FROM recipes WHERE id = 'r-guest'").first<{ household_id: string }>();
    expect(moved?.household_id).toBe(join.data.household.id);

    const third = await login("third1@example.com");
    const again = await third.req("POST", "/api/household/join", { token: inv.data.token });
    expect(again.status).toBe(410);
  });

  it("solo l'owner invita; un membro può uscire e torna in un nucleo personale", async () => {
    const owner = await login("owner2@example.com", "Ada");
    const m = await login("member2@example.com", "Max");
    const inv = await owner.req("POST", "/api/household/invites");
    await m.req("POST", "/api/household/join", { token: inv.data.token });
    expect((await m.req("POST", "/api/household/invites")).status).toBe(403);

    const left = await m.req("POST", "/api/household/leave");
    expect(left.status).toBe(200);
    expect(left.data.household.role).toBe("owner");
    expect(left.data.members).toHaveLength(1);
    const ownerView = await owner.req("GET", "/api/me");
    expect(ownerView.data.members).toHaveLength(1);
  });

  it("invito scaduto", async () => {
    const owner = await login("owner3@example.com");
    const guest = await login("guest3@example.com");
    const hh = (await owner.req("GET", "/api/me")).data.household.id;
    await env.DB.prepare(
      "INSERT INTO household_invites (token, household_id, created_by, expires_at) VALUES ('scaduto-123', ?, 'x', '2000-01-01T00:00:00.000Z')",
    )
      .bind(hh)
      .run();
    const r = await guest.req("POST", "/api/household/join", { token: "scaduto-123" });
    expect(r.status).toBe(410);
  });
});

describe("profilo e vincoli", () => {
  it("CRUD vincoli e assenze ricorrenti", async () => {
    const a = await login("vincoli@example.com", "Vera");
    const add = await a.req("POST", "/api/constraints", { ingredient: "  Noci ", level: "allergy" });
    expect(add.status).toBe(201);
    expect(add.data.constraint.ingredient).toBe("noci");
    await a.req("POST", "/api/constraints", { ingredient: "funghi", level: "dislike" });
    let list = await a.req("GET", "/api/constraints");
    expect(list.data.constraints).toHaveLength(2);

    const funghi = list.data.constraints.find((x: any) => x.ingredient === "funghi");
    await a.req("PATCH", `/api/constraints/${funghi.id}`, { level: "never" });
    list = await a.req("GET", "/api/constraints");
    expect(list.data.constraints.find((x: any) => x.ingredient === "funghi").level).toBe("never");

    await a.req("DELETE", `/api/constraints/${funghi.id}`);
    list = await a.req("GET", "/api/constraints");
    expect(list.data.constraints).toHaveLength(1);

    const bad = await a.req("POST", "/api/constraints", { ingredient: "x", level: "boh" });
    expect(bad.status).toBe(400);

    await a.req("PUT", "/api/absences/recurring", { absences: [{ weekday: 1, slot: "lunch" }] });
    const abs = await a.req("GET", "/api/absences/recurring");
    expect(abs.data.absences).toEqual([{ weekday: 1, slot: "lunch" }]);
  });
});
