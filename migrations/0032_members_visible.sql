-- Sichtbarkeit von Mitgliedschaften und Benachrichtigungs-Stufen je Verlauf (Konzept 24, F-440, F-449). Rein additiv;
-- Werte prüft der Worker (src/domain/groups.ts, src/domain/notifications.ts), kein CHECK (PRINCIPLES Architektur 7).

-- Wer sieht die Mitgliederliste: 'members' = nur Mitglieder (Standard, auch für bestehende Gruppen), 'public' = alle,
-- die die Gruppe sehen.
ALTER TABLE groups ADD COLUMN members_visible TEXT NOT NULL DEFAULT 'members';

-- Stufe je Mitgliedschaft bzw. je Folgen: 'all' | 'important' | 'direct' | 'muted'; NULL = Voreinstellung des Kontos
-- (users.notify_prefs.level, ohne Wahl 'important'). Fällt mit der Zeile (Austritt, Entfolgen, Konto, Gruppe).
ALTER TABLE group_members ADD COLUMN notify_level TEXT;
ALTER TABLE follows ADD COLUMN notify_level TEXT;

-- Bestand: stumm geschaltete Mitgliedschaften werden „Stumm“ (muted_at wird danach nicht mehr gelesen) …
UPDATE group_members SET notify_level = 'muted' WHERE muted_at IS NOT NULL;

-- … und wer „Neue Beiträge“ bisher eingeschaltet hatte (Glocke, Mail oder Push), bekommt als Voreinstellung „Alle
-- Beiträge“ – so ändert sich für niemanden still, was er bekommt. Der Kanal (Glocke/Mail/Push) bleibt.
UPDATE users SET notify_prefs = json_set(notify_prefs, '$.level', 'all')
  WHERE notify_prefs IS NOT NULL AND json_valid(notify_prefs) AND json_extract(notify_prefs, '$.post') IN ('none', 'mail', 'push');
