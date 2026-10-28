-- Törns in Gruppen (Konzept 11.12, F-373 … F-377): Die Eigentümer:in wählt beim Speichern bzw. Teilen, in welchen
-- ihrer Gruppen ein Törn erscheint. Nur ausgewählte öffentliche Törns stehen im Gruppen-Stream, zählen in Kennzahlen,
-- Meilensteinen, Galerie und Wochenmail der Gruppe. Invariante: die Eigentümer:in ist Mitglied der Gruppe – Austreten
-- bzw. Entfernen nimmt ihre Törns aus der Gruppe. Der Hafen bleibt automatisch (Heimathafen des öffentlichen Boots).
CREATE TABLE share_groups (
  share_id   TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, group_id)
);
CREATE INDEX share_groups_group ON share_groups(group_id);

-- Bestand: alle Törns in die Gruppen ihres Boots, in denen die Eigentümer:in Mitglied ist (wie die neue Vorauswahl) –
-- nicht mehr in alle Gruppen der Segler:in. Auch nicht öffentliche, damit ein späteres Veröffentlichen sie dort zeigt.
INSERT OR IGNORE INTO share_groups (share_id, group_id, created_at)
SELECT s.id, gb.group_id, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM shares s
JOIN group_boats gb ON gb.boat_id = s.boat_id
JOIN group_members m ON m.group_id = gb.group_id AND m.user_id = s.user_id;

-- Neuigkeiten angleichen: Gruppen-Ziele von Törn- und Foto-Aktivitäten nur noch für ausgewählte Gruppen …
DELETE FROM activity_target
WHERE target_kind = 'group'
  AND activity_id IN (SELECT id FROM activity WHERE subject_kind = 'share' AND kind IN ('voyage', 'photos'))
  AND NOT EXISTS (
    SELECT 1 FROM activity a JOIN share_groups sg ON sg.share_id = a.subject_id
    WHERE a.id = activity_target.activity_id AND sg.group_id = activity_target.target_id
  );
-- … und für jede ausgewählte Gruppe (z. B. Boot erst nach dem Törn zugeordnet).
INSERT OR IGNORE INTO activity_target (activity_id, target_kind, target_id, created_at)
SELECT a.id, 'group', sg.group_id, a.created_at
FROM activity a JOIN share_groups sg ON sg.share_id = a.subject_id
WHERE a.subject_kind = 'share' AND a.kind IN ('voyage', 'photos');
