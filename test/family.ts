import { login, type Client } from "./helpers";

let n = 0;

/** Crea un nucleo con Anna (owner, allergica alla frutta a guscio) e Bruno. */
export async function family(opts: { annaBreakfast?: boolean } = {}): Promise<{ anna: Client; bruno: Client }> {
  n++;
  const anna = await login(`anna${n}-${Math.random().toString(36).slice(2, 7)}@example.com`, "Anna");
  const bruno = await login(`bruno${n}-${Math.random().toString(36).slice(2, 7)}@example.com`, "Bruno");
  const inv = await anna.req("POST", "/api/household/invites");
  const j = await bruno.req("POST", "/api/household/join", { token: inv.data.token });
  if (j.status !== 200) throw new Error("join fallito");
  await anna.req("POST", "/api/constraints", { ingredient: "frutta a guscio", level: "allergy" });
  if (opts.annaBreakfast) await anna.req("PATCH", "/api/me", { breakfast: true });
  return { anna, bruno };
}

export const START = "2030-01-05"; // sabato
