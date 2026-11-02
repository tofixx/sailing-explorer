-- Beiträge als Grundtyp, Phase 2 (Konzept 21.12, F-409): Ausbreitung nach oben, begrenzt durch „Sichtbar bis“.
-- „Alles“ und „Umgebung“ zeigen Beiträge künftig nur mit reach = 'all'. Öffentliche Gruppen-Beiträge erschienen dort
-- bisher immer – damit nichts verschwindet, stehen sie auf „überall“. Ziele kommen keine dazu (nichts springt nach oben,
-- nichts erscheint neu im Verein oder Hafen); „Nur Mitglieder“ bleibt „nur hier“ (F-415). Profil-Beiträge aus Phase 1
-- standen nie in der Community und bleiben „nur hier“. Hafen- und Boots-Verläufe (F-425) brauchen keine neue Spalte;
-- ihr Aufräumen nutzt den Index posts_channel (0029).
UPDATE posts SET reach = 'all' WHERE channel_kind = 'group' AND share_id IS NULL AND visibility = 'public';
