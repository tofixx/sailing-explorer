-- Wer Beitrittsanfragen bestätigt (Konzept 14.1): alle Mitglieder, Eigner und Admins (Standard) oder nur der Eigner.
-- Festgelegt vom Eigner der Gruppe.
ALTER TABLE groups ADD COLUMN approve_by TEXT NOT NULL DEFAULT 'admins';
