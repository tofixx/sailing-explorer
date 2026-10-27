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
-- Aufräumen nach Gegenstand (Törn, Gruppe, Einladung … gelöscht). Bewusst kein Index auf actor_id: er kostete bei
-- jedem Bündeln eine geschriebene Zeile, gebraucht wird er nur beim seltenen Konto-Löschen.
CREATE INDEX notifications_subject ON notifications(subject_kind, subject_id);

-- Kanäle je Art (Konzept 17.6): JSON wie {"comment":"mail","follow":"push"}, fehlende Arten nehmen den Standard
-- (src/domain/notifications.ts, DEFAULT_CHANNELS). Die bisherige tägliche Kommentar-Mail wird zu „Kommentare: Mail“.
-- notify_comments bleibt als Spalte stehen, wird aber nicht mehr gelesen (wie shares.listed).
ALTER TABLE users ADD COLUMN notify_prefs TEXT NOT NULL DEFAULT '{}';
UPDATE users SET notify_prefs = json_object('comment', 'mail') WHERE notify_comments = 'daily';

-- Web Push (Konzept 17.7): nur die Adresse des Push-Dienstes je Gerät – keine Schlüssel, denn die Weckrufe sind leer.
-- last_ok_at = letzte erfolgreiche Zustellung (nächtlich: ein Jahr ohne Zustellung → weg).
CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id, created_at);
