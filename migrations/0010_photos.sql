-- Fotos (Konzept 3 und 6.1, Phase C). Nur Unterstützer laden hoch (E3); Fotos folgen ihrem Törn und zählen zum
-- Speicher des Kontos und zum globalen Zähler (counters.storage_bytes).
-- 0009 ist für Kommentare reserviert; diese Migration hängt nicht davon ab.

-- visibility: public (= wie der Törn) oder private (nur Eigentümer), geprüft in worker/validate.ts, kein CHECK.
-- placement: gps, time, manual oder none. lat/lon auf 5 Nachkommastellen gerundet, nur hier, nie in der Datei.
-- format: webp oder jpeg (R2-Keys photos/<shareId>/<photoId>.webp bzw. .jpg und _t.webp bzw. _t.jpg).
-- bytes: Vollbild + Vorschaubild. hidden_at: später für Meldungen (Abschnitt 4.4).
CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  share_id    TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
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
CREATE INDEX photos_share ON photos(share_id, taken_at);
CREATE INDEX photos_user  ON photos(user_id);
