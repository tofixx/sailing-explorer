-- Benachrichtigungs-Glocke (Konzept 17, F-250 ff.). Eine Zeile je Person und Anlass – hier ist Fan-out richtig, weil
-- genau eine Person adressiert ist. Solange ungelesen, bündelt eine Zeile alle Ereignisse derselben Art zum selben
-- Gegenstand (count zählt hoch, actor_id ist die zuletzt handelnde Person). Arten und Gegenstände prüft der Worker
-- (src/domain/notifications.ts), kein SQL-CHECK (Prinzip Architektur 7). Die Zeilen sind nur ein Hinweis: Sichtbarkeit
-- und Namen prüft worker/notifications.ts beim Lesen. Diese Datei enthält bewusst kein Semikolon in Zeichenketten.
CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  count        INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  read_at      INTEGER
);
-- Bündeln: höchstens eine ungelesene Zeile je Person, Art und Gegenstand (Upsert mit ON CONFLICT ... WHERE read_at IS NULL).
CREATE UNIQUE INDEX notifications_open ON notifications(user_id, kind, subject_kind, subject_id) WHERE read_at IS NULL;
-- Liste und Zähler je Person, neueste zuerst
CREATE INDEX notifications_user ON notifications(user_id, updated_at);
-- Aufräumen nach Gegenstand (Törn, Gruppe, Einladung … gelöscht) und nach handelnder Person
CREATE INDEX notifications_subject ON notifications(subject_kind, subject_id);
CREATE INDEX notifications_actor ON notifications(actor_id);
