-- Fase 2 — Menù: settimane, pasti, assenze, tabella ingredienti, alias e gruppi allergeni.

CREATE TABLE weeks (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,          -- giorno della spesa = inizio settimana (YYYY-MM-DD)
  shopping_day INTEGER NOT NULL,     -- 0 = domenica … 6 = sabato
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'shopped')),
  provider TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (household_id, start_date)
);

CREATE TABLE meals (
  id TEXT PRIMARY KEY NOT NULL,
  week_id TEXT NOT NULL REFERENCES weeks (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner')),
  recipe_id TEXT REFERENCES recipes (id) ON DELETE SET NULL,
  speed TEXT NOT NULL CHECK (speed IN ('quick', 'long')),
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'skipped')),
  UNIQUE (week_id, date, slot)
);
CREATE INDEX meals_week_idx ON meals (week_id, date);

CREATE TABLE meal_absences (
  meal_id TEXT NOT NULL REFERENCES meals (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  PRIMARY KEY (meal_id, user_id)
);

-- Tabella nutrizionale e durate (seed in 0003, correggibile dall'app)
CREATE TABLE ingredients_ref (
  name TEXT PRIMARY KEY NOT NULL,
  kcal_100g REAL,
  aisle TEXT NOT NULL DEFAULT 'Altro',
  shelf_days INTEGER NOT NULL DEFAULT 3,
  freezer_ok INTEGER NOT NULL DEFAULT 0
);

-- Cache delle mappature nome → ingrediente canonico (anche da mapIngredient dell'AI)
CREATE TABLE ingredient_aliases (
  alias TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
);

-- Gruppi allergeni: es. "frutta a guscio" → noci
CREATE TABLE allergen_groups (
  group_name TEXT NOT NULL,
  ingredient TEXT NOT NULL,
  PRIMARY KEY (group_name, ingredient)
);
