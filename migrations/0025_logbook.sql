-- Fahrtenbuch (Konzept 19, F-300 … F-312): Törns ohne GPX und Fahrtenbuch-Angaben an jedem Törn.
-- Werte von source/dist_source prüft der Worker (src/domain/logbook.ts), kein CHECK – wie bei den übrigen Spalten.
ALTER TABLE shares ADD COLUMN source TEXT NOT NULL DEFAULT 'gpx';           -- gpx | manual
ALTER TABLE shares ADD COLUMN dist_source TEXT NOT NULL DEFAULT 'track';    -- track | route | stated
ALTER TABLE shares ADD COLUMN ended_at INTEGER;                             -- Ankunft (UTC ms)
ALTER TABLE shares ADD COLUMN from_harbor_id TEXT REFERENCES harbors(id) ON DELETE SET NULL;
ALTER TABLE shares ADD COLUMN to_harbor_id TEXT REFERENCES harbors(id) ON DELETE SET NULL;
-- Fahrtenbuch-Angaben (Motor, Wind, Seegang, Segelführung, Liegeplatz, Notizen), kleines JSON, Schema parseLog.
ALTER TABLE shares ADD COLUMN log TEXT NOT NULL DEFAULT '{}';

CREATE INDEX shares_from_harbor ON shares(from_harbor_id) WHERE from_harbor_id IS NOT NULL;
CREATE INDEX shares_to_harbor ON shares(to_harbor_id) WHERE to_harbor_id IS NOT NULL;
-- Kontingent je Saison der Abfahrt (L1)
CREATE INDEX shares_user_manual ON shares(user_id, started_at) WHERE source = 'manual';
