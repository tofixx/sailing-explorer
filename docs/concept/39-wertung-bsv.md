# 39. Vorschlag „Fahrtensegeln – Brandenburger Seglerverband e. V.“ (F-625 … F-632, 10.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 39). Erweitert den Baukasten der Wertung (Konzept 32) gerade so weit,
dass die Fahrtensegel-Wertung des BSV (Ausschreibung, vom Betreiber übergeben) sich als **Vorschlag der Plattform**
ausdrücken lässt. Vereine (z. B. der Potsdamer Seglerverein) übernehmen und erweitern ihn wie jeden Vorschlag. Es bleibt
eine Vereinshilfe: überall steht `SCORING_NOTE` – „nach der Ausschreibung des BSV, keine offizielle Wertung“.
Leitlinie: „weniger ist mehr, ein Weg nach Rom“.

## 39.1 Architektur-Skizze

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Kein neues Schema. Migration `0047_scoring_bsv.sql` schreibt **einen Datensatz** in `scoring_templates` (feste ID `bsvfahrten`, `group_id` leer, `INSERT OR IGNORE` – wiederholbar, nach dem Deploy in der Produktion vorhanden). Neue Bausteine stehen im JSON `rules` (geprüft von `parseRules`); ein neues optionales Feld `upstreamNm` in `shares.log` (`parseLog`). |
| Querschnitte | Keine neuen. Vereinsliste (`worker/scoring-list.ts`) und Fahrtenbuch (`worker/logbook-list.ts`) lesen zusätzlich `boats.boat_class` des Boots am Törn (Boot nur, wenn nicht ausgeblendet oder gesperrt – `liveSql('b')`, wie bisher die Bootsnamen); Crew-Törns (M1) bekommen keine Klasse (sie rechnen ohnehin mit „Nur Meilen“). Kein Cache, keine Zähler, keine Benachrichtigung. |
| Lösch- und Sichtbarkeitspfade | Wie Konzept 32.5: `upstreamNm` geht mit dem Törn; der Vorschlag ist ein Vorschlag der Plattform (nur Admins ändern/löschen, Vereinskopien bleiben). Die Bootsklasse wird nicht kopiert, nur beim Rechnen gelesen. Neu Gespeichertes über Personen: nur `upstreamNm` (Datenschutztext ergänzt). |
| Komponentenschnitt | Regeln nur in `src/domain/scoring.ts` (`RULE_FIELDS`, `parseRules`, `scoreEntry`, `longBonus`, `fieldLabel`, `templateItemNames`) und `src/domain/logbook.ts`. `sx-scoring-editor`: Auswahl „Einheit“ (sm/km) in der Gruppe „Strecke“, Auswahl „Bootsklasse“ (geteilte `boatClassOptions`) mit Faktor, Gruppe „Langtörn“; Beschriftungen folgen der Einheit. `sx-logbook-form`: binnen „Gegen den Strom (sm)“ neben „Mast“, Posten-Namen der wählbaren Vorlagen als `datalist`. Raster wie bisher, bei 375 px einspaltig. |
| Parallele Arbeit | Keine offenen Branches berühren `scoring.ts`, `logbook.ts`, `sx-logbook-form`, `sx-scoring-editor` (geprüft 09.11.). |

## 39.2 Abbildung der Ausschreibung

| BSV | Punkte | Umsetzung im Vorschlag |
| --- | --- | --- |
| Binnen / See je km (auch gestakt, getreidelt, gepaddelt) | 1 | `unit: km`, `nmSail` 1, Faktoren Binnen/Küste/Offshore 1. Gestakt usw. zählt als Strecke unter Segel. |
| Binnen im Optimist je km | 2 | `boatClass: optimist`, `classFactor` 2 – Klasse des Boots am Törn (Konzept 34) |
| je km gegen den Strom (≥ 5 km/h) | 3 | `upstream` 2 als **Zuschlag** zu den 1 je km: Angabe `upstreamNm` am Eintrag |
| unter Motor je km | 0,2 | `nmMotor` 0,2 – Anteil wie bisher aus Motor- ÷ (Segel- + Motorstunden) |
| Mast legen und wieder stellen | 2 | `mast` 2 je Angabe „Mast gelegt/gestellt“ |
| je Schleuse | 4 | `lock` 4 |
| Langtörn über 200 km / je weitere 100 km | 20 / 10 | `longFrom` 200, `longBonus` 20, `longStep` 100, `longStepBonus` 10 |
| Trailertransport (mind. 150 km vom Heimathafen) | 50 | Posten „Trailertransport (ab 150 km)“ |
| Gemeinschaftsfahrt je Tag (mind. 5 Boote, ausgeschrieben) | 20 | Posten „Gemeinschaftsfahrt je Tag (ab 5 Booten)“, Anzahl = Tage |
| Kinder- und Jugendtraining (ab 2 h, ehrenamtlich) | 25 | Posten „Kinder-/Jugendtraining (ab 2 h)“ |
| Funktion bei einer ausgeschriebenen Regatta je Tag (ab 5 h) | 25 | Posten „Regatta-Funktion je Tag (ab 5 h)“ |

Die Termine der Gemeinschaftsfahrten des PSV (Ansegeln, Pfingstfahrt, Absegeln, Jollentreff) sind Beispiele eines
Vereins und gehören nicht in den Vorschlag; ein Verein trägt sie als Veranstaltungen ein (Konzept 30).

**Rechenbeispiel:** 250 km binnen, davon 10 km gegen den Strom (eingetragen 5,4 sm), 2 Schleusen, Mast einmal gelegt
und gestellt: 250 + 10 × 2 + 20 (Langtörn) + 2 × 4 + 2 = **300** (wie die Ausschreibung: 240 × 1 + 10 × 3 + 20 + 8 + 2).
Im Optimist: 250 × 2 + 20 + 20 + 8 + 2 = **550**.

## 39.3 Entscheidungen

| Frage | Entscheidung |
| --- | --- |
| Kilometer | Ein Baustein **Einheit** (`unit`: sm oder km) statt umgerechneter Gewichte je sm (1/1,852 = 0,54 ließe sich nur gerundet speichern und wäre im Formular unverständlich). Die Einträge bleiben in sm (eine Einheit im Fahrtenbuch); eine km-Vorlage rechnet mit 1 sm = 1,852 km. Strecke, Zuschlag gegen den Strom und Langtörn gelten in der Einheit der Vorlage; Beschriftungen in Formular und Kurzbeschreibung folgen ihr. |
| Gegen den Strom | Angabe am Eintrag in **sm** wie die Strecke („davon gegen den Strom“), nur binnen (wie Schleusen und Mast), höchstens die Strecke des Eintrags. In der Vorlage ein **Zuschlag** je Einheit (BSV: 3 statt 1 → 2), ohne Faktoren – so wird nichts doppelt gezählt und der Baustein passt zu jeder Grundwertung. Im Jahresbericht beim Revier („Binnen (5,4 sm gegen den Strom)“). |
| Optimist | Allgemeiner Baustein **eine Bootsklasse mit Faktor** (Klasse aus `BOAT_CLASSES`), wirkt wie Revier und Rolle auf die Strecke – unabhängig vom Revier (Optimisten segeln binnen; eine Beschränkung auf binnen wäre ein weiterer Schalter ohne Nutzen). Der Zuschlag gegen den Strom wird nicht verdoppelt (Auslegung; die Ausschreibung sagt dazu nichts). Klasse aus dem Boot am Törn; ohne Boot oder Klasse Faktor 1. |
| Motor | Vorhandener Baustein; der Anteil unter Motor kommt aus den Stunden. Ohne Stunden zählt alles unter Segel – wer motort, trägt Motorstunden ein. |
| Langtörn | Je **Eintrag** (ein zusammenhängender, auch mehrtägiger Törn = ein Eintrag), über die ganze Strecke einschließlich Motor; „über 200“ streng, je **volle** weitere 100. Verglichen auf 0,1 gerundet, damit 162 sm als 300 km zählen. Ein über mehrere Einträge geteilter Törn bekommt ihn nicht (bewusst einfach). |
| Bedingungen der Posten | Keine Beschreibung je Posten (kein neues Feld): die Bedingung steht kurz im Namen; das Fahrtenbuch-Formular schlägt die Namen der Posten aller wählbaren Vorlagen vor (`datalist`), damit sie genau passen. |
| Seed | Migration 0047 mit `INSERT OR IGNORE` und fester ID – nach dem Deploy in Produktion und Vorschau vorhanden. Bis der neue Code läuft, liest alter Code die unbekannten Bausteine als „Nur Meilen“ (`readRules`) – kurz und unschädlich. |
| Grenzen | Unverändert: 10 Posten (der Vorschlag nutzt 4), Punkte 0–1.000, Faktoren 0–10, Zuschlag gegen den Strom 0–100, Langtörn-Schwelle 0–10.000. Vorlagen ohne die neuen Bausteine rechnen exakt wie vorher (Standard: sm, keine Klasse, 0). |
