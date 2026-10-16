import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import type { Env } from "./env";
import { sendLoginCode } from "./email";

function build(env: Env, baseURL: string) {
  if (!env.BETTER_AUTH_SECRET && env.APP_ENV !== "development" && env.APP_ENV !== "test") {
    throw new Error("BETTER_AUTH_SECRET non configurato");
  }
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET || "dev-only-secret-change-me-with-wrangler-secret",
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: [baseURL],
    user: {
      additionalFields: {
        breakfast: { type: "boolean", defaultValue: false, input: false },
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              prompt: "select_account",
            },
          }
        : undefined,
    // Stessa email via codice o via Google = stesso utente
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    session: {
      expiresIn: 60 * 60 * 24 * 60, // 60 giorni
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp }) {
          await sendLoginCode(env, email, otp);
        },
      }),
    ],
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof build>;

const cache = new WeakMap<object, Map<string, Auth>>();

/** Istanza Better Auth per richiesta (memorizzata per env + origin). */
export function getAuth(env: Env, requestUrl: string): Auth {
  const baseURL = env.BETTER_AUTH_URL || new URL(requestUrl).origin;
  let byUrl = cache.get(env);
  if (!byUrl) {
    byUrl = new Map();
    cache.set(env, byUrl);
  }
  let auth = byUrl.get(baseURL);
  if (!auth) {
    auth = build(env, baseURL);
    byUrl.set(baseURL, auth);
  }
  return auth;
}
