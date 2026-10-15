CREATE TABLE pantry_items (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  grams REAL NOT NULL CHECK (grams >= 0),
  bought_on TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'used', 'trashed')),
  shopping_item_id TEXT UNIQUE REFERENCES shopping_items(id) ON DELETE SET NULL
);
CREATE INDEX pantry_household_expiry_idx ON pantry_items(household_id, status, expires_at);

-- La scalatura e il registro avvengono nella stessa transazione D1.
CREATE TABLE pantry_consumptions (
  meal_id TEXT PRIMARY KEY REFERENCES meals(id) ON DELETE CASCADE,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
