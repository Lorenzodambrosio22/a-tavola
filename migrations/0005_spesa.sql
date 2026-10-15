-- Fase 4 — Lista della spesa.

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY NOT NULL,
  week_id TEXT NOT NULL REFERENCES weeks (id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  grams REAL NOT NULL DEFAULT 0,
  unit_label TEXT NOT NULL DEFAULT '',
  aisle TEXT NOT NULL DEFAULT 'Altro',
  buy_on TEXT NOT NULL,              -- YYYY-MM-DD: giorno della spesa o "da comprare dopo"
  frozen_hint INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  UNIQUE (week_id, ingredient, buy_on, manual)
);
CREATE INDEX shopping_items_week_idx ON shopping_items (week_id);
