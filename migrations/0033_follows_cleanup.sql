-- Folgen und Mitgliedschaft schließen sich aus (Konzept 24.3, F-446). Die erste Fassung von 0032 (auf der Vorschau schon
-- angewendet) entfernte Altbestand „Mitglied und Folgen derselben Gruppe“ noch nicht; dieselbe Anweisung hier, damit
-- Vorschau und Produktion gleich enden. Idempotent – nach der heutigen 0032 löscht sie nichts mehr.
DELETE FROM follows WHERE target_kind = 'group'
  AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = follows.target_id AND m.user_id = follows.user_id)
