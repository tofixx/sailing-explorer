-- Web-URL für Vereine, Teams und Häfen (F-540 … F-542). Rein additiv; NULL = keine Webseite.
-- Werte prüft der Worker (parseWebUrl: nur http/https mit Host, höchstens 500 Zeichen – wie der Link eines Beitrags).
-- Die Spalte fällt mit ihrer Zeile (removeGroup, removeHarbor); beim Zusammenführen von Häfen übernimmt das Ziel die
-- Adresse der Dublette, wenn es selbst keine hat (mergeHarbor).
ALTER TABLE groups ADD COLUMN web_url TEXT;
ALTER TABLE harbors ADD COLUMN web_url TEXT;
