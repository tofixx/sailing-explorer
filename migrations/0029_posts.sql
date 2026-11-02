-- Beiträge als Grundtyp, Phase 1 (Konzept 21.3, Option A, F-400 … F-406): `posts` wird das Dach für alle Inhalte.
-- Törns (GPX und Fahrtenbuch) behalten `shares` als Nutzlast; ihre Post-Zeile hat dieselbe ID (`share_id = id`) und
-- fällt per ON DELETE CASCADE mit dem Törn. Werte von kind, channel_kind, visibility, reach und post_by prüft der
-- Worker (src/domain/posts.ts), kein CHECK (Architektur 7).
-- Achtung: posts.share_id verweist mit ON DELETE CASCADE auf shares. Ein künftiger Tabellen-Neubau von `shares`
-- (DROP + RENAME) braucht `PRAGMA defer_foreign_keys = ON`, sonst löscht er alle Post-Zeilen der Törns mit. Umfragen, Veranstaltungen und Pins folgen in eigenen
-- Migrationen späterer Phasen.
ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';         -- text|gallery|poll|event|voyage|logbook
ALTER TABLE posts ADD COLUMN channel_kind TEXT;                         -- user|group|harbor|boat („wo steht es“)
ALTER TABLE posts ADD COLUMN channel_id TEXT;
ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'; -- public|members|unlisted|private; bei Törns bedeutungslos
ALTER TABLE posts ADD COLUMN reach TEXT NOT NULL DEFAULT 'all';         -- here|club|harbor|all („Sichtbar bis“)
ALTER TABLE posts ADD COLUMN link_key TEXT;                             -- Schlüssel für „Nur mit Link“ (spätere Phase)
ALTER TABLE posts ADD COLUMN share_id TEXT REFERENCES shares(id) ON DELETE CASCADE;
ALTER TABLE posts ADD COLUMN data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE posts ADD COLUMN updated_at INTEGER;
-- Wer in der Gruppe schreibt (B3): admins|members; NULL = Standard je Art (Verein: Admins, Team: alle Mitglieder)
ALTER TABLE groups ADD COLUMN post_by TEXT;

-- Bestehende Gruppen-Beiträge: Heimatverlauf ist ihre Gruppe; nichts breitet sich rückwirkend aus.
UPDATE posts SET channel_kind = 'group', channel_id = group_id, reach = 'here' WHERE group_id IS NOT NULL;
-- Bestehende Törns: eine Post-Zeile je Törn mit derselben ID, Heimatverlauf ist das Profil der Eigentümer:in.
INSERT OR IGNORE INTO posts (id, author_id, kind, channel_kind, channel_id, share_id, body, reach, created_at)
  SELECT id, user_id, CASE source WHEN 'manual' THEN 'logbook' ELSE 'voyage' END, 'user', user_id, id, '', 'all', created_at
  FROM shares;

CREATE UNIQUE INDEX posts_share ON posts(share_id) WHERE share_id IS NOT NULL;
CREATE INDEX posts_channel ON posts(channel_kind, channel_id, created_at DESC);
-- „Mein Verlauf“ (F-401) liest nach Autor:in und Zeit; ersetzt den bisherigen Index nur auf author_id.
CREATE INDEX posts_author_created ON posts(author_id, created_at DESC);
DROP INDEX posts_author;

-- „Ins Fahrtenbuch“ je Törn (F-422): confirmed (bestätigt) | suggested (Vorschlag, zählt mit) | excluded (zählt nie).
-- Bestand: selbst angelegte Fahrtenbuch-Einträge sind bestätigt, GPX-Törns Vorschläge – alle zählen weiter.
ALTER TABLE shares ADD COLUMN log_state TEXT NOT NULL DEFAULT 'suggested';
UPDATE shares SET log_state = 'confirmed' WHERE source = 'manual';
