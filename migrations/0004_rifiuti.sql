-- Fase 3 — "Non mi piace": rifiuti e domande già respinte.

CREATE TABLE rejections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  meal_id TEXT REFERENCES meals (id) ON DELETE SET NULL,
  recipe_id TEXT REFERENCES recipes (id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('today', 'ingredient', 'dish')),
  ingredient TEXT, -- per reason = 'ingredient': ingredienti separati da ", "
  -- ingredienti del piatto rifiutato al momento del rifiuto (JSON), per i rifiuti ripetuti
  recipe_ingredients TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX rejections_user_idx ON rejections (user_id, created_at);

-- "Forse non ti piace X?" → risposta no: non chiedere più
CREATE TABLE dismissed_questions (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, ingredient)
);
