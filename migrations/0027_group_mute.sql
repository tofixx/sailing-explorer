-- Mitgliedschaft stumm schalten (F-346): Neuigkeiten der Gruppe nicht im persönlichen Stream und nicht in der
-- Wochenmail. Gilt je Mitgliedschaft und verschwindet mit ihr (Austreten, Entfernen, Gruppe/Konto löschen).
ALTER TABLE group_members ADD COLUMN muted_at INTEGER;
