-- Entdecken (F-70 ff.): neueste öffentliche Inhalte ohne Tabellen-Scan sortieren.
-- Nur additive Teilindexe, keine Schemaänderung.
CREATE INDEX IF NOT EXISTS shares_listed_recent ON shares(COALESCE(started_at, created_at) DESC) WHERE visibility = 'unlisted' AND listed = 1;
CREATE INDEX IF NOT EXISTS boats_public_recent ON boats(created_at DESC) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS profiles_public_recent ON profiles(created_at DESC) WHERE visibility = 'public';
