-- Anmeldung per Code (Konzept 14.6): zu jedem Anmeldelink ein 6-stelliger Code zum Eintippen – für die
-- Home-Bildschirm-App auf dem iPhone (eigener Speicher, Links öffnen Safari) oder ein anderes Gerät als das Postfach.
-- Gespeichert wird nur sha256(token_hash:code); code_attempts zählt Fehlversuche (Grenze pro Adresse und Tag).
ALTER TABLE login_tokens ADD COLUMN code_hash TEXT;
ALTER TABLE login_tokens ADD COLUMN code_attempts INTEGER NOT NULL DEFAULT 0;
