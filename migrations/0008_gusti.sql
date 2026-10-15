-- Preferenze personali facoltative: orientano i suggerimenti, senza diventare vincoli.
CREATE TABLE taste_dishes (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  dish_id TEXT NOT NULL,
  PRIMARY KEY (user_id, dish_id)
);
