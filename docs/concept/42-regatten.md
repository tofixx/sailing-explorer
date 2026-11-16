# 42. Regatten und Klassenvereinigungen (F-645 … F-651, 16.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 42). Wunsch des Betreibers (16.11.2026): *„Klassenvereinigungen als
Gruppen und Regatten mit Ergebnissen ähnlich wie Fahrtenbuch, sodass die Ergebnisse persönlich nach Jahren angelegt
und exportiert werden können sowie über den Verein freigegeben werden können, damit andere im Verein die Werte sehen
bzw. eine Übersicht der Regatten der Vereinsmitglieder im Verein entsteht – wie Fahrtenpunkte dort dann auch.“*
Umgesetzt autonom nach den Empfehlungen (Betreiber, 16.11.2026).

## 42.1 Architektur-Skizze

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | **Kein eigenes Objekt (K1):** Eine Regatta ist ein Fahrtenbuch-Eintrag (mit oder ohne GPX) mit `shares.log.regatta`. Das Feld gab es schon (Name, Platz, Starter, Konzept 27.4); neu sind Veranstalter, Wettfahrten, Gesamtpunkte und Bootsklasse (`parseLog`). Klassenvereinigung = neue Gruppenart `class` mit `groups.boat_class` (Migration `0051_regattas.sql`, additiv). Freigabe = die vorhandene Auswahl „In Gruppen zeigen“ (`share_groups`, F-373) – jetzt auch im Fahrtenbuch-Formular |
| Querschnitte | Sichtbarkeit: Übersicht nur für Mitglieder, nur öffentliche, nicht ausgeblendete/gesperrte, im Fahrtenbuch stehende Einträge nicht gesperrter Konten, die noch Mitglied sind – wie die Vereinsliste der Wertung (32.4). Caches: `private, no-store`. Stream, Benachrichtigungen, Kontingente: unberührt (ein Regatta-Eintrag ist ein normaler Fahrtenbuch-Eintrag). Crew (M1): Crew-Törns tragen die Regatta-Angabe der Eigentümer:in mit – beide haben sie gesegelt |
| Lösch- und Sichtbarkeitspfade | 42.4 |
| Komponentenschnitt | Reine Regeln `src/domain/regatta.ts` (Texte, CSV, Bündeln nach Regatta, Saisonwahl). Worker `worker/regattas.ts` (CSV, Übersicht). Oberfläche: Felder in `sx-logbook-form` (plus `sx-share-groups`), Abschnitt „Regatten“ in `sx-logbook-page`, neue Komponente `sx-group-regattas` auf der Gruppenseite, Art „Klassenvereinigung“ mit Bootsklasse im Gründen-Formular. Client-API `services/regatta-api.ts`. Mobil: Listen einspaltig, Auswahl 44 px |
| Parallele Arbeit | Keine laufenden Branches. Teil 1 dieses Branches (Stammcrew, Konzept 41) berührt andere Dateien |

## 42.2 Regeln

| Punkt | Entscheidung |
| --- | --- |
| Klassenvereinigung (F-645) | Gruppe wie ein Verein (Beitritt, Einladen, Beiträge durch Admins, Sichtbarkeit), aber **genau einer Bootsklasse** (`BOAT_CLASSES`, Pflicht beim Gründen, änderbar) und **ohne Pflicht-Heimathafen** (Klassenvereinigungen sind überregional). Keine Teams darunter, keine Wertungsvorlagen, kein Heimatverein, keine Vereinsverifizierung (wie Teams) |
| Ergebnis (F-646) | Name (Pflicht), Platz, Starter, Wettfahrten (1–999), Gesamtpunkte (0–9.999, eine Nachkommastelle), Veranstalter (≤ 80), Klasse (sonst die des Boots). Strecke bleibt Pflicht wie bei jedem Eintrag (Schätzung genügt) |
| Meine Regatten (F-647) | Abschnitt „Regatten“ auf „Mein Fahrtenbuch“ je Saison und für alle Saisons: eigene Einträge und Crew-Törns mit Regatta-Angabe, mit Platz, Details, Boot, Rolle |
| Export (F-648) | `GET /api/me/regattas.csv?saison=2026|alle`: Datum; Regatta; Veranstalter; Klasse; Boot; Rolle; Platz; Starter; Wettfahrten; Punkte – Formel-Schutz wie der Meilennachweis |
| Freigabe (F-649) | Wer einen **öffentlichen** Eintrag in einem Verein bzw. einer Klassenvereinigung zeigt, gibt das Ergebnis dort frei. Die Auswahl steht jetzt auch im Formular für Einträge ohne GPX (vorbelegt mit den Gruppen des Boots) |
| Übersicht (F-650) | `GET /api/groups/:id/regattas?saison=` für **alle Mitglieder** von Vereinen und Klassenvereinigungen (nicht Teams): je Regatta (gleicher Name in derselben Woche) die Ergebnisse nach Platz mit Anzeigename (Link bei öffentlichem Profil), Details, Boot, Rolle, Link zum Törn. Saisonwahl: vorgewählt wie Fahrtenbuch und Wertung (`shownSeason`), dazu ab November die schon begonnene nächste Saison und vier frühere. **Keine Rangliste** über Regatten hinweg und keine vereinsübergreifende Liste (K6) |
| Fahrtenpunkte | Die Wertung (Konzept 32) zählt Regatten schon (Bausteine „je Teilnahme“, „je Platzierung“); die Vereinsliste bleibt bei Eigner:in und Admins. Neu ist nur die Übersicht für Mitglieder |

## 42.3 Abweichungen und Gründe

| Wunsch | Umsetzung |
| --- | --- |
| „Regatten anlegen“ als eigener Typ | als Fahrtenbuch-Eintrag mit Regatta-Angaben: Sichtbarkeit, Crew, Rollen, Bestätigung, Export, Wertung, Löschwege und Fristen gibt es schon (K1) |
| Freigabe auch für nicht öffentliche Einträge | nur öffentliche – wie Vereinsliste und Neuigkeiten der Gruppe („Nur öffentliche Törns erscheinen in der Gruppe“); kostenlos ist ohnehin alles öffentlich (E1) |
| Vereins-Export der Übersicht | vorerst nicht – jede:r exportiert die eigenen Ergebnisse; eine Vereins-CSV wäre eine Liste über Personen (später mit Opt-in wie 32.4) |

## 42.4 Lösch- und Sichtbarkeitspfade (F-651)

| Gespeichert | entfernt auf welchem Weg |
| --- | --- |
| `shares.log.regatta` | mit dem Eintrag (`removeShare`: einzeln, Frist, Konto, inaktiv, Moderation); leeren beim Bearbeiten |
| Freigabe (`share_groups`) | wie bisher: „nicht mehr zeigen“, Austritt/Entfernen (die Übersicht prüft beim Lesen die Mitgliedschaft), Gruppe gelöscht, Eintrag gelöscht |
| `groups.boat_class` | mit der Gruppe |
| Übersicht, CSV | nichts gespeichert – bei jedem Abruf gerechnet |

| Wer | sieht |
| --- | --- |
| Mitglieder (jede Rolle) | die Übersicht ihres Vereins bzw. ihrer Klassenvereinigung |
| Nicht-Mitglieder, Gäste | nichts (404 bzw. 401), auch nicht aus einem Cache |
| die Person selbst | alle eigenen Regatten und die ihrer Crew-Törns im Fahrtenbuch und in der CSV |

Datenschutz: `src/content/legal.ts` („Was du teilst“).
