-- Admin-Bereich (Konzept 15, F-230 ff.): Sperren zur Beweissicherung, Admin-Protokoll, Weiterleitungen
-- zusammengeführter Häfen. Arten und Aktionen prüft der Worker (src/domain/admin.ts), kein SQL-CHECK.
-- Hinweis: kein Semikolon in Kommentaren (die Tests teilen Anweisungen an Semikolons).

-- Gesperrt: nur noch für Admins sichtbar, auch nicht für Eigner und Verwalter (Häfen und Profile: hidden_at genügt).
ALTER TABLE users ADD COLUMN locked_at INTEGER;
ALTER TABLE shares ADD COLUMN locked_at INTEGER;
ALTER TABLE boats ADD COLUMN locked_at INTEGER;
ALTER TABLE groups ADD COLUMN locked_at INTEGER;

-- Eine Zeile je gesperrtem Objekt (target_kind user, share, boat, group, harbor).
-- until: Ende der Sperrfrist, danach löscht der nächtliche Lauf das Objekt endgültig.
-- via_user: mit dem Konto mitgesperrt (Entsperren des Kontos entsperrt nur diese).
-- prev_at: hidden_at (bei Konten suspended_at) vor der Sperre, wird beim Entsperren wiederhergestellt.
-- locked_by ohne Fremdschlüssel: Admin-Konten stehen in ADMIN_USER_IDS, nicht in der DB.
CREATE TABLE locks (
  target_kind TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  locked_at   INTEGER NOT NULL,
  until       INTEGER NOT NULL,
  locked_by   TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  via_user    TEXT,
  prev_at     INTEGER,
  PRIMARY KEY (target_kind, target_id)
);
CREATE INDEX locks_until ON locks(until);
CREATE INDEX locks_via ON locks(via_user);

-- Admin-Protokoll: wer (admin_id, NULL = nächtlicher Lauf), was, wann, Ziel, kurzes Detail ohne Mail-Adressen.
CREATE TABLE admin_log (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT,
  action      TEXT NOT NULL,
  target_kind TEXT,
  target_id   TEXT,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX admin_log_created ON admin_log(created_at);
CREATE INDEX admin_log_target ON admin_log(target_kind, target_id);

-- Alte Adressen zusammengeführter Häfen: /h/<old_slug> leitet auf den Zielhafen weiter.
CREATE TABLE harbor_redirects (
  old_slug   TEXT PRIMARY KEY,
  harbor_id  TEXT NOT NULL REFERENCES harbors(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX harbor_redirects_harbor ON harbor_redirects(harbor_id);
