-- Kommentare und Melden (Konzept Abschnitt 4, Phase D). Hängt nur von 0001–0007 ab.
-- Arten, Gründe und Modi prüft worker/validate.ts, kein SQL-CHECK (Prinzip Architektur 7).

-- Törn: Kommentare an/aus/ausgeblendet; per Meldung oder Admin ausgeblendet (bis zur Prüfung).
ALTER TABLE shares ADD COLUMN comments_mode TEXT NOT NULL DEFAULT 'on'; -- on | off | hidden
ALTER TABLE shares ADD COLUMN hidden_at INTEGER;
ALTER TABLE boats ADD COLUMN hidden_at INTEGER;
ALTER TABLE profiles ADD COLUMN hidden_at INTEGER;

-- Konto: gesperrt (keine Uploads, Kommentare, Meldungen, Einladungen) und Tages-Sammelmail für neue Kommentare.
ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN notify_comments TEXT NOT NULL DEFAULT 'off'; -- off | daily
ALTER TABLE users ADD COLUMN comments_mailed_at INTEGER;

-- Ein flacher Thread pro Törn. photo_id ist für Phase C (Fotos) reserviert und bleibt bis dahin NULL –
-- ohne Fremdschlüssel, weil es die Tabelle photos noch nicht gibt.
CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  share_id   TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  photo_id   TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  hidden_at  INTEGER, -- per Meldung oder Admin ausgeblendet
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_share ON comments(share_id, created_at);
CREATE INDEX comments_user ON comments(user_id, created_at);

-- Spam-Grenzen zählen auch gelöschte Kommentare: nur Zeitpunkt und Hash des Textes, 24 h aufbewahrt.
CREATE TABLE comment_log (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body_hash  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX comment_log_user ON comment_log(user_id, created_at);
CREATE INDEX comment_log_created ON comment_log(created_at);

-- Meldungen (DSA). Ziel generisch (kein Fremdschlüssel); Aufräumen beim Löschen des Ziels und nächtlich.
-- Nach der Entscheidung werden reporter_id und note geleert.
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL, -- share | comment | profile | boat
  target_id   TEXT NOT NULL, -- shares.id, comments.id, profiles.user_id, boats.id
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL, -- spam | abuse | illegal | depicted | other
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution  TEXT,          -- kept | hidden | deleted
  UNIQUE (target_kind, target_id, reporter_id)
);
CREATE INDEX reports_open ON reports(resolved_at, created_at);
CREATE INDEX reports_target ON reports(target_kind, target_id);
CREATE INDEX reports_reporter ON reports(reporter_id, created_at);
