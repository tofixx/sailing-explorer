-- Verein, Hafen, Team und Reaktionen (Konzept Abschnitt 12, F-170 ff.).
-- Arten und Gegenstände prüft der Worker (src/domain/reactions.ts, src/domain/harbors.ts), kein SQL-CHECK
-- (Prinzip Architektur 7). Hinweis: Diese Datei enthält bewusst kein Semikolon und keinen doppelten Bindestrich in
-- Zeichenketten (die Tests teilen Anweisungen an Semikolons und entfernen Kommentare).

-- Häfen: name_key = normalisierter Name (harborKey) gegen Dubletten, slug für /h/<slug>, Position und Verein optional.
CREATE TABLE harbors (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,
  lat        REAL,
  lon        REAL,
  club_id    TEXT REFERENCES groups(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  hidden_at  INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX harbors_key ON harbors(name_key);
CREATE INDEX harbors_club ON harbors(club_id);
CREATE INDEX harbors_creator ON harbors(created_by, created_at);

-- Hafen eines Boots (boats.home_port bleibt als Anzeige-Kopie des Hafennamens).
ALTER TABLE boats ADD COLUMN harbor_id TEXT REFERENCES harbors(id) ON DELETE SET NULL;
CREATE INDEX boats_harbor ON boats(harbor_id);

-- „Mein Verein“ und ausdrücklich gewählter Heimathafen einer Person (am Konto, nicht am Profil).
ALTER TABLE users ADD COLUMN home_club_id TEXT REFERENCES groups(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN home_harbor_id TEXT REFERENCES harbors(id) ON DELETE SET NULL;

-- Bestehende Heimathäfen übernehmen: je normalisiertem Namen ein Hafen. Die Normalisierung ist dieselbe wie
-- harborKey (A bis Z klein, Umlaute und ß ausgeschrieben, Satzzeichen . , - _ / ( ) ' " : Semikolon & + als
-- Leerzeichen, Leerzeichen zusammengefasst und getrimmt). char(59) ist das Semikolon.
CREATE TABLE harbor_import (boat_id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL);

INSERT INTO harbor_import (boat_id, name, name_key)
SELECT id, trim(home_port), trim(
  replace(replace(replace(replace(replace(replace(replace(
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
  replace(replace(replace(replace(replace(replace(replace(
    lower(home_port),
  'Ä', 'ae'), 'ä', 'ae'), 'Ö', 'oe'), 'ö', 'oe'), 'Ü', 'ue'), 'ü', 'ue'), 'ß', 'ss'),
  '.', ' '), ',', ' '), '-', ' '), '_', ' '), '/', ' '), '(', ' '), ')', ' '), '''', ' '), '"', ' '), ':', ' '), char(59), ' '), '&', ' '), '+', ' '),
  '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')
)
FROM boats WHERE trim(home_port) <> '';

DELETE FROM harbor_import WHERE name_key = '';

INSERT INTO harbors (id, slug, name, name_key, created_at, updated_at)
SELECT lower(hex(randomblob(12))), '', MIN(name), name_key,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM harbor_import GROUP BY name_key;

-- Slug: Schlüssel mit Bindestrichen, bei anderen Zeichen als a bis z, 0 bis 9 „hafen-<id>“.
UPDATE harbors SET slug = CASE
  WHEN replace(name_key, ' ', '-') GLOB '*[^a-z0-9-]*' THEN 'hafen-' || id
  ELSE replace(name_key, ' ', '-')
END;

CREATE UNIQUE INDEX harbors_slug ON harbors(slug);

UPDATE boats SET harbor_id = (
  SELECT h.id FROM harbor_import i JOIN harbors h ON h.name_key = i.name_key WHERE i.boat_id = boats.id
) WHERE id IN (SELECT boat_id FROM harbor_import);

UPDATE boats SET home_port = (SELECT name FROM harbors WHERE id = boats.harbor_id) WHERE harbor_id IS NOT NULL;

DROP TABLE harbor_import;

-- Öffentlicher Community-Stream: neueste Aktivitäten der Plattform, stabil sortiert (Cursor aus Zeit und ID).
CREATE INDEX activity_recent ON activity(created_at DESC, id DESC);

-- Reaktionen: eine pro Person und Gegenstand (subject_kind share | post | photo | activity), kind like | mast | tack.
CREATE TABLE reactions (
  subject_kind TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (subject_kind, subject_id, user_id)
);
CREATE INDEX reactions_user ON reactions(user_id);

-- Zähler für „300 Reaktionen pro Konto und Tag“ – zählt auch Zurücknehmen, 24 h aufbewahrt.
CREATE TABLE reaction_log (
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX reaction_log_user ON reaction_log(user_id, created_at);
