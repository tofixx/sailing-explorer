# 28. Große Gruppen: Publikums-Hinweis und Tageszusammenfassung (F-465 … F-469, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 28). Umsetzung von Phase 6 (Konzept 21.8) mit dem Inhalt aus 21.7.1
(B8, Platzhalter F-417). Leitlinie „weniger ist mehr, ein Weg nach Rom“: kein neuer Einstieg, keine neue Tabelle für
Inhalte, alles beim Lesen.

## 28.1 Schwellen (eine Stelle)

`GROUP_LIMITS` in `src/domain/limits.ts` (wie 21.7.1 verlangt), bestätigt nach 21.10: **Hinweis ab 100 Personen**,
**Tageszusammenfassung ab mehr als 150 Mitgliedern bzw. Booten oder mehr als 15 Einträgen an einem Tag**. Die Regeln
dazu stehen rein in `src/domain/large-groups.ts`.

## 28.2 Architektur-Skizze

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Keine neue Art von `posts`, keine neue Inhalts-Tabelle. Migration `0035_day_summary.sql` (additiv): `groups.day_summary INTEGER NOT NULL DEFAULT 1` (Eigner-Schalter) und Index `users(home_harbor_id)` für das Zählen im Hafen. |
| Publikum zählen | `GET /api/me/compose/audience?ctx=<art>:<id>` – nur für Verläufe, in die das Konto schreiben darf (`writableChannel`, sonst 404). Ein Batch mit je einer Zähl-Abfrage je Stufe der Kette (`ReachChain` aus `worker/post-chain.ts`): Mitglieder (ohne „Stumm“) und Follower (ohne „Stumm“) der Gruppen, Konten mit Heimathafen bzw. Boot dort und Follower des Hafens, Follower von Boot bzw. Profil, im Profil zusätzlich die Teams der Person (Teamkollegen sehen einander, `TARGET_SQL.teamMates`). Das ist genau, wem der Beitrag im persönlichen Stream erscheint. Antwort auf 10 gerundet, keine Namen; 5 min im Worker-Cache je Verlauf (Schlüssel nur Art und ID). |
| „Überall“ | Zählt wie die höchste Stufe der Kette – „Alles“ und „Umgebung“ liest man aktiv, dort geht nichts *an* jemanden. Sonst stünde der Hinweis bei jedem öffentlichen Beitrag (Vorschlag „überall“) und wäre bedeutungslos. **Abweichung** von 21.7.1 („alle in der Community“). |
| Hinweis | `sx-post-composer` zeigt unter „Sichtbar bis“ bei ≥ 100: „Geht an ca. N Personen – lieber in einer kleineren Gruppe schreiben?“ mit Knöpfen für die eigenen beschreibbaren Teams des gewählten Vereins und „Nur hier (ca. M)“ bzw. „Nur Mitglieder (ca. M)“ als Schnellwahl, wenn das kleiner ist. Senden bleibt möglich. Nur im Plus-Knopf-Dialog – der einzige Weg zum Schreiben (F-405). |
| Zusammenfassen | Beim Lesen im Worker (`worker/stream-days.ts`), Gruppen- und Hafen-Stream. Tage in Ortszeit Europe/Berlin; der laufende Tag bleibt einzeln. Ein älterer Tag wird zur **Tageskarte**, wenn der Verlauf groß ist (> 150 Mitglieder bzw. Boote, Gruppe nicht abgeschaltet) oder der Tag > 15 sichtbare Einträge hat – und mindestens zwei Einträge zusammenfallen. |
| Nie zusammengefasst | eigene Einträge (nur in ungecachten Antworten, siehe Cache), Einträge von Eigner/Admins der Gruppe bzw. der Vertretung/Anleger:in des Hafens, Umfragen und Veranstaltungen (Arten `poll`/`event`, ab Phase 4/5). Pins stehen ohnehin über dem Stream. |
| Tageskarte | „Sa, 14.6. – 6 Törns (212 sm), 18 Fotos, 3 Beiträge, 2 neue Mitglieder“ aus den **geprüften** Einträgen (Sichtbarkeit wie jeder Eintrag – Beitritte also nur für Mitglieder, F-443), die 3 meistbeachteten (Summe der Reaktionen, bei Gleichstand die neuesten) als Vorschau, „Alle anzeigen (N)“. |
| Cursor (Risiko 21.8) | Eine Seite endet bei älteren Tagen immer an einer **Tagesgrenze**: Cursor `<Tagesbeginn>_000000000000` schließt alles ab 0:00 dieses Tages aus. Endet die Kandidatenliste mitten in einem älteren Tag, wird der Tag mit einer zweiten Abfrage bis 0:00 vervollständigt – höchstens `DAY_SCAN` = 120 Kandidaten; darüber endet die Seite beim letzten geprüften, der Rest kommt als Fortsetzung (`continued`, immer Karte) und die Oberfläche legt sie mit der Karte desselben Tages zusammen (`appendDays`). Am laufenden Tag gilt der bisherige Cursor je Eintrag. So geht kein Eintrag verloren und keiner erscheint zweimal. Die Einzelnen eines Tages kommen vollständig mit, eine Seite kann länger als 20 werden. |
| Mitternacht und Cache | „Heute“ ist der Tag beim Berechnen. Holt jemand die nächste Seite erst nach Mitternacht, steht der Cursor mitten im nun älteren Tag; dessen Rest wird Fortsetzung (Karte), die schon einzeln gezeigten Einträge bleiben. Gecachte Seiten (60 s) können kurz nach Mitternacht noch den Vortag als „heute“ zeigen – unschädlich, die Grenzen stecken im Cursor. Die Zählungen für „groß“ laufen nur beim Berechnen, nicht bei Cache-Treffern. |
| Kosten | Je Seite eine Rangfolge-Abfrage (Reaktionen als Zahl für alle Zusammengefassten), volle Reaktionen nur für gezeigte Einträge (Einzelne, Vorschau). „Alle anzeigen“ nutzt dieselbe Prüfung wie jeder Stream (`resolve`) mit dem Filter „nicht einzeln“. |
| „Alle anzeigen“ | `GET …/stream?day=YYYY-MM-DD&cursor=` liefert die zusammengefassten Einträge dieses Tages einzeln (gleiche Prüfung, Kandidaten auf den Tag begrenzt, Cursor je Eintrag), ohne Karte. Die Karte klappt sie auf, „Weitere laden“ blättert. |
| Persönlicher Stream | **Noch nicht** („für diese Quelle“ aus 21.7.1): Er mischt viele Quellen, eine Karte je Quelle und Tag bräuchte Zustand über Seiten hinweg. Offener Punkt; die Gruppen- und Hafenseite tragen den Großteil. |
| Querschnitte | Sichtbarkeit: unverändert `shapeItem` je Eintrag (keine Kopie); Zählungen (Publikum, Mitglieder, Boote) ohne gesperrte Konten bzw. ausgeblendete/gesperrte Boote über `notSuspendedSql`/`liveSql` (`worker/visible-sql.ts`). Publikum: Zielfunktionen unverändert. Cache: Karten sind ohne Betrachter berechnet (gecachte Seiten sind für alle gleich; „eigene“ gibt es dort nicht – Mitglieder bekommen Gruppen-Streams ohnehin ungecacht, F-415); Cache-Schlüssel um `day` ergänzt. Zähler/Kontingente, Benachrichtigungen (`shouldNotify`, Glocke), Einbettungen, Moderation: nicht berührt. RSS (`worker/feed.ts`) bleibt einzeln. |
| Lösch- und Sichtbarkeitspfade | Keine neue Tabelle, kein neues `*_kind` (Lösch-Register `worker/cleanup-registry.ts` unverändert); nichts Neues gespeichert außer `groups.day_summary` (fällt mit der Gruppe) und dem 5-min-Cache der Zahlen (läuft ab). Tageskarten entstehen beim Lesen aus geprüften Einträgen – Gelöschtes, Ausgeblendetes und nicht mehr Sichtbares fällt wie bisher weg. |
| Komponenten | `sx-stream` bekommt `days` (Tageskarten, nach Zeit zwischen die Einträge gemischt; ohne automatische Einträge ohne deren Zähler, `withoutAuto`) und meldet `sx-day-open` { scope, day, cursor }; Gruppen- und Hafen-Controller hängen Seiten mit `appendDays` an und laden „Alle anzeigen“ mit `withDayPage` (`src/services/day-cards.ts`, aufgeklappter Zustand nur im Client-Typ `ShownDay`). `sx-post-composer` bekommt `audience` und `smaller`, meldet `sx-compose-pick`. Gruppen-Einstellung im Bearbeiten-Formular (nur Eigner, wie `post_by`). 375 px: Karte wie andere Karten, Zähler umbrechen, Knöpfe ≥ 44 px. |
| Parallele Arbeit | `feature/loesch-register` (gemergt): dessen Bausteine genutzt, keine eigenen. `feature/fahrtenbuch-jahre` – keine gemeinsamen Dateien außer Docs. |

## 28.3 Abweichungen von 21.7.1

- „Überall“ zählt die Personen der Kette, nicht die ganze Community (28.2).
- Der persönliche Stream fasst noch nicht zusammen.
- Häfen haben keinen Schalter (kein Eigner); nur Gruppen sind abschaltbar.
- Endpunkt unter `/api/me/compose/audience` (neben `/api/me/compose`) statt `/api/compose/audience`.
