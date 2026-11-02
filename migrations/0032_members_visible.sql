-- Sichtbarkeit von Mitgliedschaften und Benachrichtigungs-Stufen je Verlauf (Konzept 24, F-440, F-449). Rein additiv;
-- Werte prüft der Worker (src/domain/groups.ts, src/domain/notifications.ts), kein CHECK (PRINCIPLES Architektur 7).

-- Wer sieht die Mitgliederliste: 'members' = nur Mitglieder (Standard, auch für bestehende Gruppen), 'public' = alle,
-- die die Gruppe sehen.
ALTER TABLE groups ADD COLUMN members_visible TEXT NOT NULL DEFAULT 'members';

-- Stufe je Mitgliedschaft bzw. je Folgen: 'all' | 'important' | 'direct' | 'muted'; NULL = Voreinstellung des Kontos
-- (users.notify_prefs.level, ohne Wahl 'important'). Fällt mit der Zeile (Austritt, Entfolgen, Konto, Gruppe).
ALTER TABLE group_members ADD COLUMN notify_level TEXT;
ALTER TABLE follows ADD COLUMN notify_level TEXT;

-- Bestand: Folgen und Mitgliedschaft schließen sich jetzt aus (F-446). Vorher hat ein Beitritt das Folgen nicht
-- gelöscht – solche Doppel fallen weg (eine eigene Stufe am Folgen gab es vor 0032 nicht).
DELETE FROM follows WHERE target_kind = 'group'
  AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = follows.target_id AND m.user_id = follows.user_id);

-- Stumm geschaltete Mitgliedschaften werden „Stumm“ (muted_at wird danach nicht mehr gelesen) …
UPDATE group_members SET notify_level = 'muted' WHERE muted_at IS NOT NULL;

-- … und wer „Neue Beiträge“ bisher eingeschaltet hatte (Glocke, Mail oder Push), bekommt als Voreinstellung „Alle
-- Beiträge“ – so ändert sich für niemanden still, was er bekommt. Der Kanal (Glocke/Mail/Push) bleibt.
UPDATE users SET notify_prefs = json_set(notify_prefs, '$.level', 'all')
  WHERE (CASE WHEN json_valid(notify_prefs) THEN json_extract(notify_prefs, '$.post') END) IN ('none', 'mail', 'push');
