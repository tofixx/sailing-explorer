-- Sichtbarkeit in drei Stufen (public | unlisted | private) und Teilen-Schlüssel (Konzept E1–E5, 1–2, 6.1).
-- shares ohne SQL-CHECK neu bauen: die Stufe prüft worker/validate.ts (Prinzip Architektur 7).
-- Nichts referenziert shares per Fremdschlüssel. D1 erzwingt Fremdschlüssel, deshalb für den Neubau aufschieben.
PRAGMA defer_foreign_keys = true;

CREATE TABLE shares_new (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  visibility       TEXT NOT NULL DEFAULT 'public', -- public | unlisted | private (worker/validate.ts)
  share_key        TEXT,                           -- NULL bei Altbestand: dann genügt /s/<id>
  view             TEXT NOT NULL DEFAULT '',
  size_bytes       INTEGER NOT NULL,
  track_count      INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  boat_id          TEXT REFERENCES boats(id) ON DELETE SET NULL,
  listed           INTEGER NOT NULL DEFAULT 0,     -- veraltet, wird nicht mehr gelesen (= visibility public)
  dist_nm          REAL NOT NULL DEFAULT 0,
  started_at       INTEGER,
  has_image        INTEGER NOT NULL DEFAULT 0,
  expiry_warned_at INTEGER
);

-- Übernahme: gelistet war schon „Öffentlich“ (F-44), nicht gelistet bleibt „Nur mit Link“ ohne Schlüssel (F-86, F-91).
INSERT INTO shares_new (id, user_id, title, summary, visibility, share_key, view, size_bytes, track_count,
  created_at, updated_at, boat_id, listed, dist_nm, started_at, has_image, expiry_warned_at)
SELECT id, user_id, title, summary,
  CASE WHEN visibility = 'private' THEN 'private' WHEN listed = 1 THEN 'public' ELSE 'unlisted' END,
  NULL, view, size_bytes, track_count, created_at, updated_at, boat_id,
  CASE WHEN visibility <> 'private' AND listed = 1 THEN 1 ELSE 0 END,
  dist_nm, started_at, has_image, expiry_warned_at
FROM shares;

DROP TABLE shares;
ALTER TABLE shares_new RENAME TO shares;

-- Alle Indizes neu (0001 shares_user, 0002 shares_boat, 0004 shares_created, 0005 shares_listed_recent).
CREATE INDEX shares_user ON shares(user_id, created_at DESC);
CREATE INDEX shares_boat ON shares(boat_id, started_at DESC);
CREATE INDEX shares_created ON shares(created_at);
CREATE INDEX shares_public_recent ON shares(COALESCE(started_at, created_at) DESC) WHERE visibility = 'public';

-- Boote und Profile: dritte Stufe braucht einen Schlüssel. Bestehende behalten ihre Stufe (E5).
ALTER TABLE boats ADD COLUMN share_key TEXT;
ALTER TABLE profiles ADD COLUMN share_key TEXT;
