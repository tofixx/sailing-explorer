// Abfragen des persönlichen Streams (Konzept 12.4, F-177) – reine Zeichenketten ohne Worker-APIs, damit Tests den
// Abfrageplan prüfen können.

/** Höchstens so viele Ziele (Folgen 1000 + Gruppen + Teammitglieder 500 + Rest). */
export const STREAM_TARGETS_MAX = 1600;

/**
 * Ziele sammeln: ein Batch einfacher, indizierter Abfragen (D1 lehnt zusammengesetzte SELECTs mit mehr als etwa fünf
 * UNION-Gliedern ab – hier hat keine Abfrage mehr als zwei).
 */
export const TARGET_SQL = {
  // stumm geschaltete Mitgliedschaften (F-346) liefern keine Neuigkeiten
  groups: `SELECT 'group' AS k, group_id AS id FROM group_members WHERE user_id = ?1 AND muted_at IS NULL`,
  boats: `SELECT 'boat' AS k, id FROM boats WHERE owner_id = ?1 UNION SELECT 'boat', boat_id FROM boat_admins WHERE user_id = ?1`,
  follows: `SELECT target_kind AS k, target_id AS id FROM follows WHERE user_id = ?1 LIMIT 1000`,
  clubTeams: `SELECT 'group' AS k, g.id FROM users u
      JOIN group_members hm ON hm.group_id = u.home_club_id AND hm.user_id = u.id
      JOIN groups g ON g.parent_id = u.home_club_id AND g.hidden_at IS NULL
    WHERE u.id = ?1 LIMIT 100`,
  teamMates: `SELECT DISTINCT 'user' AS k, m2.user_id AS id FROM group_members m1
      JOIN groups g ON g.id = m1.group_id AND g.kind = 'team'
      JOIN group_members m2 ON m2.group_id = g.id
    WHERE m1.user_id = ?1 LIMIT 500`,
} as const;

/**
 * Die eine Stream-Abfrage: Schlüsselliste (JSON) als äußere Schleife (CROSS JOIN), je Schlüssel ein Bereich im Index
 * activity_target(target_kind, target_id, created_at), gruppiert nach Aktivität, neueste zuerst, ab dem Cursor.
 */
export const PERSONAL_SQL = `SELECT t.activity_id AS id, MAX(t.created_at) AS at
  FROM json_each(?1) AS k CROSS JOIN activity_target t
    ON t.target_kind = json_extract(k.value, '$[0]') AND t.target_id = json_extract(k.value, '$[1]')
  WHERE t.created_at < ?2 OR (t.created_at = ?2 AND t.activity_id < ?3)
  GROUP BY t.activity_id
  ORDER BY at DESC, id DESC
  LIMIT ?4`;

/** Kandidaten für das Community-Badge (F-221): dieselbe Schlüsselliste, alles nach dem Gelesen-Zeitpunkt. */
export const UNREAD_SQL = `SELECT t.activity_id AS id, MAX(t.created_at) AS at
  FROM json_each(?1) AS k CROSS JOIN activity_target t
    ON t.target_kind = json_extract(k.value, '$[0]') AND t.target_id = json_extract(k.value, '$[1]')
  WHERE t.created_at > ?2
  GROUP BY t.activity_id
  ORDER BY at DESC, id DESC
  LIMIT ?3`;
