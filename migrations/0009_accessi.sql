-- Accesso su approvazione e limiti giornalieri sulle chiamate AI.

-- Stato dell'account: i nuovi iscritti restano in attesa finché l'admin non li approva.
ALTER TABLE "user" ADD COLUMN "access" TEXT NOT NULL DEFAULT 'pending' CHECK ("access" IN ('pending', 'approved', 'rejected'));
-- Chi usava già l'app resta dentro.
UPDATE "user" SET "access" = 'approved';

-- Operazioni AI per utente e giorno (giorno di calendario italiano). Una richiesta = una operazione.
CREATE TABLE ai_usage (
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX ai_usage_day_idx ON ai_usage (day);

-- Giorni in cui è già partita l'email "tetto globale raggiunto" (una sola al giorno).
CREATE TABLE ai_alerts (
  day TEXT PRIMARY KEY NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
