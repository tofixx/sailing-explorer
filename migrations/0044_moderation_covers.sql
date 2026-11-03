-- Moderation 1 und 4 (Konzept 36): Titelbilder zurückhalten, Tageslimit für Wechsel, Melde-Gewicht. Nur additiv.

-- Titelbild nicht öffentlich bis zu diesem Zeitpunkt (ms): neue Konten bis zum 7. Tag ihres Kontos (F-562), bei einer
-- offenen Bild-Meldung unbefristet bis zur Entscheidung (F-566). NULL = öffentlich wie das Objekt (auch Altbestand).
ALTER TABLE covers ADD COLUMN held_until INTEGER;

-- Tageslimit für neue Titelbilder (F-561): eine Zeile je Upload, nächtlich nach 2 Tagen gelöscht, mit dem Konto per Cascade.
CREATE TABLE cover_log (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX cover_log_user ON cover_log(user_id, created_at);

-- Gewicht einer Meldung für die Ausblend-Schwelle (F-565): 0 = neues Konto, 1 = sonst (auch Altbestand).
ALTER TABLE reports ADD COLUMN weight INTEGER NOT NULL DEFAULT 1;
