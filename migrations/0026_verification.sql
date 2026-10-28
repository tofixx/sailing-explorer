-- Verifizierte Vertretung von Vereinen und Häfen (Konzept 20, F-360 ff.): Abzeichen und Anträge.
-- Arten und Status prüft der Worker (src/domain/claims.ts), kein SQL-CHECK.
-- Hinweis: kein Semikolon in Kommentaren (die Tests teilen Anweisungen an Semikolons).

-- Verifiziert seit (NULL = nicht verifiziert). Nur Vereine (kind club) und Häfen.
ALTER TABLE groups ADD COLUMN verified_at INTEGER;
ALTER TABLE harbors ADD COLUMN verified_at INTEGER;

-- Anträge „Ich vertrete diesen Verein/Hafen“.
-- target_kind group oder harbor, status open, accepted, rejected, expired oder withdrawn.
-- role_text, reason, contact, evidence_url: Angaben der Antragsteller:in, nach Frist geleert (Konzept 20.8).
-- decided_by ohne Fremdschlüssel: Admin-Konten stehen in ADMIN_USER_IDS.
-- user_id: Antragsteller:in – NULL nach Kontolöschung (nur angenommene bleiben, sie tragen die Sperre, 20.8).
-- previous_user_id: beim Annehmen verdrängte Eigner:in bzw. Anleger:in (Sperre gegen Rückübernahme, 20.5),
-- previous_action: was mit ihr geschah (admin, member, remove, none).
CREATE TABLE claims (
  id               TEXT PRIMARY KEY,
  target_kind      TEXT NOT NULL,
  target_id        TEXT NOT NULL,
  user_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  role_text        TEXT NOT NULL DEFAULT '',
  reason           TEXT NOT NULL DEFAULT '',
  contact          TEXT NOT NULL DEFAULT '',
  evidence_url     TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'open',
  decided_by       TEXT,
  decided_at       INTEGER,
  decision_note    TEXT NOT NULL DEFAULT '',
  previous_user_id TEXT,
  previous_action  TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX claims_target ON claims(target_kind, target_id, status);
CREATE INDEX claims_user ON claims(user_id, created_at);
CREATE INDEX claims_previous ON claims(previous_user_id);
-- Ein offener Antrag je Konto und Objekt – auch bei Doppelklick.
CREATE UNIQUE INDEX claims_open_once ON claims(user_id, target_kind, target_id) WHERE status = 'open';
