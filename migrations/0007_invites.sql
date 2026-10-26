-- Einladungen (Konzept Abschnitt 10): Boots-Admins per E-Mail, Crew auf einem Törn per Link oder E-Mail.
-- Das Token liegt nur als SHA-256-Hash vor (wie login_tokens). Die Art prüft worker/validate.ts, kein SQL-CHECK.
-- Genau eins von boat_id/share_id ist gesetzt; beide mit ON DELETE CASCADE, damit Löschen von Boot, Törn oder Konto
-- die Einladungen mitnimmt.
CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL, -- boat_admin | crew
  boat_id    TEXT REFERENCES boats(id) ON DELETE CASCADE,
  share_id   TEXT REFERENCES shares(id) ON DELETE CASCADE,
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT,          -- an diese Adresse gebunden; NULL = Einladungslink (nur Crew)
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX invites_boat ON invites(boat_id);
CREATE INDEX invites_share ON invites(share_id);
CREATE INDEX invites_inviter ON invites(inviter_id, created_at);
CREATE INDEX invites_created ON invites(created_at);

-- Mitsegler eines Törns. Erscheinen nur auf öffentlichen Törns (Konzept 10.6).
CREATE TABLE share_crew (
  share_id   TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, user_id)
);
CREATE INDEX share_crew_user ON share_crew(user_id);
