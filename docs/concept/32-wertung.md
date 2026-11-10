# 32. Wertung und Jahresbericht (Phase 9, F-413, F-414, F-418, F-500 … F-507, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 32). Setzt Phase 9 aus Konzept 21.8 um; Inhalt nach 21.6 (B11) und baut
auf Konzept 27 auf (Seite `/konto/fahrtenbuch`, `worker/logbook-list.ts`, Zusatzangaben in `shares.log`, CSV mit
Formel-Schutz, Crew-Ausnahme M1, `log_state`).

Leitlinie des Betreibers: „weniger ist mehr, ein Weg nach Rom“ – ein schlanker erster Schnitt statt allem aus 21.6.
Risiko laut 21.8: Erwartung einer „offiziellen“ Wertung. Deshalb steht überall, wo Punkte erscheinen (Fahrtenbuch,
Formular, Jahresbericht, Vereinsliste, Vorlagen), derselbe Hinweis `SCORING_NOTE`: „Vereinshilfe nach deinen Angaben –
keine offizielle Wertung.“ Grundsatz K6 („keine Ranglisten“) bleibt: die Vereinsliste gibt es nur im Verein, nur mit
Opt-in der Person, nie öffentlich, nie vereinsübergreifend, ohne Platzziffern, ohne Challenges.

## 32.1 Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“)

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Migration `0040_scoring.sql` (additiv): **eine** Tabelle `scoring_templates (id, group_id → groups ON DELETE CASCADE, name, rules, source_id, list_weight, created_at, updated_at)` für Vorschläge der Plattform (`group_id` leer) und Vereinsvorlagen – statt `scoring_templates` plus `group_templates` aus 21.6. `rules` ist JSON des Baukastens, geprüft von `parseRules`. Keine Konto-ID. Opt-in als Spalte `group_members.scoring_opt_in_at` (Zeitpunkt der Zustimmung). Die Vorlage eines Eintrags steht als `templateId` in `shares.log` (`parseLog`, keine Spalte). Zwei Vorschläge kommen mit der Migration („Fahrtenpreis klassisch“, „Binnen-Wanderfahrt“); „Nur Meilen“ ist eingebaut (`BASE_TEMPLATE`, nicht löschbar). |
| Querschnitte | Sichtbarkeit: Vereinsliste über den Baustein `clubListSql` (`worker/scoring-sql.ts`) aus `publicSql`, `liveSql`, `notSuspendedSql`, `IN_LOGBOOK_SQL` = Regel `countsInClubList`; Test hält beide gleich. Caches: alles `private, no-store`, nichts öffentlich gecacht (statt „10 min gecacht“ aus 21.6 – gerechnet wird beim Abruf, gedeckelt auf 5.000 Törns). Stream, Ziele, Benachrichtigungen, Zähler, Kontingente: unberührt. Admin/Moderation: ausgeblendete, gesperrte Törns, gesperrte Konten und ausgeblendete bzw. gesperrte Vereine fallen heraus. Zusammenführen von Konten: `group_members` wandert samt Opt-in (bei doppelter Mitgliedschaft gilt die des Zielkontos). |
| Lösch- und Sichtbarkeitspfade | Tabelle 32.5. Wer sieht was: 32.4. |
| Komponentenschnitt | Reine Regeln `src/domain/scoring.ts` (Baukasten, `parseRules`, `scoreEntry`, `pointsByTemplate`, `clubPoints`, `countsInClubList`, `reportScores`); CSV bleibt `logbookCsv` (`logbook-year.ts`) mit optionalen Punkten. Worker: `worker/scoring.ts` (Vorlagen, Auswahl, Opt-in), `worker/scoring-list.ts` (Vereinsliste mit schlanker Spaltenliste), `worker/scoring-routes.ts`. Oberfläche: Seite `/konto/wertung` = `sx-scoring-page` (präsentational, Einstieg als Link auf `/konto/fahrtenbuch`) mit dem einen Formular `sx-scoring-editor` (Dialog mit `dialogStyles`), Ablauf `controllers/scoring-page.ts`; Client-API `src/services/scoring-api.ts` (eigenes Modul neben `api.ts`). `sx-logbook-form` bekommt die Vorlagen-Auswahl, `sx-logbook-page` Punkte je Eintrag und je Vorlage. Mobil: Karten statt Tabellen, Faktoren im Formular in einem Raster, das bei 375 px einspaltig wird; Tippziele ≥ 44 px. |
| Parallele Arbeit | `feature/umfragen`, `feature/veranstaltungen`, `feature/galerie`, `feature/grosse-gruppen` berühren `cleanup-registry.ts`, `api.ts`, `app.ts`, `group-routes.ts`, `groups.ts`, `legal.ts`. Dieser Branch fasst `api.ts`, `group-routes.ts` und `groups.ts` nicht an (eigene Module, Vereinsvorlagen fallen per Cascade); in `cleanup-registry.ts`, `index.ts`, `app.ts`, `legal.ts` nur angehängte Zeilen. Keine Streams, kein `sx-compose`, keine Gruppenseite, keine Fotos. |

## 32.2 Baukasten (F-500, F-502)

Kein Formeltext, kein `eval`: eine Vorlage ist eine feste Liste von Bausteinen mit Gewichten (`RULE_FIELDS`), dazu bis
zu zehn Posten. Unbekannte Bausteine, Text statt Zahl und Werte außerhalb der Grenzen lehnt `parseRules` mit deutscher
Meldung ab; fehlende Bausteine bekommen den Standard von „Nur Meilen“.

| Baustein | Grenze | „Nur Meilen“ | Wirkung |
| --- | --- | --- | --- |
| Punkte je sm unter Segel / Motor | 0–100 | 1 / 1 | Anteil unter Motor = Motorstunden ÷ (Segel- + Motorstunden), ohne Stunden alles unter Segel |
| Faktor Binnen / Küste / Offshore, Zuschlag Tide | 0–10 | 1 / 1 / 1, 0 | auf die Seemeilen; ohne Revier Faktor 1 |
| Faktor Skipper:in / Co / Crew / Gast | 0–10 | 1 | auf die Seemeilen; ohne Rolle Faktor 1 |
| Punkte je Nachtstunde, Tag an Bord, Schleuse, Brücke, Mast | 0–1.000 | 0 | Tage an Bord: Angabe, sonst Kalendertage (`entryDays`) |
| Regatta: je Teilnahme, je Platzierung | 0–1.000 | 0 | Teilnahme + (Starter − Platz + 1) × Gewicht, ohne Platz nur Teilnahme |
| Posten (Name, Punkte je Einheit, Deckel) | ≤ 10, 0–1.000, 0–100.000 | – | zählt gleichnamige Posten des Eintrags (Groß-/Kleinschreibung egal) |
| Deckel je Eintrag | 0–100.000 | 0 (ohne) | |
| Einheit (sm/km), Zuschlag gegen den Strom, Bootsklasse mit Faktor, Langtörn | Konzept 39 | sm, 0, keine, 0 | Konzept 39 (F-626 … F-630) |

`scoreEntry(entry, rules)` rechnet einen Eintrag (eine Nachkommastelle), ausgeschlossene zählen nie; Summen je Vorlage
(`pointsByTemplate`) sind die Summe der Einträge. Eine Regel für Browser (Fahrtenbuch, Jahresbericht) und Worker
(Vereinsliste, CSV).

## 32.3 Vorlagen und Auswahl (F-500, F-501)

| Wer | Was |
| --- | --- |
| Plattform-Admins (`ADMIN_USER_IDS`) | pflegen die **Vorschläge der Plattform** (höchstens 20) auf `/konto/wertung` – derselbe Editor wie für Vereine, nicht im Admin-Bereich (ein Formular, Abweichung von 21.6) |
| Eigner:in und Admins eines Vereins (nur `kind = 'club'`, nicht ausgeblendet oder gesperrt) | **übernehmen** einen Vorschlag (Kopie mit Herkunft `source_id`), **erweitern** ihn (Bausteine, Posten, Name) oder legen **eigene** an; höchstens 10 je Verein (atomar `INSERT … SELECT … WHERE COUNT < n`); legen je Vorlage fest, ob und mit welchem Faktor sie in der Vereinsliste zählt |
| Mitglieder eines Vereins | wählen im Fahrtenbuch-Formular **je Eintrag eine Vorlage** (Pflichtfeld, immer genau eine gewählt): „Nur Meilen“, Vorschläge und Vorlagen der eigenen Vereine; vorbelegt mit der Vorlage des Eintrags, sonst der zuletzt genutzten (`lastTemplateId`), sonst „Nur Meilen“. Beim Speichern prüft der Worker, dass eine neu gewählte Vorlage wählbar ist (400 `invalid_template`); eine unverändert mitgesendete bleibt erlaubt (z. B. nach dem Austritt) |
| Ohne Verein | kein Feld (weniger ist mehr); die Vorlage des Eintrags wird unverändert mitgesendet, sonst gilt „Nur Meilen“ |
| Altbestand, gelöschte oder nicht mehr wählbare Vorlage | rechnet beim Lesen mit „Nur Meilen“ (`templateFor`) – es wird nichts umgeschrieben |

Crew-Törns anderer (M1) tragen keine Angaben der Eigentümer:in und damit keine Vorlage: im eigenen Fahrtenbuch zählen
sie mit „Nur Meilen“ (Rolle aus der Crew), in der Vereinsliste gar nicht (dort zählen nur eigene, im Verein gezeigte
Törns).

## 32.4 Vereinsliste und Gewichtung (F-414, F-503, F-504)

`GET /api/groups/:id/scoring?saison=` rechnet beim Abruf je **teilnehmender** Person (Opt-in) die Punkte aus ihren
Törns (gelesen ausgehend von `share_groups` über den Index `share_groups_group`, neueste zuerst), die (1) sie in diesem
Verein zeigt, (2) öffentlich und nicht ausgeblendet oder gesperrt sind,
(3) im Fahrtenbuch stehen (`log_state` ≠ ausgeschlossen), (4) deren Konto nicht gesperrt ist und (5) deren Vorlage eine
Vorlage dieses Vereins mit Faktor ist. Ohne Saison: bis Ende Februar die abgelaufene, ab 1. März die laufende
(`clubListSeason` = `shownSeason`, F-555).

| Wer | sieht |
| --- | --- |
| Eigner:in und Admins des Vereins | die Liste aller Teilnehmenden: Profilname (mit öffentlichem Profil als Link), Punkte, Zahl der Einträge, Punkte je Vorlage – keine Einzelangaben der Törns |
| Mitglieder mit Opt-in | nur die **eigene** Summe (gerechnet wird nur über die eigenen Törns), nie die anderer |
| Mitglieder ohne Opt-in | 403 `opt_in_required` – nur den Schalter |
| Nicht-Mitglieder, Gäste, Follower | nichts (404 bzw. 401); keine öffentliche Antwort, kein Cache |

Die Teilnahme schaltet die Person selbst um (`PUT /api/groups/:id/scoring { optIn }`, wirkt sofort); der Schalter heißt
„An der Vereinsliste teilnehmen: Eigner:in und Admins von … dürfen meine Punktesumme sehen“ und sagt, welche Törns
zählen. Sortiert nach Punkten ohne Platzziffern – eine Hilfe der Vereinsführung für den Fahrtenpreis, keine Rangliste
unter Mitgliedern (Entscheidung nach Review, 03.11.2026).

**Gewichtung (entschieden 03.11.2026, 32.7):** ein **Faktor je Vereinsvorlage** (0,1–10, leer = zählt nicht). Die
Punktesumme einer Person ist Σ Punkte je Vorlage × Faktor (`clubPoints` – die einzige Stelle; eine andere Auslegung
ändert nur diese Funktion und das Feld `list_weight`). So kann ein Verein z. B. Arbeitsdienst doppelt und Regatten
halb zählen lassen.

## 32.5 Lösch- und Sichtbarkeitspfade (F-506)

| Gespeichert | entfernt auf welchem Weg |
| --- | --- |
| Vereinsvorlage (`scoring_templates`, `group_id` gesetzt) | einzeln (`deleteTemplate`, Eigner/Admins); mit dem Verein per Cascade (`removeGroup`: Löschen durch die Eigner:in, Konto der Eigner:in ohne Nachfolge über `purgeUserGroups`, Moderation) |
| Vorschlag der Plattform (`group_id` leer) | nur einzeln durch Admins; Vereinskopien bleiben (Herkunft fällt still weg) |
| Opt-in (`group_members.scoring_opt_in_at`) | mit der Mitgliedschaft: Austritt, Entfernen, Verdrängung, Konto gelöscht, inaktives Konto, Verein gelöscht; ausschalten setzt ihn leer. Neuer Beitritt beginnt ohne Opt-in |
| `log.templateId` am Törn | mit dem Törn (`removeShare`: einzeln, Frist, Konto, Moderation); zeigt sie auf eine gelöschte Vorlage, gilt „Nur Meilen“ |
| Vereinsliste, Jahresbericht, Punkte | nichts gespeichert – bei jedem Abruf gerechnet |

Register: `scoring_templates` in `worker/cleanup-registry.ts` (Cascade `groups`, `deleteTemplate`, `removeGroup`).

## 32.6 Jahresbericht (F-418, F-505)

Kein eigener Export und kein zweiter Knopf (N1): der vorhandene CSV-Export des Fahrtenbuchs
(`GET /api/me/logbook.csv`) bekommt die Spalten **Revier; Posten; Vorlage; Punkte**, danach eine Leerzeile, je Vorlage
eine Zeile „Summe“ (Seemeilen und Punkte) und den Hinweis „Vereinshilfe …“ – aber nur, wenn ein gezeigter Eintrag eine
andere Vorlage als „Nur Meilen“ hat (`usesTemplates`; sonst wären Punkte nur die Seemeilen noch einmal, und der
Meilennachweis bleibt wie in Konzept 27). Ebenso zeigt die Seite „Mein Fahrtenbuch“ nur dann Punkte je Eintrag und je
Vorlage; „Drucken“ druckt sie als „Jahresbericht Saison …“. Abgegeben wird er von der Person selbst;
nichts wird gespeichert oder verschickt.

## 32.7 Abweichungen von 21.6 und Offenes

| Punkt | Umsetzung |
| --- | --- |
| Gewichtung „nach Mitgliederzahl“ | **entschieden 03.11.2026: beim Faktor bleiben, keine Normierung nach Mitgliederzahl (K6).** Eingebaut ist ein Faktor je Vereinsvorlage (32.4). Eine Normierung nach Mitgliederzahl des Vereins ändert innerhalb eines Vereins die Reihenfolge nicht und hätte nur zwischen Vereinen Sinn – das wäre eine vereinsübergreifende Rangliste (K6). „Punkte je Kopf der Crew an Bord“ bräuchte die Crew-Zahl je Törn; als weitere Auslegung nur in `clubPoints` bzw. `scoreEntry` zu ergänzen |
| Punkte je verschiedenem Hafen | entfällt – eine Saison-Größe, die die Summe der Einträge bricht (Jahresbericht und Liste wären nicht mehr additiv) |
| Einstieg | kein Eintrag im Konto-Menü: Link „Wertung“ auf der Seite „Mein Fahrtenbuch“, nur für Mitglieder eines Vereins (und Plattform-Admins, die sonst die Vorschläge nicht erreichen) |
| Vereinsliste für Mitglieder | nur die eigene Summe; die Liste sehen Eigner:in und Admins |
| Seed der Migration | `INSERT` ohne `OR IGNORE` – bleibt so, weil die Vorschau-Datenbank 0040 schon angewendet hat (eine angewendete Migration wird nicht geändert) |
| Vorlagen im Admin-Bereich | Vorschläge pflegen Admins auf `/konto/wertung` mit demselben Formular wie Vereine |
| Eine Tabelle statt zwei | `scoring_templates` mit `group_id` leer bzw. gesetzt |
| Vereinsliste 10 min gecacht | nicht gecacht (`private, no-store`); gedeckelt auf 5.000 Törns je Abruf |
| Jahresbericht „für {Verein}“ | der Bericht nennt je Eintrag die Vorlage samt Verein und summiert je Vorlage; eine eigene Auswahl „für Verein“ entfällt |
| „Als abgegeben markiert“ (optional in 21.6) | entfällt |
| Echtes `.xlsx` | entfällt (CSV öffnet in Excel) |
| Teams | haben keine Vorlagen und keine Liste (nur Vereine, B11) |
