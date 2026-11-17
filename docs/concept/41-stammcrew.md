# 41. Stammcrew eines Boots (F-270 … F-274, 16.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 41). Setzt den offenen Teil von Konzept 15 um (Crew-Rollen,
freigegeben 27.10.2026; Ausgangspunkt `crew-rollen-konzept.md`, C1/C2/C6, M2/M6). Vom Betreiber am 16.11.2026 zur
Umsetzung freigegeben („autonom, Empfehlungen übernehmen“).

## 41.1 Architektur-Skizze

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Migration `0050_boat_crew.sql` (additiv): neue Tabelle `boat_crew (boat_id → boats, user_id → users, title, created_at)`; Schalter als Spalten `boats.crew_post`, `crew_invite` (0/1) und `crew_assign` (`crew` · `clubs` · `anyone`, Standard `crew`). Einladungsart `boat_member` in `invites` (vorhandene Spalte `boat_id`). **Abweichung von ROLLEN.md (`boat_admins.role`):** `boat_admins` heißt an über 20 Stellen „darf verwalten“ (Stream, Glocke, Hafen-Schreibrecht, Titelbild, Gruppen-Boote …). Eine Stufe dort hätte der Stammcrew still Verwalterrechte gegeben – eine eigene Tabelle ist fail closed |
| Rechte | Reine Regeln `src/domain/boat-crew.ts` (`crewRights`, `canPostOnBoat`, `canInviteToCrew`, `cleanCrewTitle`). Verwalten (Bearbeiten, Sichtbarkeit, Admins, Löschen, Titelbild, Gruppen) bleibt bei `roleFor` (Eigner/Admins). Sehen: `boatInsider` in `worker/boats.ts` (Eigner, Admins, Stammcrew) für Bootsseite, Boots-Verlauf und Beiträge am Boot |
| Querschnitte | Sichtbarkeit: Stammcrew sieht ihr Boot auch bei „Nur mit Link“/„Nur ich“ (wie Mitglieder ihre geschlossene Gruppe), nie nicht öffentliche Törns anderer (10.6). Stream: Ziel `boat` im persönlichen Stream (`TARGET_SQL.crewBoats`). Benachrichtigungen: Stammcrew gehört zum Publikum des Boots wie Verwalter (`postAudience('boat')`, Törn-Benachrichtigung) – Verwalter und Stammcrew in **einem** UNION-Glied (D1-Grenze für zusammengesetzte SELECTs). Caches: Boots-Verlauf und Stammcrew-Liste für Insider `private, no-store`. Kontingente: 50 je Boot inkl. offener Einladungen, atomar beim Annehmen. Zusammenführen: `mergeUsers` hängt `boat_crew` um |
| Komponentenschnitt | `sx-boat-crew` (Liste, Schalter, Titel, Austreten, Einladen über `sx-invite-box`), Abschnitt „Stammcrew“ in `sx-profile-page` (Bootsseite), Knopf „Zuordnung lösen“ je Törn für Verwalter. Ablauf `controllers/boat-crew.ts`, Client-API `services/boat-crew-api.ts`. Mobil: Liste und Schalter einspaltig, Tippziele 44 px, Karten mindestens `min(230px, 100%)` |
| Parallele Arbeit | Keine laufenden Branches (16.11.). Berührt geteilte Dateien: `worker/invites.ts`, `worker/notifications.ts`, `worker/post-chain.ts`, `worker/stream*.ts`, `worker/shares.ts` (`checkBoat`), `sx-profile-page`, `app.ts` |

## 41.2 Rechte

| Recht | Stammcrew | Admin | Eigner |
| --- | --- | --- | --- |
| am Boot genannt werden (mit öffentlichem Profil), Titel tragen | ✓ | – (Admins stehen in der Admin-Liste) | – |
| Boot und seine Beiträge sehen, auch bei „Nur ich“ | ✓ | ✓ | ✓ |
| eigene Törns zuordnen | ✓ (jede Stufe von `crew_assign` schließt sie ein) | ✓ | ✓ |
| Beiträge am Boot schreiben | Schalter (Standard aus) | ✓ | ✓ |
| zur Stammcrew einladen | Schalter (Standard aus), direkt | ✓ | ✓ |
| offene Stammcrew-Einladungen sehen und zurückziehen | nur eigene | ✓ | ✓ |
| Titel setzen | nur eigenen | alle | alle |
| aus der Stammcrew entfernen | nur sich (austreten) | alle | alle |
| Zuordnung fremder Törns lösen (F-274) | – | ✓ | ✓ |
| Schalter stellen | – | – (sieht sie) | ✓ |

**Zuordnen (F-272):** `crew` = nur Stammcrew; `clubs` = auch Mitglieder eines Vereins (nicht Teams, nicht ausgeblendet oder gesperrt), dem das **öffentliche** Boot zugeordnet ist;
`anyone` = auch, wer dem **öffentlichen** Boot folgt und dessen Konto mindestens 7 Tage alt ist (Charter: Folgen ist
der Einstieg, so taucht das Boot in der Auswahl beim Teilen und im Fahrtenbuch auf). Regel einmal in SQL
(`ASSIGNABLE_SQL`, `worker/boat-crew.ts`) für Auswahl (`GET /api/boats` → `assignable`) und Prüfung (`checkBoat`). Ein
schon zugeordnetes Boot bleibt beim Speichern anderer Felder erlaubt, auch wenn das Recht inzwischen fehlt.

**Abweichungen vom Crew-Rollen-Konzept (C1–C6), mit Begründung:**

| Konzept | Umsetzung |
| --- | --- |
| Einladung durch die Stammcrew wird zur Anfrage an die Admins | direkt aufgenommen (der Schalter ist die Freigabe des Eigners); Verwalter sehen die Liste und entfernen. Eine Anfragen-Tabelle für Boote wäre ein zweiter Ablauf neben Gruppen – „weniger ist mehr“ |
| Titel für alle am Boot | nur Stammcrew; Eigner und Admins haben ihre Rolle als Bezeichnung |
| „alle Angemeldeten“ dürfen zuordnen | „alle, die dem Boot folgen“ – ohne Folgen gäbe es keine Auswahl-Liste, ohne Liste keine Bedienung; Folgen ist ein bewusster Schritt |
| Stammcrew als Stufe in `boat_admins` (ROLLEN.md) | eigene Tabelle `boat_crew` (41.1) |

## 41.3 Lösch- und Sichtbarkeitspfade (F-270)

| Gespeichert | entfernt auf welchem Weg |
| --- | --- |
| `boat_crew`-Zeile | einzeln (`removeCrewMember`: Verwalter oder austreten); Boot gelöscht (`removeBoat`, auch Moderation); Konto der Person gelöscht und Konto des Eigners gelöscht (`purgeUser`, ausdrücklich); Konten zusammengeführt (`mergeUsers`: Doppel und eigene/verwaltete Boote fallen weg, der Rest wandert); Eigner-Wechsel durch die Moderation (neuer Eigner verlässt die Stammcrew); Fremdschlüssel `ON DELETE CASCADE` als Netz |
| `title` | mit der Zeile; leeren über PATCH |
| Schalter an `boats` | mit dem Boot |
| Einladung `boat_member` | wie alle Einladungen (zurückziehen, Ablauf, Boot/Konto gelöscht) |
| Zuordnung eines Törns (`shares.boat_id`) | lösen durch Verwalter (F-274): Bestätigungen des Skippers fallen, Neuigkeiten werden neu gebaut; der Törn bleibt |

| Wer | sieht |
| --- | --- |
| Besucher | Mitglieder mit öffentlichem Profil samt Titel, der Rest als Anzahl; keine IDs, keine Schalter |
| Stammcrew | alle Mitglieder (private Profile mit Spaßnamen), die eigene ID, die eigene Rechte-Lage (`canPost`, `canInvite`) |
| Eigner, Admins | alle mit IDs und die Schalter (ändern nur der Eigner) |

Register: `boat_crew` in `worker/cleanup-registry.ts`. Datenschutz: `src/content/legal.ts` (Abschnitt „Was du teilst“).
