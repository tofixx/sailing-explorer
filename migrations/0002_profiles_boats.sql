-- Personenprofile: erst sichtbar, wenn der Nutzer sie öffentlich schaltet. Die E-Mail-Adresse
-- ist nie Teil eines Profils.
CREATE TABLE profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  bio          TEXT NOT NULL DEFAULT '',
  visibility   TEXT NOT NULL DEFAULT 'private', -- public | private (geprüft in worker/validate.ts)
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Boote haben immer genau einen Eigner. Weitere Verwalter stehen in boat_admins;
-- so lassen sich Übertragung und mehrere Admins ohne Schemaänderung ergänzen.
CREATE TABLE boats (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  boat_type    TEXT NOT NULL DEFAULT '',
  length_m     REAL,
  sail_number  TEXT NOT NULL DEFAULT '',
  home_port    TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  visibility   TEXT NOT NULL DEFAULT 'private', -- public | private (geprüft in worker/validate.ts)
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX boats_owner ON boats(owner_id);

CREATE TABLE boat_admins (
  boat_id    TEXT NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (boat_id, user_id)
);
CREATE INDEX boat_admins_user ON boat_admins(user_id);

-- Freigaben: Zuordnung zu einem Boot, Anzeige auf Profilen und Kennzahlen für Statistiken.
ALTER TABLE shares ADD COLUMN boat_id TEXT REFERENCES boats(id) ON DELETE SET NULL;
ALTER TABLE shares ADD COLUMN listed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shares ADD COLUMN dist_nm REAL NOT NULL DEFAULT 0;
ALTER TABLE shares ADD COLUMN started_at INTEGER;
CREATE INDEX shares_boat ON shares(boat_id, started_at DESC);
