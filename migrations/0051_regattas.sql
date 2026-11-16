-- Regatten und Klassenvereinigungen (Konzept 42, F-645 … F-654). Eine Regatta ist ein Fahrtenbuch-Eintrag mit Angaben
-- in `shares.log.regatta` (kein eigenes Objekt, K1); freigegeben wird sie über die vorhandene Auswahl „In Gruppe
-- zeigen“ (`share_groups`). Neu ist nur die Gruppenart `class` (Klassenvereinigung) mit ihrer Bootsklasse – Werte aus
-- BOAT_CLASSES (src/domain/boat-class.ts), geprüft im Worker, kein CHECK (Architektur 7).
ALTER TABLE groups ADD COLUMN boat_class TEXT NOT NULL DEFAULT '';
