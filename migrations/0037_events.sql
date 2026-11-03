-- Veranstaltungen, Phase 5 (Konzept 21.5, 30, F-408, F-410, F-480 … F-489): eine Veranstaltung ist eine Art von `posts`
-- (`kind = 'event'`, Titel in der ersten Zeile von `body`, darunter die Beschreibung). Neu sind nur Termin und Zusagen.
-- Beide fallen per ON DELETE CASCADE mit dem Beitrag (jeder Löschweg von posts), Zusagen auch mit dem Konto. Werte von
-- type und status prüft der Worker (src/domain/events.ts), kein CHECK (Architektur 7). Additiv, ohne Altbestand.
CREATE TABLE post_events (
  post_id      TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,              -- meet|sail|regatta|work|training|course
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL,
  place        TEXT NOT NULL DEFAULT '',   -- Ort als Freitext (Konzept 30.3)
  capacity     INTEGER,                    -- NULL = ohne Grenze
  reminded_at  INTEGER,                    -- Erinnerung verschickt (Nachtlauf, einmal je Termin)
  cancelled_at INTEGER                     -- abgesagt: bleibt als Karte stehen, keine Zusagen mehr
);
-- Erinnerungen (nächste 36 h) und Frist (12 Monate nach Ende) im Nachtlauf
CREATE INDEX post_events_start ON post_events(starts_at);

-- Zusagen (B7): nehme teil | vielleicht | nehme nicht teil – eine Zeile je Konto und Veranstaltung, kein Check-in.
CREATE TABLE event_rsvps (
  post_id    TEXT NOT NULL REFERENCES post_events(post_id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,                -- yes|maybe|no
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
-- Tagesgrenze je Konto, Konto löschen und Zusammenführen lesen nach Konto
CREATE INDEX event_rsvps_user ON event_rsvps(user_id, updated_at);
