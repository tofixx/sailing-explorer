-- Titelbilder (Konzept 13.2), Heimathafen für Vereine und Teams (Konzept 13.3), Saison-Erinnerung (Konzept 5.5).

-- Ein Titelbild je Profil (kind 'u', object_id = user_id), Boot ('b') oder Verein/Team ('g'). ver wechselt bei jedem
-- Austausch (Teil des R2-Keys und der URL, daher lange cachebar). Ohne Fremdschlüssel: Titelbilder gelöschter Objekte
-- räumt der nächtliche Cron weg (worker/covers.ts, sweepOrphanCovers).
CREATE TABLE covers (
  kind       TEXT NOT NULL,
  object_id  TEXT NOT NULL,
  ver        TEXT NOT NULL,
  format     TEXT NOT NULL DEFAULT 'webp',
  bytes      INTEGER NOT NULL,
  user_id    TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, object_id)
);

-- Hafen eines Vereins oder Teams (groups.home_port bleibt als Anzeige-Kopie des Hafennamens, wie bei Booten).
ALTER TABLE groups ADD COLUMN harbor_id TEXT REFERENCES harbors(id) ON DELETE SET NULL;
CREATE INDEX groups_harbor ON groups(harbor_id);

-- Bestehende Freitext-Häfen übernehmen – dieselbe Normalisierung wie in 0013 (harborKey in src/domain/harbors.ts).
CREATE TABLE harbor_import (group_id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL);

INSERT INTO harbor_import (group_id, name, name_key)
SELECT id, trim(home_port), trim(
  replace(replace(replace(replace(replace(replace(replace(
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
  replace(replace(replace(replace(replace(replace(replace(
    lower(home_port),
  'Ä', 'ae'), 'ä', 'ae'), 'Ö', 'oe'), 'ö', 'oe'), 'Ü', 'ue'), 'ü', 'ue'), 'ß', 'ss'),
  '.', ' '), ',', ' '), '-', ' '), '_', ' '), '/', ' '), '(', ' '), ')', ' '), '''', ' '), '"', ' '), ':', ' '), char(59), ' '), '&', ' '), '+', ' '),
  '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')
)
FROM groups WHERE trim(home_port) <> '';

DELETE FROM harbor_import WHERE name_key = '';

-- Neue Häfen nur für Namen, die es noch nicht gibt. Der Slug-Index besteht schon: vorläufig ' ' || name_key (eindeutig,
-- nie ein gültiger Slug), dann wie in 0013 – bei Kollision mit einem vorhandenen Slug „hafen-<id>“.
INSERT INTO harbors (id, slug, name, name_key, created_at, updated_at)
SELECT lower(hex(randomblob(12))), ' ' || name_key, MIN(name), name_key,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM harbor_import WHERE name_key NOT IN (SELECT name_key FROM harbors) GROUP BY name_key;

UPDATE harbors SET slug = CASE
  WHEN replace(name_key, ' ', '-') GLOB '*[^a-z0-9-]*' OR EXISTS (SELECT 1 FROM harbors o WHERE o.slug = replace(harbors.name_key, ' ', '-')) THEN 'hafen-' || id
  ELSE replace(name_key, ' ', '-')
END WHERE slug LIKE ' %';

UPDATE groups SET
  harbor_id = (SELECT h.id FROM harbor_import i JOIN harbors h ON h.name_key = i.name_key WHERE i.group_id = groups.id),
  home_port = (SELECT h.name FROM harbor_import i JOIN harbors h ON h.name_key = i.name_key WHERE i.group_id = groups.id)
WHERE id IN (SELECT group_id FROM harbor_import);

DROP TABLE harbor_import;

-- Saison-Erinnerung (Konzept 5.5): Jahr der zuletzt verschickten Dezember-Mail.
ALTER TABLE users ADD COLUMN season_mail_year INTEGER;

-- Frei gewählter Eigner eines Boots (Konzept 13.5): Eigner und Boots-Admins setzen ihn; leer = Konto des Eigners.
ALTER TABLE boats ADD COLUMN owner_label TEXT NOT NULL DEFAULT '';
