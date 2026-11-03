# 27. Verwaltungsbereich und Fahrtenbuch nach Jahren (Phase 8, F-411, F-412, F-418, F-455 … F-461, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 27). Setzt Phase 8 aus Konzept 21.8 um; Inhalt nach 21.6 und B14
(21.0), Meilennachweis-Export aus 19.6 und Ausnahme M1 aus Konzept 15. Wertung, Vorlagen, Punkte und Vereinsliste
(Phase 9, F-413/F-414) gehören nicht dazu.

Leitlinie des Betreibers: „weniger ist mehr, ein Weg nach Rom“. Deshalb **ersetzt** die neue Seite den Reiter
„Fahrtenbuch“ in „Mein Verlauf“ (F-428), statt ihn zu ergänzen, und der Konto-Dialog wächst nicht (R 9).

## 27.1 Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“)

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | **Keine neue Tabelle, keine Migration.** Zusatzangaben (F-412) sind weitere Felder in `shares.log` (JSON höchstens 8.000 Zeichen, Schema und Prüfung `parseLog` in `src/domain/logbook.ts`), für GPX- und Fahrtenbuch-Törns gleich. Stand im Fahrtenbuch bleibt `shares.log_state` (F-422), Rolle `shares.owner_role` bzw. `share_crew.role` mit Bestätigung (Konzept 15). Die reservierte Migration 0034 wird nicht gebraucht und bleibt frei. |
| Querschnitte | Sichtbarkeit: eigene Törns alle außer gesperrten (`locked_at`, wie „Mein Verlauf“); Crew-Törns anderer nach M1 (27.3) mit `IN_LOGBOOK_SQL`. Caches: nur `private, no-store`, nie öffentlich gecacht. Stream, Ziele, Benachrichtigungen, Zähler, Kontingente: unberührt (keine neuen Schreibwege außer `log` im bestehenden `PATCH /api/shares/:id`). Admin/Moderation: ausgeblendete bzw. gesperrte Törns fallen wie bisher heraus. Zusammenführen von Konten: `share_crew` und `shares` wandern schon (Konzept 18.8). |
| Lösch- und Sichtbarkeitspfade | Nichts Neues gespeichert außer Feldern in `shares.log` – sie gehen mit dem Törn (`removeShare`: einzeln, Ablauf, Konto, inaktiv, Moderation). CSV und Druckansicht entstehen beim Abruf, nichts wird abgelegt. Crew-Einträge verschwinden mit dem Crew-Eintrag (Austritt, Konto, Törn gelöscht) bzw. werden zum Vorschlag oder fallen weg, wenn die Bestätigung fällt (Boot gewechselt, Skipper-Wechsel). Wer sieht es: nur die Person selbst (`/api/me/…`, angemeldet). |
| Komponentenschnitt | Seite `/konto/fahrtenbuch` = `sx-logbook-page` (präsentational: Saison-Reiter, Filter, Summen, Liste), Ablauf `controllers/logbook-page.ts` (Laden, Stand ändern, Bearbeiten über das vorhandene `sx-logbook-form`), reine Regeln `src/domain/logbook-year.ts` (Saison, Filter, Summen, CSV, Dauer) und `src/domain/logbook-suggest.ts` (Vorschläge aus dem Track). Worker `worker/logbook-list.ts` (`GET /api/me/logbook`, `GET /api/me/logbook.csv`). Das Formular `sx-logbook-form` bekommt die Zusatzangaben und einen GPX-Modus (nur Häfen und Angaben). Mobil: Liste als Karten statt Tabelle, Saison-Reiter mit `data-scroll-x`, Tippziele ≥ 44 px. |
| Parallele Arbeit | `feature/loesch-register` (gemergt): Crew-Bedingung in `worker/logbook-sql.ts` aus den Bausteinen von `worker/visible-sql.ts`; keine neue Tabelle für `worker/cleanup-registry.ts`. `feature/grosse-gruppen` (Streams) – keine Überschneidung. |

## 27.2 Verwaltungsbereich und Einstieg (F-418, F-459)

- **Adresse** `/konto/fahrtenbuch` (SPA-Route, nur angemeldet; Gäste sehen „Anmelden“ mit Anmeldedialog). `/konto/…` ist
  der Verwaltungsbereich; weitere Reiter (Meine Törns und Beiträge, Fotos und Kontingente, Gruppen, Jahresbericht)
  ziehen schrittweise aus dem Konto-Dialog um – je eigener Schritt, ohne Funktionsverlust. Phase 8 bringt nur das
  Fahrtenbuch; der Konto-Dialog bekommt keinen neuen Reiter.
- **Ein Einstieg (N1):** „Mein Fahrtenbuch“ im Konto-Menü führt auf `/konto/fahrtenbuch`. Der Reiter „Fahrtenbuch“ in
  „Mein Verlauf“ entfällt (dort bleiben „Alles“ und „Nur ich“, mit dem Schalter „Ins Fahrtenbuch“ je Törn); die alte
  Adresse `/u/<handle>?bereich=fahrtenbuch` leitet auf die neue um. Neues entsteht weiter nur über „+ Neu“; im leeren
  Fahrtenbuch steht wie bisher „Eintrag hinzufügen“.

## 27.3 Fahrtenbuch nach Jahren (F-411, F-455, F-456)

`GET /api/me/logbook` liefert alle Einträge des Kontos (höchstens 1.000, neueste zuerst), die Seite gruppiert im Browser
nach Saison (`seasonOf`, wie überall: ab November zählt zur nächsten Saison). Reiter je Saison, neueste zuerst; die
gewählte Saison steht in der Adresse (`?saison=2026`).

| Spalte / Kopf | Inhalt |
| --- | --- |
| Zeile | Datum · Von → Nach · sm (Quelle) · Rolle (bestätigt) · Boot · Revier · Posten; Titel als Link zum Törn |
| Aktionen je eigener Zeile | „Bestätigen“ (Vorschlag), „Ausschließen“ bzw. „Wieder aufnehmen“ (F-422), „Bearbeiten“ öffnet `sx-logbook-form` (Fahrtenbuch-Eintrag: alles; GPX-Törn: Häfen und Zusatzangaben) |
| Filter (B14) | Mehrfachauswahl „Bestätigt“ · „Vorschläge“ · „Ausgeschlossen“, Standard die ersten beiden |
| Summen der Saison | über die **gefilterten** Einträge ohne ausgeschlossene: Törns, sm (davon aufgezeichnet), Stunden unter Segel / Motor, sm als Skipper:in, Nachtstunden, Tage an Bord, verschiedene Häfen, sm an der Küste, Tidengewässer, Posten mit Summe. „Nur bestätigte“ = Filter nur „Bestätigt“ |

**Crew-Törns anderer (Ausnahme M1):** Zeilen, in denen ich in `share_crew` stehe – nicht ausgeblendet, nicht gesperrt,
Konto der Eigentümer:in nicht gesperrt (`liveSql`, `notSuspendedSql` aus `worker/visible-sql.ts`), von ihr nicht ausgeschlossen. Mit **bestätigter Rolle** erscheinen sie in jeder Sichtbarkeit als
„Bestätigt“, aber nur mit Eckdaten (Datum, Von, Nach, sm, Quelle, Rolle, Boot, Dauer – kein Titel, keine Angaben,
kein Link, wenn ich den Törn nicht sehen dürfte). Ohne Bestätigung nur öffentliche Törns, als „Vorschlag“ mit Link.
Den Stand ändern kann ich an fremden Törns nicht (Austreten geht über das Crew-Panel des Törns).

## 27.4 Zusatzangaben (F-412, F-460, F-461)

Neue Felder in `shares.log` (alle optional, alles Selbstangaben, alles änderbar):

| Feld | Grenze | Revier |
| --- | --- | --- |
| `area` `inland` · `coastal` · `offshore` (B10) | – | schaltet die Felder um; ohne Angabe nur die gemeinsamen |
| `tidal` (Haken Tidengewässer) | – | Küste, offshore |
| `sailH` Stunden unter Segel (Motor: vorhandenes `engineH`) | 0–500, 0,1 h | alle |
| `nightH` Nachtfahrt | 0–500, 0,1 h | Küste, offshore |
| `daysAboard` Tage an Bord | 1–60 | alle |
| `locks`, `bridges` Schleusen, Brücken | 0–200 | binnen |
| `mast` Mast legen/stellen | 0–50 | binnen |
| Wind (max. Bft) | vorhandenes `wind.bft` | alle |
| `regatta` { name ≤ 80, place, starters } | 1–999, Platz ≤ Starter | alle |
| `items` Posten [{ name ≤ 40, n 0–999, note ≤ 200 }] | höchstens 10 | alle |

Felder, die zum gewählten Revier nicht passen, verwirft `parseLog` (eine Regel für Formular und Worker). Ganze Angaben
höchstens 8.000 Zeichen (Notizen und zehn volle Posten passen hinein).

**Vorschläge aus dem GPX** (rein, `src/domain/logbook-suggest.ts`, im Browser): Stunden unter Motor bzw. Segel aus dem
Speed-Profil (Abschnitte von 10 min in Fahrt mit ≥ 3 kn im Mittel, Streuung ≤ 12 % und Luftlinie ≥ 97 % der Strecke gelten
als Motor; Reste unter 5 min zählen nicht), Nachtstunden aus Zeit und Sonnenstand (Sonne unter −0,833°), Tage an Bord aus Abfahrt und Ankunft (Kalendertage in Ortszeit).
Das Formular zeigt sie als „Vorschlag aus dem Track“ mit „Übernehmen“ – gesetzt wird nichts ohne Klick und Speichern;
Nullwerte bleiben leer, Nachtstunden ohne Revier wählen „Küste“. Vorschläge gibt es nur in der Törn-Ansicht (dort ist der
Track geladen), nicht beim Bearbeiten aus der Liste.

**GPX-Törns bearbeiten:** Das Fahrtenbuch-Panel der Törn-Ansicht zeigt der Eigentümer:in immer „Bearbeiten“ (auch ohne
Angaben); das Formular ändert dann nur Häfen und Angaben (Datum und Strecke kommen aus dem Track, 409 `not_manual`).

## 27.5 Meilennachweis: CSV und Druck (F-457, F-458)

- `GET /api/me/logbook.csv?saison=2026&stand=confirmed,suggested` (ohne `saison` alle Jahre = Segellebenslauf):
  Spalten **Datum; Von; Nach; sm; Quelle; Rolle; Boot; Dauer**, Semikolon, UTF-8 mit BOM (öffnet in Excel), Zahlen mit
  Komma, Zellen mit `= + - @` am Anfang mit `'` entschärft. Gleiche Auswahl wie die Seite (Funktion
  `logbookCsv` in `src/domain/logbook-year.ts`), `Content-Disposition: attachment`, `private, no-store`.
- **Drucken**: Knopf „Drucken“ ruft den Druckdialog des Browsers („Als PDF speichern“); ein Druckstil zeigt nur Kopf,
  Summen und Liste der gewählten Saison und des Filters (ohne Knöpfe, über mehrere Blätter).
- Kein Server-Speicher, kein Mailversand – abgegeben wird der Nachweis von der Person selbst. Er ersetzt keine
  Unterschrift der Skipper:in (Konzept 15).

**Segellebenslauf (F-610 … F-613):** Der Reiter „Alle Saisons“ hinter den Saison-Reitern (`?saison=alle`) ist der eine Einstieg:
Übersicht mit Summen und Tabelle je Saison (`lifetimeReview` in `src/domain/season-review.ts`, gleiche Regeln wie die
Saison-Summen), „CSV“ ruft `?saison=alle` (Datei `segellebenslauf.csv`, erste Spalte „Saison“), „Drucken“ druckt die
Übersicht. Keine Migration, nichts gespeichert.

## 27.6 Abweichungen und Offenes

| Punkt | Umsetzung |
| --- | --- |
| Migration 0034 | nicht nötig (alles in `shares.log`); Nummer bleibt reserviert, aber unbenutzt |
| Revier-Vorschlag aus Hafen/Track | entfällt vorerst – Häfen kennen kein Revier; ohne Angabe zeigt das Formular nur die gemeinsamen Felder |
| Hafentage | entfällt (nur „Tage an Bord“) – weniger Felder |
| Tabelle | Liste als Karten in jeder Breite (eine Darstellung statt Tabelle plus Mobil-Karten) |
| Konto gesperrt | Crew-Törns gesperrter Konten fallen weg (Konzept 4.4, `notSuspendedSql`) – im Konzept 21.6 nicht genannt |
| Punkte je Vorlage, Jahresbericht für einen Verein | Phase 9 (F-413/F-414) |
| Konto-Dialog | nicht verkleinert; „Meine Törns“ (Freigaben) bleibt dort, bis der Verwaltungsbereich weitere Reiter bekommt |
| Lösch-Register | gemergt vor diesem Branch: Crew-Bedingung nutzt `liveSql`/`notSuspendedSql`; keine neue Tabelle, daher kein neuer Eintrag in `worker/cleanup-registry.ts` |
