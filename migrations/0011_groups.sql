-- Vereine, Teams, Folgen und Neuigkeiten (Konzept Abschnitt 11, F-150 ff.).
-- Arten, Rollen, Stufen und Beitrittsmodi prüft worker/validate.ts bzw. src/domain/groups.ts, kein SQL-CHECK
-- (Prinzip Architektur 7). Alle Fremdschlüssel mit ON DELETE, damit Löschen von Konto, Boot oder Gruppe mitnimmt.

-- Gruppen: kind club | team, ein Team kann zu einem Verein gehören (parent_id).
-- visibility public | unlisted | private (private = geschlossen, nur Mitglieder), share_key für „Nur mit Link“.
-- join_mode request (Einladung oder Anfrage) | invite (nur Einladung).
CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  parent_id   TEXT REFERENCES groups(id) ON DELETE SET NULL,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  home_port   TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'public',
  share_key   TEXT,
  join_mode   TEXT NOT NULL DEFAULT 'request',
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at   INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX groups_slug ON groups(slug COLLATE NOCASE);
CREATE INDEX groups_parent ON groups(parent_id);
CREATE INDEX groups_owner ON groups(owner_id);
CREATE INDEX groups_public ON groups(created_at DESC) WHERE visibility = 'public';

-- Mitglieder mit Rolle owner | admin | member (der Eigner steht zusätzlich in groups.owner_id).
CREATE TABLE group_members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user ON group_members(user_id);

-- Beitrittsanfragen, die ein Admin annimmt oder ablehnt.
CREATE TABLE group_requests (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_requests_user ON group_requests(user_id, created_at);

-- Boote in Gruppen (ein Boot in mehreren Gruppen).
CREATE TABLE group_boats (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  boat_id    TEXT NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  added_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, boat_id)
);
CREATE INDEX group_boats_boat ON group_boats(boat_id);

-- Einladungen in Gruppen nutzen die Tabelle aus 0007 (kind = 'group').
ALTER TABLE invites ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE CASCADE;
CREATE INDEX invites_group ON invites(group_id);

-- Beiträge: heute nur in Gruppen (group_id gesetzt), später auch persönlich (group_id NULL).
CREATE TABLE posts (
  id         TEXT PRIMARY KEY,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  link       TEXT,
  hidden_at  INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX posts_group ON posts(group_id, created_at DESC);
CREATE INDEX posts_author ON posts(author_id);

-- Zähler für „5 Beiträge pro Gruppe und Tag“ – zählt auch gelöschte Beiträge, 24 h aufbewahrt.
CREATE TABLE post_log (
  group_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX post_log_group ON post_log(group_id, created_at);

-- Folgen: target_kind user | boat | group, target_id = users.id, boats.id bzw. groups.id.
CREATE TABLE follows (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_kind, target_id)
);
CREATE INDEX follows_target ON follows(target_kind, target_id);

-- Aktivitäts-Log: eine Zeile je Ereignis (kind voyage | photos | member | boat | post | milestone, später mehr),
-- Gegenstand generisch (subject_kind share | group | boat | post | user), group_id als Kontext, data = kleines JSON,
-- bucket = Schlüssel zum Bündeln (z. B. Fotos je Törn und Tag) bzw. gegen Doppel (Meilensteine, Törn einmal).
CREATE TABLE activity (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  actor_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  group_id     TEXT,
  data         TEXT NOT NULL DEFAULT '{}',
  bucket       TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX activity_bucket ON activity(bucket) WHERE bucket IS NOT NULL;
CREATE INDEX activity_subject ON activity(subject_kind, subject_id);
CREATE INDEX activity_actor ON activity(actor_id);
CREATE INDEX activity_group ON activity(group_id);
CREATE INDEX activity_created ON activity(created_at);

-- Publikum je Aktivität (target_kind group | boat | user) – Lesen per Index, kein Fan-out pro Mitglied.
-- created_at doppelt gespeichert, damit die Sortierung im Index liegt.
CREATE TABLE activity_target (
  activity_id TEXT NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (target_kind, target_id, activity_id)
);
CREATE INDEX activity_target_feed ON activity_target(target_kind, target_id, created_at DESC);
CREATE INDEX activity_target_activity ON activity_target(activity_id);

-- Wöchentliche Sammelmail „Was war los in deinem Verein“ (opt-in): off | weekly.
ALTER TABLE users ADD COLUMN notify_groups TEXT NOT NULL DEFAULT 'off';
ALTER TABLE users ADD COLUMN groups_mailed_at INTEGER;
