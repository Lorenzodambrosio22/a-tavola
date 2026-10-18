import type { Access } from "./access";

export interface Env {
  DB: D1Database;
  AI?: Ai;
  ASSETS?: Fetcher;

  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_EMAIL?: string;

  ANTHROPIC_API_KEY?: string;
  AI_PROVIDER_DEFAULT?: string;
  CLAUDE_MODEL_WEEK?: string;
  CLAUDE_MODEL_RECIPE?: string;
  CLAUDE_MODEL_FAST?: string;
  WORKERS_AI_MODEL?: string;
  BRAVE_SEARCH_API_KEY?: string;
  /** Operazioni AI al giorno per utente e per tutta l'app (default in services/aiQuota.ts). */
  AI_LIMIT_USER_DAY?: string;
  AI_LIMIT_GLOBAL_DAY?: string;
  APP_ENV?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface AppVars {
  user: SessionUser;
  access: Access;
  isAdmin: boolean;
  /** Prenotazione dell'operazione AI della richiesta (una sola per richiesta). */
  aiCharge?: Promise<{ day: string }>;
  householdId: string;
  role: "owner" | "member";
}

export type AppEnv = { Bindings: Env; Variables: AppVars };
