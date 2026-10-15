import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { app } from "../src/server/index";
import { devOutbox } from "../src/server/email";

export { env };

export interface Client {
  cookie: string;
  email: string;
  userId: string;
  req: <T = any>(method: string, path: string, body?: unknown) => Promise<{ status: number; data: T }>;
}

export async function raw(method: string, path: string, body?: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { Origin: "http://localhost" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

function cookieFrom(res: Response): string {
  const list = res.headers.getSetCookie();
  return list.map((c) => c.split(";")[0]).join("; ");
}

/** Esegue il login con codice email (senza Resend il codice finisce in devOutbox). */
export async function login(email: string, name?: string): Promise<Client> {
  const send = await raw("POST", "/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  if (send.status !== 200) throw new Error(`send otp ${send.status}: ${await send.text()}`);
  const otp = devOutbox.get(email.toLowerCase());
  if (!otp) throw new Error("OTP non registrato");
  const sign = await raw("POST", "/api/auth/sign-in/email-otp", { email, otp });
  if (sign.status !== 200) throw new Error(`sign-in ${sign.status}: ${await sign.text()}`);
  const cookie = cookieFrom(sign);
  const signed = (await sign.json()) as { user: { id: string } };
  const client: Client = {
    cookie,
    email,
    userId: signed.user.id,
    req: async (method, path, body) => {
      const res = await raw(method, path, body, cookie);
      const text = await res.text();
      let data: any = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* testo */
      }
      return { status: res.status, data };
    },
  };
  if (name) await client.req("PATCH", "/api/me", { name });
  return client;
}
