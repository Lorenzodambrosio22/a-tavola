export interface Env {
  DB: D1Database;
  AI?: Ai;
  ASSETS?: Fetcher;

  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  ADMIN_EMAIL?: string;

  ANTHROPIC_API_KEY?: string;
  AI_PROVIDER_DEFAULT?: string;
  CLAUDE_MODEL_WEEK?: string;
  CLAUDE_MODEL_RECIPE?: string;
  CLAUDE_MODEL_FAST?: string;
  WORKERS_AI_MODEL?: string;
  BRAVE_SEARCH_API_KEY?: string;
  APP_ENV?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface AppVars {
  user: SessionUser;
  householdId: string;
  role: "owner" | "member";
}

export type AppEnv = { Bindings: Env; Variables: AppVars };
