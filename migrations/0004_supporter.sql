-- Unterstützungen („Kaffee, Bier, Runde … ausgeben“). Der Unterstützer-Status wird aus diesen Zeilen
-- abgeleitet statt als Flag gespeichert – so bleibt nachvollziehbar, woher er kommt.
-- Jede Zahlung verlängert den Status um 12 Monate (valid_until, berechnet beim Eintragen).
-- user_id bewusst ohne Fremdschlüssel: beim Löschen eines Kontos wird sie auf NULL gesetzt,
-- die Buchung selbst bleibt (ohne Personenbezug) erhalten.
CREATE TABLE supports (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  provider     TEXT NOT NULL,              -- stripe (geprüft in worker/supporter.ts)
  provider_ref TEXT NOT NULL UNIQUE,       -- Checkout-Session-ID, macht Webhooks idempotent
  amount       INTEGER NOT NULL DEFAULT 0, -- in der kleinsten Währungseinheit (Cent)
  currency     TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  valid_until  INTEGER NOT NULL            -- Unterstützer-Status gilt bis hierhin (ms)
);
CREATE INDEX supports_user ON supports(user_id, valid_until);

-- Aufbewahrung: Erinnerungsmail vor dem Löschen nur einmal pro Törn.
ALTER TABLE shares ADD COLUMN expiry_warned_at INTEGER;
CREATE INDEX shares_created ON shares(created_at);
