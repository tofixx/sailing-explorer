# 37. Revier-Wärmekarte und Cluster-Pins auf der Community-Karte (F-580 … F-586, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 37). Setzt den Roadmap-Eintrag „Routen und Heatmap auf der
Community-Karte (mit Cluster-Pins)“ um. Ziel: Gäste sehen auf der Karte hinter der Startseite sofort „hier wird
gesegelt“ – ohne dass Namen, Zeiten oder Liegeplätze auf der Karte landen.

**Community-Karte** ist die Karte, die auf der Startseite (Konzept 12.6) und auf Hafen- und Vereinsseiten mit Ort
(F-351) als Hintergrund liegt. Eine eigene Karte in `/entdecken` gibt es nicht (weniger ist mehr).

## 37.1 Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“)

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | **Keine Migration.** Der Worker parst kein GPX (10 ms CPU, Konzept 19.5.1), und vereinfachte Geometrie gibt es bisher nicht (das Übersichtsbild ist ein JPEG). Deshalb rechnet der **Browser des Eigentümers** ein grobes Raster des Törns (`voyageCells`, `src/domain/heat.ts`: Zellen ≈ 330 m, je Zelle einmal, Reihenfolge des Wegs, ohne die ersten und letzten 300 m jedes Tracks, ohne Ausreißer, GPS-Lücken bis 2 km geradlinig ergänzt, ≤ 200 Zellen und ≤ 1,5° × 2,5° – lange Wege zählen mit ihrem ersten Abschnitt, keine Zeiten) und legt es mit `PUT /api/shares/:id/heat` als kleine R2-Datei `heat/<id>.json` neben den Track (≤ ~3 KB). Gesendet beim Speichern eines GPX-Törns, nach dem Nachreichen eines GPX (Konzept 38) und – für den Altbestand – wenn der Eigentümer einen eigenen öffentlichen GPX-Törn öffnet (einmal je Sitzung). **Missbrauch:** Das Raster ist eine Selbstangabe wie die Distanz (19.5.1). Der Worker nimmt nur wegähnliche Raster an (jede Zelle höchstens 3 Zellen neben einer früheren, höchstens 20 Neuanfänge, Ausdehnung begrenzt) – Schrift oder Bilder aus verstreuten Zellen fallen durch –, begrenzt das Schreiben auf 10 je Minute und Konto (`UPLOAD_LIMITER`, eigener Schlüssel), und beim Lesen zählt ein Konto höchstens mit 10 Törns. Die Notbremse (5.2) greift nicht: die Datei ist klein und ersetzt die vorige. Kein Zähler in D1: ob es die Datei gibt, sagt R2 beim Lesen. |
| Lesen | `GET /api/discover/heat`: die neuesten 100 GPX-Törns (höchstens 10 je Konto, Reihenfolge nach Abfahrt – serverseitig höchstens einen Tag in der Zukunft) mit `LISTED` (`worker/discover.ts`: `publicSql`, `notSuspendedSql`, „Sichtbar bis: überall“), je eine R2-Datei, geprüft mit `parseCells`, zusammengefasst mit `aggregateCells` (je Zelle die Zahl der Törns; ≤ 4.000 Zellen, meiste zuerst) und je Törn ein Pin auf der mittleren Zelle seines Wegs (nur ID und Zelle). Fehlende oder kaputte Dateien fallen weg (fail closed). |
| Querschnitte | Sichtbarkeit/Sperre: **beim Lesen** über `LISTED` – privat gestellt, ausgeblendet, „Sichtbar bis“ enger, Konto gesperrt → nicht mehr dabei, sobald der Cache abläuft. Cache: Antwort ohne jeden Betrachter-Bezug (kein Cookie gelesen), Cache API 14 min + Browser `public, max-age=60` – zusammen höchstens 15 min. Speicherzähler: die Datei zählt nicht (begrenzt auf 200 Zellen, wie Kopfdaten), Notbremse greift nicht. Stream, Ziele, Benachrichtigungen, Einbettungen, Zusammenführen: unberührt. Admin/Moderation: Ausblenden wirkt über `LISTED`, Löschen über den Törn-Löschweg. |
| Lösch- und Sichtbarkeitspfade | siehe 37.3 |
| Komponentenschnitt | Reine Regeln `src/domain/heat.ts` (Raster, Prüfung, Zusammenfassen, Zoom-Faktor `binFactor`/`rebin`, `heatOpacity`, `hotspot`). Worker `worker/heat.ts` (Schreiben, Lesen mit Cache), Schlüssel `heatKey` in `worker/photo-keys.ts` und `shareFileKeys`, Präfix im Lösch-Register. Karte `src/map/heat-layer.ts` (eigene Ebene unter den Tracks, Canvas, Cluster-Pins mit `gridCluster` aus `src/domain/cluster.ts`), angehängt an `MapView` wie die Foto-Ebene. Ablauf `src/controllers/heat.ts` (Laden einmal je Seitenleben, Schalter, Pins/Einpassen je Ansicht, Raster senden). Schalter als Eintrag „Revier“ im vorhandenen Kartenstil-Menü (`sx-map-style`, UX N1, kein neuer Knopf), Event `sx-map-heat` { on }. Farben: Token `--map-heat` (hell/dunkel in `tokens.css`), Pins in `--accent`. Mobil: nichts Neues im Seitenraster; Pins 44 px Tippfläche. |
| Parallele Arbeit | `feature/gpx-nachreichen` (Konzept 38) ändert `worker/shares.ts` und den Upload: Nach dem Nachreichen eines GPX (Konzept 38, `WorkspaceController.attach`) sendet der Browser das Raster direkt nach dem erfolgreichen Hochladen (`sendHeat`, wie nach dem Speichern) – unabhängig von der Sichtbarkeit; nach `main` gemergt 03.11.; der Lösch-Weg `shareFileKeys` gilt für beide. Sonst berührt kein offener Branch `src/map`, `sx-map-style` oder `worker/discover.ts` (geprüft mit `git diff main...<branch>`). |

## 37.2 Darstellung

| Was | Regel |
| --- | --- |
| Ebene „Revier“ | Rechtecke je Zelle in `--map-heat`, Deckkraft 0,2 … 0,7 logarithmisch nach der Zahl der Törns (eine einzelne Spur bleibt sichtbar, Häfen glühen nicht übermäßig). Je Zoomstufe zusammengefasst, bis eine Zelle mindestens 8 px breit ist (`binFactor`, `rebin`; Wert der groben Zelle = höchster Wert darin). Eigene Leaflet-Ebene unter den Tracks, nicht anklickbar. Einfarbig, damit sie in der Törn-Ansicht nicht mit dem Farbverlauf der Metrik verwechselt wird. |
| Wo | Startseite und Hafen-/Vereinsseite mit Ort: Ebene und Pins. Törn-Ansicht: nur die Ebene (Pins würden Hover und Klick auf den eigenen Track stören). |
| Schalter | „Revier“ im Kartenstil-Menü (aria-pressed), Standard an, gilt bis zum Neuladen – wie die Stil-Wahl ohne Profil (F-219, nichts lokal gespeichert). Die Farbe folgt dem Farbschema des Systems (`prefers-color-scheme`); einen eigenen Hell/Dunkel-Schalter hat die App nicht. Auf der Startseite ist das Menü ausgeblendet (Karte nur Hintergrund, 12.6); dort gilt die Wahl aus der Törn-Ansicht. Erst wenn die Ebene an ist und ein Backend da ist, wird geladen – einmal je Seitenleben. |
| Pins | Je Törn ein Pin auf der Mitte seines Wegs, zusammengefasst mit `gridCluster` (48-px-Raster) je Zoomstufe. Ein Törn: Link-Ziel `/s/<id>` („Törn ansehen“, Tastatur: Enter). Mehrere: Zahl, Klick passt die Karte auf die enthaltenen Törns ein. Keine Titel, keine Namen in der Antwort. |
| Startseite einpassen | Ohne geladene Tracks und ohne Ort passt die Startseite die Karte einmal je Seitenleben auf den dichtesten Bereich ein (hat die Karte noch keine Größe, beim ersten Größenwechsel – und nur, wenn die Ansicht es dann noch will, also z. B. kein GPX inzwischen geladen ist) (`hotspot`: Zelle mit den meisten Törns und alles bis ±0,25° Breite bzw. ±0,4° Länge darum, höchstens Zoom 12). |

## 37.3 Lösch- und Sichtbarkeitspfade

| Gespeichert | Entfernt auf welchem Weg |
| --- | --- |
| `heat/<id>.json` (R2) | mit dem Törn: einzeln löschen (`removeShare`), Konto löschen (`purgeUser`), Aufbewahrung abgelaufen (`retention.ts`) – alle über `shareFileKeys`; ersetzt beim erneuten Senden (gleicher Schlüssel). Gelöschter Törn während des Sendens: Datei sofort wieder weg (wie beim Übersichtsbild). |
| Antwort im Cache (Cloudflare 14 min, Browser 1 min) | läuft nach höchstens 15 min ab; bis dahin kann ein eben gelöschter oder privat gestellter Törn noch als Zelle bzw. Pin erscheinen (der Pin führt dann ins Leere: „Diese Freigabe gibt es nicht (mehr)“). |

| Wer sieht es wo | |
| --- | --- |
| Alle (Gäste wie Angemeldete, gleiche Antwort) | Zellen und Pins der öffentlichen Törns mit „Sichtbar bis: überall“ (ohne ausgeblendete, ohne gesperrte Konten), auf der Community-Karte und in der Törn-Ansicht |
| Eigentümer | sendet das Raster; „Nur mit Link“, „Nur ich“ und engere Reichweite erscheinen nie, die Datei liegt trotzdem (für einen späteren Wechsel auf „überall“) |

## 37.4 Bewusst nicht

- Kein Parsen im Worker, keine Spalte, kein Nachtlauf: die Grenzen (100 Törns, 10 je Konto, 200 Zellen, 15 min Cache) halten die
  Kosten je Abruf bei einer D1-Abfrage und höchstens 100 kleinen R2-Lesezugriffen alle 15 Minuten je Rechenzentrum.
- Keine Mindestzahl von Törns je Zelle: im Pilot wäre die Karte sonst leer, und jeder Törn darin ist ohnehin mit ganzem
  Track öffentlich. Die Wärmekarte zeigt weniger als die Törn-Seite (grob, ohne Anfang/Ende, ohne Zeit und Namen).
- Keine Ranglisten oder Zählungen je Person (K6).
