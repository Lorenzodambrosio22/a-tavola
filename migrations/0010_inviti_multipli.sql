-- Inviti per più persone: chi crea il link sceglie quante volte può essere usato.
ALTER TABLE household_invites ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 10);
ALTER TABLE household_invites ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
-- Gli inviti già accettati risultano esauriti.
UPDATE household_invites SET uses = 1 WHERE used_at IS NOT NULL;
