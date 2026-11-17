-- Jahresansicht der Fahrten und Regatten im Profil (Konzept 43, F-665 … F-669): ob andere sie sehen dürfen.
-- private (Standard, nur man selbst) | public (wer das Profil sehen darf – nur öffentliche Einträge). Geprüft in
-- src/domain/season-table.ts, kein CHECK (Architektur 7). Altbestand: niemand zeigt sie ungefragt.
ALTER TABLE profiles ADD COLUMN season_table TEXT NOT NULL DEFAULT 'private';
