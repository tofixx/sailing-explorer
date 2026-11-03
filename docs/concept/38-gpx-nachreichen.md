# 38. GPX nachreichen: Track zu einem gespeicherten Fahrtenbuch-Eintrag (F-600 … F-607, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 38). Roadmap „Danach“: **GPX zu gespeicherten Törns** – vergessene
Tracks lassen sich nachreichen, ohne den Törn neu anzulegen. Offen seit Konzept 23.3. Leitlinie „weniger ist mehr, ein
Weg nach Rom“: ein Endpunkt, ein Menüeintrag, keine Migration.

## 38.1 Entscheidungen (ohne Rückfrage getroffen)

| Frage | Entscheidung | Warum |
| --- | --- | --- |
| Welche Törns? | **Nur Fahrtenbuch-Einträge ohne GPX** (`source = 'manual'`). Ein vorhandener Track wird in v1 nicht ersetzt (409 `not_manual`). | Ersetzen hieße: Fotos neu zeitlich zuordnen, Bild und Wetter des alten Tracks verwerfen, Distanz-Sprünge in Wertung und Meilen. Einträge ohne GPX haben nichts davon (keine Fotos, kein Bild, F-309). Wer einen GPX-Törn ersetzen will, legt ihn heute neu an; das bleibt in 23.3 offen. |
| Plausibilität | Wie beim Hochladen (`plausibleGpx`, F-311) und zusätzlich **Zeitfenster**: Der Track muss den Tag des Eintrags (Abfahrt bis Ankunft) **± 1 Kalendertag** (UTC) berühren (`trackDateError`), sonst 409 `track_mismatch` mit beiden Daten. Browser und Worker prüfen gleich; der Browser erklärt es vor dem Hochladen. | Ein falscher Track („die Datei vom Vortag“) fällt sofort auf. ± 1 Tag fängt Zeitzonen und Nachtfahrten ab. Statt einer Warnung mit „trotzdem“ gibt es genau einen Weg: erst das Datum des Eintrags ändern, dann nachreichen. |
| Track ohne Zeitstempel | Erlaubt (wie F-05); Abfahrt und Ankunft des Eintrags bleiben, das Zeitfenster entfällt. | Plotter-Exporte haben oft keine Zeiten; der Eintrag bringt das Datum schon mit. |
| Was ändert sich am Törn? | `source = 'gpx'`, `dist_source = 'track'`, Distanz, Abfahrt/Ankunft (bei Zeitstempeln), Track-Zahl, Größe, Kurzbeschreibung (`summary` wie beim Hochladen), Post-Art `logbook` → `voyage`. | Danach ist er ein gewöhnlicher GPX-Törn: Fotos, Übersichtsbild, Wetter, Speed-Kennzahlen. |
| Was bleibt? | ID, Link und Schlüssel, Titel, Sichtbarkeit, „Sichtbar bis“, Gruppen-Auswahl, Boot, Häfen, Fahrtenbuch-Angaben (`log`), Stand „Ins Fahrtenbuch“, eigene Rolle, Crew samt Bestätigungen, Kommentare, Reaktionen, Einladungen, Aktivitäten. | Nichts davon hängt am Track. Bestätigungen fallen nur bei einem anderen Boot (Konzept 15) – das Boot bleibt. |
| Neuigkeiten, Benachrichtigungen | Keine neuen. Ist der Törn öffentlich, prüft `recordDistanceGain` (`worker/activity.ts`) die Meilensteine für den Zuwachs an Strecke (neu − alt), mit den Regeln von F-166 (laufende Saison, je Schwelle einmal im Jahr). War der Eintrag ein Nachtrag im Bündel „hat n Törns ins Fahrtenbuch nachgetragen“ (`logbook`, F-308), bleibt er dort: Das Bündel liest seine Törns beim Anzeigen über die IDs und zeigt ihn jetzt mit Track; ein eigener `voyage`-Eintrag entsteht nicht. | Es ist eine Ergänzung, kein neuer Törn; Stream-Einträge zeigen den Törn über seine ID und damit ab sofort mit Track. Meilensteine sind aber Summen – ohne Prüfung fiele eine Schwelle, die erst der Track überschreitet, still aus. |
| Kontingente | Wie ein neuer GPX-Törn: Törn-Kontingent (`checkShareQuota`, der Eintrag zählt danach als Törn), Speicher (`checkStorageQuota`, gerechnet mit der Differenz zur alten Route), Notbremse (`checkBrake`). Das Fahrtenbuch-Kontingent (L1) wird frei. | Ein Eintrag mit Track belegt so viel wie ein Törn – sonst wäre „Eintrag anlegen, GPX nachreichen“ ein Weg um das Kontingent. |
| Aufbewahrung | Ab dem Nachreichen gilt die Frist der Törns (`shareExpiry`, gerechnet ab dem Anlegen des Eintrags), eine Saison kürzer als ohne GPX (L2). Läge sie **innerhalb der Warnfrist** (≤ 14 Tage) oder schon vorbei, lehnt der Worker ab (409 `expiry_soon`, mit Datum). `expiry_warned_at` wird zurückgesetzt. Die Einzelansicht liefert der Eigentümer:in `trackExpiresAt` (`TRACK_EXPIRES_SQL`); liegt er in der Warnfrist, zeigt das Menü den Eintrag gar nicht erst (`offerAttachTrack`) – keine Dateiwahl, die dann scheitert. Die Rückfrage im Browser nennt den Wechsel, der Datenschutztext die 14-Tage-Regel. | `EXPIRES_SQL` rechnet aus `source`: Ein Eintrag der Vorsaison würde sonst in der nächsten Nacht ohne Warnung gelöscht. |
| Wetter, Vorschaubild | Im Browser wie beim Hochladen: Wetter einmal laden und in die Payload legen; nach dem Speichern das Übersichtsbild (Querformat) zeichnen und `PUT /api/shares/:id/image` – jetzt erlaubt, weil der Törn nicht mehr `manual` ist. | Gleicher Weg wie `SessionController.upload`, kein zweiter Bild- oder Wetter-Code. |
| Gleichzeitig (Review S1–S3) | R2 wird nur mit passendem ETag überschrieben (`onlyIf: { etagMatches }`, vorher gelesen; sonst 409 `conflict`, nichts angefasst). Das UPDATE gilt nur, solange der Törn noch `manual` ist (`AND source = 'manual'`, Zähler-Statement ebenso); sonst 409. Scheitert der D1-Batch oder ändert er nichts: alte Route zurückschreiben, solange der Eintrag noch ohne GPX ist; ist der Törn weg, die neue Datei löschen (404). `PATCH /api/shares/:id` schreibt eine neue Route ebenfalls nur mit passendem ETag und ändert die Zeile nur auf dem gelesenen `source` (409 sonst). | Kein doppelter Zähler, keine verwaiste Datei, keine Route über einem Track und kein veraltetes PATCH über einem nachgereichten Törn. Tests: gleichzeitige Aufrufe prüfen Datei, Zeile und Zähler gegeneinander. |

## 38.2 Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“)

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | **Keine Migration** (0046 bleibt frei). Erweiterung eines bestehenden Objekts: Spalten von `shares` (`source`, `dist_source`, `dist_nm`, `started_at`, `ended_at`, `track_count`, `size_bytes`, `summary`, `expiry_warned_at`) und `posts.kind`. R2: dieselbe Datei `shareKey(id)` wird überschrieben (die Route war schon dort). |
| Querschnitte | Sichtbarkeit: `ownedShare` (fremde, gesperrte → 404), `assertActive` (gesperrte Konten 403), `UPLOAD_LIMITER`. Zähler/Kontingente: siehe 38.1, Speicher-Zähler über `replaceManualPayloadStmt` (`worker/storage.ts`) im selben Batch. Caches: `GET /api/shares/:id/data` ist `private, no-cache` mit ETag (die neue Datei hat einen neuen); Stream- und Entdecken-Caches (60 s) laufen ab wie bei jeder Törn-Änderung – nichts Betrachterabhängiges kommt hinzu; der Browser lädt Metadaten und Payload nach dem Nachreichen neu. Benachrichtigungen, Aktivitäten, Einbettungen, Zusammenführen, Admin: unberührt. Aufbewahrung: `EXPIRES_SQL` folgt `source` (38.1). |
| Lösch- und Sichtbarkeitspfade | 38.3 |
| Komponentenschnitt | Reine Regeln `src/domain/track-attach.ts` (`canAttachTrack`, `trackDateError`, `attachExpiryError`). Worker: `attachTrack` in neu `worker/track-attach.ts` (Route `PUT /api/shares/:id/track` in `worker/index.ts`), nutzt `checkPayload`, `decodeHeader`, `NOT_FOUND`, `shareDetail` aus `shares.ts` (nur exportiert). Oberfläche: Menüeintrag „GPX nachreichen“ in `voyageMenuItems` (`sx-voyage-byline`, nur Eigentümer:in eines Eintrags ohne GPX), die Byline öffnet direkt aus dem Klick eine verborgene Dateiauswahl und meldet `sx-track-attach` { file }; Ablauf `WorkspaceController.attach` (GPX lesen, prüfen, Rückfrage `sx-confirm`, Wetter, Hochladen, Törn neu öffnen), danach `SessionController.uploadPreview` (Übersichtsbild). `api.attachTrack` in `services/api.ts`. Eine Zeile Verdrahtung in `app.ts`. 375 px: nur ein Menüeintrag im vorhandenen Sheet und der vorhandene Rückfrage-Dialog. |
| Parallele Arbeit | `feature/moderation-titelbilder`, `feature/moderation-admin`, `feature/revier-heatmap`, `feature/invite-box`, `feature/segellebenslauf` fassen `shares.ts`, `storage.ts`, `sx-voyage-byline` und `workspace.ts` nicht an (Spalte „Berührt“). Hier in `shares.ts` nur `export` vor vier vorhandenen Helfern. |

## 38.3 Lösch- und Sichtbarkeitspfade

| Gespeichert | Entfernt auf welchem Weg |
| --- | --- |
| Track-Payload (R2 `shareKey`, ersetzt die Route) | überschreibt die Route (kein zweites Objekt); mit dem Törn: einzeln (`removeShare`), Frist (`deleteExpired`, jetzt nach Törn-Regel), Konto bzw. inaktives Konto (`purgeUser`), Moderation (Löschen/Sperrfrist), Zusammenführen (Törn wandert mit). Törn während des Nachreichens gelöscht → Datei sofort wieder entfernt. |
| Übersichtsbild (R2 `previewKey`, neu möglich) | wie jedes Übersichtsbild: mit dem Törn auf allen obigen Wegen (`shareFileKeys`). |
| Speicher-Zähler | Differenz neu − alte Route im selben Batch; beim Löschen zieht `subtractShareStmt` den ganzen Törn ab; nächtlich neu berechnet. |
| Fotos (neu möglich) | unverändert (`photos`, Konzept 7). |

Wer sieht es wo: wie den Törn selbst (Sichtbarkeit, Schlüssel, „Sichtbar bis“ unverändert). Den Menüeintrag sieht nur die
Eigentümer:in eines Eintrags ohne GPX.

## 38.4 Anforderungen

F-600 … F-607 in `docs/REQUIREMENTS.md` (Block „GPX nachreichen“); Tests in `test/functional/track-attach.test.ts`
(Worker), `test/functional/track-attach-ui.test.ts` (Menü, Byline, Ablauf im Browser) und `test/track-attach.test.ts`
(Regeln). F-608, F-609 bleiben frei; Migration 0046 wurde nicht gebraucht.

Löschwege ohne eigenen Test hier: inaktives Konto (betrifft nur Konten ohne Törns), Moderation und Zusammenführen –
sie laufen über `removeShare`/`purgeUser` bzw. hängen die Törn-Zeile um und kennen nur `shareKey`/`previewKey`, die
dieser Weg nicht ändert (Tests dort: `admin.test.ts`, `deletion.test.ts`).
