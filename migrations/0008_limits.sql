-- Kontingente (Konzept 5, Phase B): Speicher pro Konto zählt Track-Payload und Übersichtsbild (später Fotos),
-- dazu ein globaler Zähler für die Notbremse (Konzept 5.2).

-- Größe des Übersichtsbilds (previews/<id>.jpg) in Bytes; 0 = keins. Altbestand mit Bild: bis zum nächsten
-- Hochladen geschätzt (typisch ca. 150 kB), damit er nicht als kostenlos zählt.
ALTER TABLE shares ADD COLUMN image_bytes INTEGER NOT NULL DEFAULT 0;
UPDATE shares SET image_bytes = 153600 WHERE has_image = 1;

-- Globale Zähler. storage_bytes = SUM(size_bytes + image_bytes) aller Törns (+ Fotos ab Phase C); bei Upload und
-- Löschen inkrementell gepflegt, nächtlich vom Cron neu berechnet. Fehlt die Zeile, gelten Uploads als pausiert.
CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO counters (name, value) SELECT 'storage_bytes', COALESCE(SUM(size_bytes + image_bytes), 0) FROM shares;
