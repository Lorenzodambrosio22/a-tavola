-- Fase 1 — Fondamenta: tabelle Better Auth, nucleo, inviti, vincoli alimentari, assenze ricorrenti.

-- Better Auth (schema SQLite standard, nomi colonne camelCase) + campo extra `breakfast`
CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "breakfast" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" DATE,
  "refreshTokenExpiresAt" DATE,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATE NOT NULL,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

-- Nucleo
CREATE TABLE households (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  provider TEXT, -- provider AI attivo per il nucleo (NULL = default)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES "user" ("id") ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (household_id, user_id)
);

CREATE TABLE household_invites (
  token TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Vincoli e preferenze
CREATE TABLE food_constraints (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('allergy', 'never', 'little', 'dislike')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'learned')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, ingredient)
);

CREATE TABLE blocked_dishes (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  dish_family TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, dish_family)
);

CREATE TABLE recurring_absences (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = domenica
  slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
  PRIMARY KEY (user_id, weekday, slot)
);

-- Ricette del nucleo (proprie e generate). `ingredients` è JSON [{name, grams}].
CREATE TABLE recipes (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  dish_family TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL DEFAULT 30,
  servings INTEGER NOT NULL DEFAULT 2,
  ingredients TEXT NOT NULL DEFAULT '[]',
  steps TEXT,
  source_url TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('own', 'own_ai', 'own_known', 'generated')),
  details_status TEXT NOT NULL DEFAULT 'none' CHECK (details_status IN ('none', 'ready')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX recipes_household_idx ON recipes (household_id, kind);

CREATE TABLE favorites (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, recipe_id)
);
