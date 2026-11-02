// Sichtbarkeit von Mitgliedschaften als SQL-Bausteine (Konzept 24, F-441 … F-444) – die eine Stelle für die Regeln aus
// src/domain/groups.ts (`canSeeMembership`, `canSeeMembers`) in Abfragen, nach dem Vorbild von IN_LOGBOOK_SQL. Ein Test
// (test/functional/member-visibility.test.ts) hält Domain-Regel und SQL gleich.

/**
 * Ist das Konto im SQL-Ausdruck `viewer` Mitglied (jede Rolle) der Gruppe `group`? Gesperrte Gruppen zählen nicht
 * (Konzept 18.2, wie `roleIn`). Ohne Konto (leere Zeichenkette) nie. = `canSeeMembership`.
 */
export const isMemberSql = (group: string, viewer: string): string =>
  `EXISTS (SELECT 1 FROM group_members vm JOIN groups vg ON vg.id = vm.group_id AND vg.locked_at IS NULL WHERE vm.group_id = ${group} AND vm.user_id = ${viewer})`;

/**
 * Darf `viewer` Mitgliederliste und Boote der Gruppe mit dem Alias `g` sehen? Öffentliche Liste oder Mitglied; jede
 * andere Einstellung zählt wie „nur Mitglieder“ (fail closed). = `canSeeMembers`.
 */
export const membersVisibleSql = (g: string, viewer: string): string => `(${g}.members_visible = 'public' OR ${isMemberSql(`${g}.id`, viewer)})`;
