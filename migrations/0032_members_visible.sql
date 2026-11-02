-- Sichtbarkeit der Mitgliederliste je Gruppe (Konzept 22, F-433): 'members' = nur Mitglieder sehen die Liste (Standard,
-- auch für bestehende Gruppen), 'public' = alle, die die Gruppe sehen. Werte prüft worker/validate.ts bzw.
-- src/domain/groups.ts (kein CHECK, PRINCIPLES Architektur 7). Rein additiv.
ALTER TABLE groups ADD COLUMN members_visible TEXT NOT NULL DEFAULT 'members';
