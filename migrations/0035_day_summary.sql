-- Große Gruppen (Konzept 28, F-466, F-469). Rein additiv; Werte prüft der Worker (PRINCIPLES Architektur 7).

-- Tageszusammenfassung je Gruppe: 1 = an (Standard, auch für bestehende Gruppen), 0 = vom Eigner abgeschaltet.
ALTER TABLE groups ADD COLUMN day_summary INTEGER NOT NULL DEFAULT 1;

-- Publikums-Hinweis (F-465): Konten mit diesem Heimathafen zählen, ohne die Konten-Tabelle zu durchsuchen.
CREATE INDEX IF NOT EXISTS users_home_harbor ON users(home_harbor_id);
