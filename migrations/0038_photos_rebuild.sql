-- Neubau von `photos` (Konzept 31, 21.3.4, Retro R 4) – nur der Neubau, ohne neue Spalten: `share_id` wird nullable,
-- damit Galerie-Fotos ohne Törn möglich werden (0039 ergänzt `post_id`). Spalten, Werte und Indizes bleiben wie in
-- 0010; alle Zeilen werden unverändert kopiert, Speicherzähler (counters) und R2-Dateien bleiben unberührt.
-- Nichts verweist per Fremdschlüssel auf `photos` (comments.photo_id ohne Fremdschlüssel, Reaktionen und Meldungen
-- polymorph). D1 erzwingt Fremdschlüssel, deshalb für den Neubau aufschieben (wie 0006).
PRAGMA defer_foreign_keys = true;

CREATE TABLE photos_new (
  id          TEXT PRIMARY KEY,
  share_id    TEXT REFERENCES shares(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility  TEXT NOT NULL DEFAULT 'public',
  caption     TEXT NOT NULL DEFAULT '',
  taken_at    INTEGER,
  lat         REAL,
  lon         REAL,
  placement   TEXT NOT NULL DEFAULT 'none',
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  format      TEXT NOT NULL DEFAULT 'webp',
  bytes       INTEGER NOT NULL,
  hidden_at   INTEGER,
  created_at  INTEGER NOT NULL
);

INSERT INTO photos_new (id, share_id, user_id, visibility, caption, taken_at, lat, lon, placement, width, height, format, bytes, hidden_at, created_at)
SELECT id, share_id, user_id, visibility, caption, taken_at, lat, lon, placement, width, height, format, bytes, hidden_at, created_at
FROM photos;

DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;

-- Indizes wie 0010
CREATE INDEX photos_share ON photos(share_id, taken_at);
CREATE INDEX photos_user  ON photos(user_id);
