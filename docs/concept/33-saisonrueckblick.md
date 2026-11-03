# 33. Saisonrückblick: „Meine Saison“-Bild und Abzeichen-Reihe (F-520 … F-524, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 33). Setzt „Als Nächstes“ #2 der Roadmap um. Baut auf dem Fahrtenbuch
nach Jahren (Konzept 27) und dem Teilen-Bild der Törns (F-47, `src/services/share-image.ts`) auf; Meilensteine aus
Konzept 11.3 (`MILESTONES_NM`), Kennzeichnung geschätzter Meilen nach K3/K6.

Ziel: Am Saisonende kann jede:r die eigene Saison als Bild teilen. Das bringt Reichweite ohne Werbung; die
Abzeichen-Reihe zeigt, was schon erreicht ist und was als Nächstes kommt, und lädt zum Wiederkommen ein.

## 33.1 Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“)

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | **Nichts Neues gespeichert, keine Migration** (0041 bleibt frei), kein neuer Endpunkt. Grundlage ist die Liste, die die Seite `/konto/fahrtenbuch` ohnehin lädt (`GET /api/me/logbook`, `worker/logbook-list.ts`, Crew-Regel M1 unverändert). Die Zahlen rechnet der Browser (`src/domain/season-review.ts`, auf `logbookTotals` aufgebaut), das Bild zeichnet der Browser. |
| Querschnitte | Sichtbarkeit/Sperre: unverändert aus `GET /api/me/logbook` (eigene ohne gesperrte, Crew nach M1). Caches: keine neue Antwort, `private, no-store` bleibt. Stream, Ziele, Benachrichtigungen, Zähler, Kontingente, Einbettungen, Admin, Zusammenführen: unberührt. Die Meilenstein-Einträge im Stream (11.3, `worker/activity.ts`) bleiben, wie sie sind. |
| Lösch- und Sichtbarkeitspfade | Gespeichert: nichts (kein D1, kein R2, kein `localStorage`). Das Bild entsteht als `Blob` im Speicher des Browsers und wird beim Schließen des Dialogs verworfen (`URL.revokeObjectURL`). Wer sieht es: nur die Person selbst; nach außen geht es ausschließlich, wenn sie selbst „Teilen …“ (Teilen-Menü des Geräts) oder „Herunterladen“ wählt. |
| Komponentenschnitt | Reine Regeln `src/domain/season-review.ts` (`seasonReview`, `seasonBadges`, `seasonImageFileName`). Zeichnen `src/services/season-image.ts` mit den geteilten Bausteinen aus `share-image.ts` (`FORMATS`, Farben `SHARE_COLORS`, `SHARE_FONT`, `roundRect`, `drawBrand`, `canvasToJpeg`, `downloadFile`, `shareOrDownload`); die Törn-Bilder nutzen dieselben Helfer. Darstellung: `sx-season-badges` (Abzeichen-Reihe, auf der Seite unter den Summen) und `sx-season-review` (Dialog mit `dialogStyles`: Vorschau, Format, Teilen, Herunterladen). Ablauf im vorhandenen `LogbookPageController` (Bild rendern, teilen, herunterladen). Events: `sx-season-open`, `sx-season-format` { format }, `sx-season-share`, `sx-season-download`, `sx-season-close`. Mobil: Dialog randlos (F-291), Abzeichen umbrechend statt seitlich scrollend, Tippziele ≥ 44 px. |
| Parallele Arbeit | `feature/name-luv-leute` ändert den Markennamen in `share-image.ts`: die Markenzeile steht jetzt in genau einer Funktion `drawBrand` – der neue Name greift dort für beide Bilder, im neuen Code steht kein Markenname. `feature/wertung` (gemergt) berührt `sx-logbook-page` – hier nur eine Zeile im Saison-Abschnitt. |

## 33.2 Zahlen der Saison (F-520)

Grundlage sind genau die Einträge, die die Seite gerade summiert: gewählte Saison (`seasonOf`, ab November zählt zur
nächsten) und gewählter Stand-Filter; ausgeschlossene zählen nie (F-422). Damit stimmen Bild und Summen auf der Seite
immer überein („Was du siehst, teilst du“).

| Zahl | Regel |
| --- | --- |
| Seemeilen | Summe wie in den Summen (`logbookTotals`), mit „davon … aufgezeichnet“, wenn geschätzte Meilen dabei sind (K3) |
| Törns | Zahl der zählenden Einträge (eigene und Crew nach M1) |
| Stunden | je Eintrag die Angaben „unter Segel“ + „unter Motor“; ohne Angaben die Zeit von Abfahrt bis Ankunft – nur mit echten Uhrzeiten und nur am selben Tag (sonst zählten Nächte im Hafen mit) |
| Tage an Bord | wie in den Summen (Angabe, sonst Kalendertage) |
| Boote | verschiedene Bootsnamen (Groß-/Kleinschreibung egal) der Einträge, die ein Boot nennen |
| Häfen | wie in den Summen (verschiedene Start- und Zielhäfen) |
| Längster Törn | **nur aufgezeichnete Strecken** (`distSource = 'track'`, K6: „längste Etappe nur aus Tracks“): Seemeilen und Datum, ohne Titel und Häfen |

## 33.3 Abzeichen-Reihe (F-521)

Je Schwelle aus `MILESTONES_NM` (100, 500, 1000 sm) ein Abzeichen: **erreicht** (hervorgehoben, mit Haken), das
**nächste** mit „noch … sm“ und Fortschrittsbalken, die übrigen gedämpft. Ab der höchsten Schwelle sind alle erreicht,
ein nächstes gibt es nicht. Die Reihe steht auf der Seite unter den Summen der Saison (gilt wie diese für den Filter)
und im Bild. Neue Schwellen kommen nur über `MILESTONES_NM` dazu – dann gelten sie für Stream und Abzeichen gleich.

**Abweichung zu den Stream-Meilensteinen (11.3), bewusst:** Der Stream meldet Meilensteine je Kalenderjahr aus
öffentlichen eigenen Törns, weil er sie anderen zeigt. Die Abzeichen sind persönlich und zählen die Fahrtenbuch-Saison
samt Crew-Törns (M1) und nicht öffentlicher Törns. Die Zahlen können sich daher unterscheiden; gespeichert wird für
die Abzeichen nichts.

## 33.4 Einstieg, Dialog und Bild (F-522, F-523)

- **Ein Einstieg (N1):** Knopf „Meine Saison 2026“ im Saison-Abschnitt von „Mein Fahrtenbuch“, neben der Überschrift
  der gewählten Saison (die Reiter wählen das Jahr). Nur, wenn in der Ansicht mindestens ein Eintrag zählt; nicht im
  Druck. Kein Eintrag im Konto-Menü, keine eigene Adresse.
- **Dialog** `sx-season-review`: Vorschau des Bildes (mit Alternativtext aus den Zahlen), Format „Quadrat“ (Standard,
  Social Media) oder „Querformat“ wie beim Törn-Bild, „Teilen …“ (nur, wenn das Gerät Dateien teilen kann) und
  „Herunterladen“, Hinweis „Das Bild entsteht nur in deinem Browser …“. Format wird nicht gespeichert.
- **Bild** (`drawSeasonImage`): heller, fester Farbsatz wie das Törn-Bild (unabhängig vom Farbschema), Kopf „Meine
  Saison 2026“, große Seemeilen-Zahl, Kacheln für Törns, Stunden, Tage an Bord, Boote, Häfen und längsten Törn (nur
  vorhandene Werte), Abzeichen-Reihe, unten die gemeinsame Markenzeile (`drawBrand`). Keine Karte (die Liste kennt
  keine Tracks), kein Name, keine Titel, keine Orte. Dateiname `meine-saison-2026.jpg`, JPEG wie das Törn-Bild.
- **K6:** nur eigene Werte – keine Vergleiche mit anderen, keine Platzierungen, keine „Top“-Angaben.

## 33.5 Datenschutz (F-524)

Kein neuer Abruf und keine neue Speicherung: Der Rückblick nutzt die geladene Fahrtenbuch-Liste. Das Bild verlässt das
Gerät nur durch die Person selbst. Crew-Törns anderer fließen nur mit den Eckdaten ein, die M1 ohnehin zeigt
(Seemeilen, Datum, Boot, Häfen als Anzahl). Der Datenschutztext (`src/content/legal.ts`, Absatz Fahrtenbuch) nennt das.

## 33.6 Entscheidungen ohne Rückfrage

| Frage | Entscheidung |
| --- | --- |
| Eigene Seite `/konto/saison`? | Nein – Dialog auf der Fahrtenbuch-Seite. Ein Weg, keine zweite Saison-Auswahl, keine neue Route |
| Daten vom Server? | Nein – dieselbe Liste wie die Seite; Summen-Regeln aus `logbook-year.ts` wiederverwendet |
| Welche Einträge zählen? | Wie die Summen der Ansicht (Saison + Filter), damit Bild und Seite übereinstimmen |
| Stunden bei mehrtägigen GPX ohne Angaben | zählen nicht (Zeitspanne enthielte Liegezeiten); Angaben „unter Segel/Motor“ zählen immer |
| Längster Törn | nur aufgezeichnete Strecken (K6), ohne Titel/Häfen im Bild |
| Name im Bild | nein – „Meine Saison“ genügt, nichts Personenbezogenes im Bild |
| Abzeichen speichern („einmal erreicht“) | nein – aus den Zahlen der Saison gerechnet; wer Einträge ausschließt, sieht das sofort |
| Migration 0041 | nicht gebraucht, bleibt frei |
