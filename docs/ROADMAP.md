# Roadmap

Einzige Quelle für „was kommt als Nächstes“. Stand 03.11.2026, Code-Stand `main` (704ec12).
Inhalte stehen in den verlinkten Abschnitten. Hier stehen nur Reihenfolge, Nutzen, Aufwand und Abhängigkeiten.
Erledigtes fällt heraus.

**Leitlinie des Betreibers:** „Weniger ist mehr, ein Weg nach Rom“. **Priorisiert** wird nach dem Nutzen für die
Gewinnung und Bindung von Seglerinnen, Seglern und Vereinen, dann nach Risiko und Aufwand. Zuerst kommt, was Vereine in
die App holt und Segler zum Wiederkommen bringt, und zwar mit kleinem Risiko. Große Migrationen folgen erst, wenn es
Nutzer gibt, die sie brauchen. Reine Technik-Arbeit steht nur dort, wo sie das nächste Feature billiger oder sicherer
macht.

Aufwand: S ≈ bis 1 Tag, M ≈ 2–4 Tage, L ≈ 1–2 Wochen. Quellen: K = [CONCEPT.md](CONCEPT.md),
R = [ARCHITECTURE-RETRO.md](ARCHITECTURE-RETRO.md#d-empfehlungen-priorisiert-nach-nutzenaufwand) (d),
U = [UX-NAVIGATION.md](UX-NAVIGATION.md), N = Notion (Betreiber).

## Jetzt (nach dem laufenden Deploy)

Das sind kleine Aufräumarbeiten ohne Konzeptänderung. Sie lassen sich nebenbei erledigen.

| Eintrag | Nutzen | Aufwand | Quelle | Abhängigkeiten |
|---|---|---|---|---|
| Doppelten Abruf `/api/discover?limit=6` beseitigen | Für Gäste fragen `loadDiscoverStrip` (`app.ts`) und `GuestSliderController` dasselbe ab. Ein Abruf weniger heißt: schnellere Startseite und weniger Last auf dem Worker | S | N (Todo) | – |
| Zahnrad am Kartenstil umstellen | `sx-map-style` trägt noch das Zahnrad. Nach N6 gehört es nur dem Seiten-Menü. `sx-page-menu` hat das nicht erledigt; das Titelbild ist dagegen richtig gelöst (direkt am Bild, K 21.13) | S | N (zurückgestellt), [U N6](UX-NAVIGATION.md#7-navigations--und-kopfbereich-regeln-vorschlag) | – |
| Menüwege der empfohlenen Apps in echten Apps prüfen | Die Anleitung soll stimmen. Belegt sind die Menüpfade bisher nur teilweise | S | N (Todo), K 25.2 | Geräte bzw. Apps |
| B&G/Simrad/Lowrance-GPX klären | Klären, ob diese Plotter GPX mit Zeitstempeln exportieren. Danach eine konkrete statt einer allgemeinen Anleitung | S | N (Todo), K 25.2 | Handbuch oder Testdatei |

## Als Nächstes

Die Reihenfolge ist die Empfehlung. Die ersten fünf zahlen am stärksten auf die Gewinnung von Vereinen und Seglern
ein.

| # | Eintrag | Nutzen | Aufwand | Quelle | Abhängigkeiten |
|---|---|---|---|---|---|
| 1 | **2–3 Potsdamer Vereine gewinnen** (Pilot) | Ohne Vereine ist der Stream leer. Jeder Verein bringt Mitglieder mit, und Rückmeldungen aus dem Pilot steuern die Phasen 4–9 | S (Betreiber) | N (Lücken) | Name/Domain-Entscheidung hilft; Veranstaltungen (#4) als Argument |
| 2 | **Saisonrückblick mit Teilen-Bild und Abzeichen-Reihe** | Am Saisonende (jetzt) teilt jede:r gern ein „Meine Saison“-Bild. Das bringt Reichweite ohne Werbung. Die Abzeichen aus den Meilensteinen (`MILESTONES_NM`) belohnen das Wiederkommen | M | N (Quick Wins) | `share-image.ts`, Saison-Summen, K6 (keine Ranglisten) |
| 3 | **Lösch-Register und Sichtbarkeits-Bausteine** | Das Register macht Prüfpunkt 6 maschinell, bevor neue Arten (Umfrage, Veranstaltung, Galerie) neue polymorphe Bezüge bringen. Es gibt noch 64 Kopien von `visibility = 'public'` und 104 von `hidden_at IS NULL` | M | R 1, R 3 | vor #4/#5. `reach-sql.ts` und `member-sql.ts` sind schon so gebaut |
| 4 | **Veranstaltungen** (Phase 5) | Das stärkste Vereinsargument: Termine, Zusagen, Erinnerung und `.ics`. Danach „Ins Fahrtenbuch übernehmen“ | M | [K 21.5](CONCEPT.md#215-umfragen-und-veranstaltungen), [K 21.8](CONCEPT.md#218-phasenplan) | #3. Atomare Kapazität (R 10). Mail-Budget 100/Tag |
| 5 | **Umfragen** (Phase 4) | Geringes Risiko, nützt Vereinen und Teams im Alltag („Wer segelt Mittwoch?“) | M | [K 21.5](CONCEPT.md#215-umfragen-und-veranstaltungen), K 21.8 | #3. Stufe „wichtig“ ist vorbereitet (K 24.7) |
| 6 | **.ADM direkt importieren** | Garmin-Plotter-Nutzer sparen den Umweg über BaseCamp/HomePort. Das senkt die Einstiegshürde für Eigner größerer Boote | M | N (Todo), [K 25.1](CONCEPT.md#251-umsetzung) | Format-Analyse mit echten Dateien. Nur ACTIVE LOG mit Zeit |
| 7 | **`ENTITY_ICON` und Byline mit Boot** | Ein Icon je Objektart (Team ≠ Boot, Verein ≠ Hafen). Die Törn-Byline nennt das Boot. Das sorgt für Wiedererkennung ohne neue Einstiege | S | U B12, B13, [U N4](UX-NAVIGATION.md#7-navigations--und-kopfbereich-regeln-vorschlag) | – |
| 8 | **Filter nach Bootsklasse in Entdecken** | Man findet Gleichgesinnte (Jollen, Folkeboot, Fahrtenyachten) | S–M | N (Quick Wins) | `boats.boat_type` ist Freitext: Klassenliste bzw. Normalisierung nötig |

## Danach

| Eintrag | Nutzen | Aufwand | Quelle | Abhängigkeiten |
|---|---|---|---|---|
| **Verwaltungsbereich und Fahrtenbuch nach Jahren** (Phase 8) | Das Fahrtenbuch als Meilennachweis bringt Bindung über Jahre. Der Konto-Dialog (1098 Zeilen) hört auf zu wachsen | M–L | [K 21.6](CONCEPT.md#216-fahrtenbuch-jahre-zusatzangaben-wertung-jahresbericht), K 21.8, R 9 | Crew-Ausnahme M1. Konto-Dialog ohne Funktionsverlust ablösen |
| **Export / Segellebenslauf** | Eigene Daten mitnehmen (CSV, druckbar). Schafft Vertrauen und ist ein Argument gegen Lock-in | S–M | N (Lücken) | Phase 8 (gleiche Liste wie der Jahresbericht) |
| **Routen und Heatmap auf der Community-Karte** (mit Cluster-Pins) | Das Revier wird sichtbar: „Hier wird gesegelt“. Starker Eindruck für Gäste | M | N (Quick Wins) | Nur Törns mit „Sichtbar bis: überall“ (`LISTED`). Cluster wie `src/domain/cluster.ts` |
| **`sx-page-header`, `sx-entity-link`/`sx-avatar`, `sx-tabs`** | Ein Seitenkopf und klickbare Nennungen überall (N3, N5, N8). Weniger Sonderwege je Seite | M | [U 6](UX-NAVIGATION.md#6-optimierungsvorschläge-priorisiert-schnelle-gewinne-zuerst) 10–12, U B6, B7, B18 | #7 aus „Als Nächstes“ |
| **`sx-invite-box`** und „Freunde einladen“ auf der eigenen Seite | Ein Einladungsmuster statt vier. Einladen geht nach „Später“ nicht mehr verloren | S–M | U 6 Nr. 13, U B14, B15 | – |
| **Web-URL für Vereine und Häfen** – gebaut auf `feature/web-url` (F-540 … F-543), wartet auf Review | Verlinkung zur Vereinsseite. Für Vereine ein kleiner, sichtbarer Gewinn | S | N (zurückgestellt) | Migration (reservieren). Link-Prüfung wie Beiträge |
| **GPX zu gespeicherten Törns** | Vergessene Tracks lassen sich nachreichen, ohne den Törn neu anzulegen | M–L | N (Todo), [K 23.3](CONCEPT.md#233-offen) | Plausibilität, Speicherzähler, Wetter, Fotos, Vorschaubild |
| **Große Gruppen** (Phase 6) | Hinweis vor dem Posten und Tageszusammenfassung. Erst nötig, wenn Verläufe über 100 Personen wachsen | M | K 21.7.1, K 21.8 | Erst mit echten großen Vereinen. Schwellen bestätigen |
| **Galerie-Beiträge** (Phase 7) | Fotos ohne Törn (Vereinsfest, Arbeitsdienst) | L | K 21.3.4, K 21.8 | Größtes Migrationsrisiko (Neubau `photos`). #3. Neubau als eigener Schritt |
| **Auffindbarkeit ohne App-Store** – Sitemap, `robots.txt`, `canonical` gebaut auf `feature/web-url` (F-544 … F-546), wartet auf Review | Gefunden werden über Suchmaschinen und Links (Vereins-/Hafenseiten, Link-Vorschau, Installieren-Hinweis) statt über einen Store | S–M | N (Lücken) | Manifest, `sx-install-hint` und OG-Vorschau gibt es. Fehlend: SEO-Prüfung, Sitemap öffentlicher Seiten |

## Später

| Eintrag | Nutzen | Aufwand | Quelle | Abhängigkeiten |
|---|---|---|---|---|
| **Wertung und Jahresbericht** (Phase 9) – gebaut auf `feature/wertung` (Konzept 32), wartet auf Review | Vereins-Fahrtenpreise ohne Excel | L | [K 32](concept/32-wertung.md), K 21.6, K 21.8 | Gewichtung entschieden: Faktor je Vorlage, keine Normierung nach Mitgliederzahl (K 32.7) |
| **Vereins- und Hafen-Challenges mit Opt-in-Rangliste** | Bindung über Wettbewerb zwischen Vereinen | M | N (Quick Wins) | Phase 9 (Opt-in-Muster). Widerspricht K6 („keine Ranglisten“), daher Entscheidung nötig |
| **Segelschulen und Vereinsjugend mit Trainer-Rolle** | Eine neue Zielgruppe mit vielen Seglerinnen und Seglern | M–L | N (Quick Wins) | Rollenmodell (K 15, 12.12). Datenschutz Minderjährige |
| **Aufzeichnen unterwegs** (PWA, später nativ) | Schließt die größte Lücke zur Konkurrenz: Man braucht keine zweite App mehr | L | N (Lücken) | Hintergrund-Ortung in PWAs (vor allem iOS) begrenzt, deshalb vorher ein Machbarkeitstest |
| **Live-Standort teilen** | Sicherheit und Gemeinschaft auf dem Wasser | L | N (Lücken) | Aufzeichnen unterwegs. Datenschutz, Kosten (WebSocket/Durable Object) |
| Tests nach Bereichen schneiden, `shared.ts` aufteilen | Weniger Merge-Konflikte (`app.test.ts` hat 1853 Zeilen, `shared.ts` 606) | S | R 7, R 8 | Nebenbei, sobald die Dateien ohnehin angefasst werden |

## Bewusst nicht

| Thema | Warum |
|---|---|
| Navigation, Seekarten | Dafür gibt es Plotter und Navigations-Apps. Sail Explorer wertet aus und verbindet |
| Regatta-Organisation | Höchstens eine Schnittstelle (Ergebnisse übernehmen), kein eigenes Meldesystem |
| Vereinsverwaltung | Beiträge, Mitgliedsdaten und Buchhaltung bleiben in den Vereinssystemen |
| Hochsee, Charter | Der Fokus liegt auf Binnen- und Küstenrevieren mit Vereinen und Häfen (K 22.1) |
| Instrumente (NMEA live) | Hardware-Vielfalt und Support-Aufwand, kein Nutzen für die Gewinnung |

## Offene Entscheidungen

| Frage | Optionen / Empfehlung |
|---|---|
| **Neuer Name** | **Entschieden 03.11.: „Luv & Leute“** (Betreiber). Umstellung in der App: `feature/name-luv-leute`. Marke (DPMA/EUIPO) und Domain prüft der Betreiber; `segeln-potsdam.de` bleibt bis dahin |
| **`feature/supporter-badges`** (7 Commits, Stand 27.10.) | **Entschieden 03.11.: verworfen** (Stand gesichert als Tag `archiv/supporter-badges`). Begründung: und brauchbare Ideen neu aufsetzen. Die Migration `0015_paid_support.sql` kollidiert mit `0015_approvers.sql`. Gutschein (K 18.9a) und freie Eigner (K 13.5) sind inzwischen anders gelöst |
| **`feature/moderation-konzept`** (nur `docs/MODERATION.md`) | **Entschieden 03.11.: abgleichen** auf `docs/moderation-abgleich` (Konzept 35). Vorgehen: Offene Teile (Textfilter, Vertrauensstufen, Bildprüfung) mit dem Admin-Bereich (K 18) abgleichen. Was noch fehlt, wird ein Konzept-Abschnitt mit Reservierung, der Branch wird danach gelöscht |
| **Testkonto für Abläufe mit Anmeldung in der Vorschau** | **Entschieden 03.11.: nein**, siehe Abwägung unten |
| **Challenges vs. K6** | **Entschieden 03.11.: bei K6 bleiben** (keine Ranglisten zwischen Personen). Vereinswertung (Phase 9) zeigt die Liste nur Eignern/Admins; Challenges höchstens als persönliche Ziele bzw. Vereinssummen ohne Personen-Rangfolge. Der Eintrag unter „Später“ bleibt zurückgestellt |
| Schwellen und Kontingente | Galerie umgesetzt mit 10/200 Fotos je Monat, 30 je Beitrag, kostenlos 25 MB (K 31). Tageszusammenfassung 150/15 und Hinweis 100 umgesetzt in `GROUP_LIMITS` (K 28) – nach dem Pilot mit echten Vereinen prüfen |
| **Ablauffrist für Galerie-Beiträge** | K 21.3.3 schlug „wie Fotos am Törn“ vor; umgesetzt ist vorerst keine Frist (wie Text-Beiträge), weil ein Ablauf Warn-Mails wie bei Törns bräuchte. **Entschieden 03.11.: vorerst keine Frist**; neu bewerten, wenn der Speicher der Galerien messbar wächst (K 31.4) |

**Abwägung Testkonto in der Vorschau.** Die Vorschau `dev-<branch>` ist öffentlich und hat keine Secrets, und die
Anmeldung ist dort bewusst gesperrt. Ein Testkonto bräuchte dort einen Anmeldeweg ohne Mail und ohne Passkey. Weil die
Vorschau öffentlich ist, könnte jede:r diesen Weg nutzen, Inhalte anlegen und Uploads auslösen. Zudem stünde derselbe
Code im Produktions-Bundle, und ein falsch gesetzter Schalter würde ihn live öffnen. Ein Schutz per Cloudflare Access
oder geheimem Token bräuchte wieder Secrets in der Vorschau. **Empfehlung:** Die Vorschau bleibt ohne Anmeldung.
Angemeldete Abläufe werden lokal geprüft (`npm run dev` mit lokaler D1, Mail-Anbieter `log`, Code aus dem Log) und in
den Funktionstests (`worker-harness.ts`, `login()`). Wird das zu eng, dann nur über Cloudflare Access vor
`dev-*.segeln-potsdam.de` und mit einem Seed-Konto je Vorschau-Datenbank, niemals über einen Schalter im Worker.

## Prozess

| Punkt | Stand |
|---|---|
| **Nummern vor dem Start reservieren** | Regel in `CLAUDE.md` („Vor dem ersten Code“). Die Reservierungen stehen unten |
| **Entwicklungszeit** (Analyse in [Retro (e)](ARCHITECTURE-RETRO.md#e-entwicklungszeit-stand-02112026)) | Umgesetzt in `CLAUDE.md`: Selbstprüfung „Vor Abgabe“, Review ab dem ersten vollständigen Commit, ein Feature je Deploy, nachgereichte Wünsche in die Roadmap, Test-Strategie (lokal gezielt, ein Vollauf, danach ist die Pipeline das Gate) |
| **Docs konfliktarm** | Neue Konzept-Abschnitte stehen in `docs/concept/NN-name.md`, in `CONCEPT.md` nur ein Verweis. F-IDs kommen als Block aus der Reservierung. Offen: `app.test.ts` und `shared.ts` aufteilen (siehe „Später“) |
| **Worktrees** | `scripts/new-worktree.ps1` (Upstream kappen, Junction oder `npm ci`, freier Port) und `scripts/remove-worktree.ps1` (Junction lösen, dann `git worktree remove`). `vite.config.ts` gibt den echten Pfad von `node_modules` frei (`server.fs.allow`) |
| **Workers-Laufzeit startet unter Last nicht** (`ERR_RUNTIME_FAILURE`) | `worker-harness.ts` wiederholt genau diesen Startfehler bis zu zweimal, Testfehler bleiben unberührt. Beobachten: Tritt er trotzdem auf, `poolOptions.forks.maxForks` begrenzen. Das kostet Laufzeit, der volle Lauf dauert lokal heute 220–360 s |
| **Mobil-Prüfung 375 px** | Verbindlich in Prüfpunkt 8 und Auslieferung Schritt 3, Skript `scripts/mobile-overflow.js`. Gewollte seitliche Scroll-Bereiche tragen `data-scroll-x`: Diagramm-Großansicht (`sx-time-chart`), Gäste-Slider, Entdecken-Leiste und Reiter, Filter und Modi der Startseite, Fotostreifen, Vorschaubilder im Stream, Konto-Reiter |
| Migrationen nur additiv in Feature-Branches | Neubauten (`photos`, Phase 7) als eigener Schritt (R 4) |
| Atomare Grenzen als Muster | `INSERT … SELECT … WHERE COUNT < n`, `meta.changes` prüfen (R 10), Pflicht ab Phase 5 |

### Reservierungen

Vergeben bis einschließlich **F-450**, **Konzept 26**, **Migration 0033**, reserviert bis **F-549**, **Konzept 35**, **Migration 0043** (Stand 9316c24, 0033 = `follows_cleanup`). Die nächsten freien Nummern
sind F-550, Konzept 36 und Migration 0044. Neue Aufträge bekommen ihren Bereich hier, bevor
sie starten. „Berührt“ füllt der bauende Agent zu Beginn aus seiner Skizze (Querschnitte, geteilte Dateien).

| Branch / Auftrag | F-IDs | Konzept | Migration | Berührt | Stand |
|---|---|---|---|---|---|
| `docs/roadmap` (diese Roadmap, Prozess-Fixes) | – | – | – | `CLAUDE.md`, `vite.config.ts`, `worker-harness.ts`, `data-scroll-x` in 8 Komponenten | lokal committet |
| `feature/mitglieder-sichtbarkeit` (Mitgliedschaften, Folgen, Glocke) | F-440 … F-449 | 24 | 0032, **0033** (`follows_cleanup`, Altbestand der Vorschau) | Streams, Benachrichtigungen, Gruppen, Profil, Konto | gemergt |
| `feature/loesch-register` (Lösch-Register, Sichtbarkeits-Bausteine, R 1/R 3) – Welle 1 | F-451 … F-454 | – | – | neu `worker/cleanup-registry.ts`, `worker/visible-sql.ts`; SQL-Literale (Sichtbarkeit/Sperre) in `discover.ts`, `gallery.ts`, `harbors.ts`, `boats.ts`, `posts.ts`, `shares.ts`, `follows.ts`, `share-context.ts`, `share-groups.ts`, `post-chain.ts`, `invites.ts`, `reactions.ts`, `groups.ts` (nur Lese-SQL); Löschbatch Törn `shares.ts`/`retention.ts`. Nicht: `stream*.ts`, `activity.ts`, `notifications.ts`, `group-digest.ts`, `profiles.ts`, `logbook.ts` | gemergt 03.11. |
| `feature/fahrtenbuch-jahre` (Phase 8: Verwaltungsbereich, Fahrtenbuch nach Jahren, F-411/F-412/F-418) – Welle 1 | F-455 … F-464 | 27 | 0034 (nicht gebraucht) | `shares.log` (Schema `parseLog`), neue `GET /api/me/logbook[.csv]` (`worker/logbook-list.ts`, Crew-Bedingung in `logbook-sql.ts`), `sx-logbook-form`/`-panel`, `sx-my-posts` (Reiter „Fahrtenbuch“ entfällt), `sx-account-menu`, `url-state.ts`, `app.ts`, `app.css` (Druck), `legal.ts`; keine Streams, Caches, Zähler, Löschwege | gemergt 03.11. (0034 frei geblieben) |
| `feature/grosse-gruppen` (Phase 6: Publikums-Hinweis, Tageszusammenfassung, F-417) – Welle 1 | F-465 … F-469 | 28 | 0035 | Streams beim Lesen (`worker/stream.ts`, neu `worker/stream-days.ts`), Gruppen- und Hafen-Stream samt 60-s-Cache, `GROUP_LIMITS` (`src/domain/limits.ts`), `groups.day_summary` (Gruppen-Einstellung, `worker/groups.ts`, `sx-group-page`), Plus-Knopf-Dialog (`sx-compose-dialog`, `sx-post-composer`, `worker/post-chain.ts`, `/api/me/compose/audience`), `sx-stream` (Tageskarte), Controller Gruppe/Hafen | gemergt 03.11. |
| `feature/umfragen` (Phase 4, F-407) – Welle 2 nach dem Register | F-470 … F-479 | 29 | 0036 | Art `poll` in `posts`, neu `poll_votes`; Erweiterungspunkte je Art (eine Zeile je Art, Liste in Konzept 29.1): `COMPOSE_LIMITS`/`POST_KIND_LABEL` in `src/domain/posts.ts`, `COMPOSE_KINDS` (`data`, `view`) in neu `worker/post-kinds.ts`, `attachKindData` in `worker/stream.ts`, `KINDS` in `sx-compose.ts`, `KIND_FORMS` in `sx-compose-dialog.ts`, `kindPayload` in `sx-stream.ts`, `POST_KIND_ICON` in `shared.ts`; dazu `sx-post-composer.ts` (`plain`, `max`, Slot), `controllers/compose.ts`, `worker/posts.ts`, `stream-shape.ts` (`kindView`), `notifications.ts` (`poll_closed`), `reactions.ts` (`assertQuota` geteilt), `retention.ts`, `admin-merge.ts`, `cleanup-registry.ts`, `group-routes.ts`, `app.ts` (3 Events), `legal.ts` | gemergt 03.11. |
| `feature/veranstaltungen` (Phase 5, F-408/F-410) – Welle 2 nach dem Register | F-480 … F-489 | 30 | 0037 | Art `event` in `posts`, neu `post_events`, `event_rsvps`; an den Erweiterungspunkten der Umfragen je eine Zeile (`COMPOSE_LIMITS`, `POST_KIND_LABEL`, `COMPOSE_KINDS` + `body`/`rows`, `attachKindData`, `KINDS`, `KIND_FORMS`, `kindPayload`, `POST_KIND_ICON`); `worker/posts.ts` (Zeilen der Art im Batch), `notifications.ts`/`src/domain/notifications.ts` (Arten `event`, `rsvp`, gemeinsamer Helfer `postWhere`), `retention.ts` (Nachtlauf), `admin-merge.ts`, `cleanup-registry.ts`, `group-routes.ts`, `app.ts`, `index.html`, `main.ts`, `services/api.ts`, `sx-logbook-form.ts` (`preset`), `controllers/logbook.ts`, `src/domain/logbook.ts` (`eventId`), `legal.ts`, `icons.ts` (`calendar`), `sx-notifications.ts`; nebenbei `sx-page-media.ts` (leeres Titelbild ragte bei 375 px heraus) | gemergt 03.11. |
| `feature/galerie` (Phase 7, Neubau `photos`) – Welle 2 nach dem Register | F-490 … F-499 | 31 | 0038 (`photos_rebuild`, nur Neubau), 0039 (`gallery`) | Neubau `photos`, `photo_log`; Art `gallery` an den Erweiterungspunkten der Beitragsarten (`COMPOSE_LIMITS`, `POST_KIND_LABEL`, `COMPOSE_KINDS`, `KINDS`, `KIND_FORMS`, `kindPayload`, `POST_KIND_ICON`) – je eine Zeile; `ROW_COLS_JOINS` (`p_photos`), `shapePost` (`own`), neu `sx-gallery-picker`, `sx-gallery-post`, `post-photos.ts`; `posts.ts` (`readPostInput`, Galerie-Kontingent, `visiblePost`, `removePost`), `photos.ts`, `photo-keys.ts`, Löschwege `groups.ts`, `boats.ts`, `harbors.ts`, `auth.ts`, `admin-merge.ts`, `retention.ts`, `reports.ts`, `notifications.ts`, `index.ts`, `limits.ts`, `cleanup-registry.ts`, `legal.ts` | gemergt 03.11. |
| `feature/wertung` (Phase 9, F-413/F-414) – Welle 3 nach Phase 8 | F-500 … F-509 | 32 | 0040 | neu `scoring_templates`, `group_members.scoring_opt_in_at` (Lösch-Register), `shares.log.templateId` (`parseLog`), neu `src/domain/scoring.ts`, `worker/scoring.ts`, `worker/scoring-sql.ts`, `src/services/scoring-api.ts`, Seite `/konto/wertung` (`sx-scoring-page`, `sx-scoring-editor`, `controllers/scoring-page.ts`); geändert `logbook-list.ts` (CSV mit Punkten), `logbook-year.ts`, `worker/logbook.ts` (Vorlage prüfen), `sx-logbook-form` (Vorlage), `sx-logbook-page` (Punkte, Link „Wertung“), `url-state.ts`, `app.ts`, `index.html`, `worker/index.ts` (eine Zeile), `legal.ts`. Nicht: Streams, `sx-compose`, Gruppenseite, `groups.ts`, Fotos | gemergt 03.11. |
| `feature/toern-ruhiger` (Törn-Seitenleiste: weniger sichtbare Schaltflächen, Crew/Einladen/Kommentare) | F-510 … F-514 | – | – | `sx-crew`, `sx-comments`, Törn-Seitenleiste, `sx-page-menu` | gemergt 03.11. |
| `feature/name-luv-leute` (Markenname „Luv & Leute“ überall in der App) | F-515 … F-519 | – | – | sichtbare Texte, `index.html`, `manifest.webmanifest`, Mails, Teilen-Bild, `legal.ts`, `invite-text.ts`, Doku-Kopfzeilen | in Arbeit 03.11. |
| `feature/saisonrueckblick` (Als Nächstes #2: „Meine Saison“-Bild, Abzeichen-Reihe) | F-520 … F-529 | 33 | 0041 (falls nötig) | `share-image.ts`, Saison-Summen (`logbook-year.ts`), `MILESTONES_NM`, Fahrtenbuch-Seite | in Arbeit 03.11. |
| `feature/kleinkram-navigation` (Jetzt: doppelter Discover-Abruf, Zahnrad am Kartenstil; Als Nächstes #7: `ENTITY_ICON`, Byline mit Boot) | F-530 … F-534 | – | – | `app.ts` (`loadDiscoverStrip`), `GuestSliderController`, `sx-map-style`, `sx-voyage-byline`, `icons.ts`/`shared.ts` (`ENTITY_ICON`) | in Arbeit 03.11. |
| `feature/bootsklasse` (Als Nächstes #8: Filter nach Bootsklasse in Entdecken) | F-535 … F-539 | 34 | 0042 | `boats.boat_type`/Klassenliste (`src/domain`), `worker/discover.ts`, Entdecken-Leiste | in Arbeit 03.11. |
| `feature/web-url` (Web-URL für Vereine und Häfen) und Auffindbarkeit (Sitemap öffentlicher Seiten, SEO-Prüfung) | F-540 … F-549 (vergeben bis F-546) | – (Skizze in REQUIREMENTS) | 0043 (`web_url`) | `groups.web_url`, `harbors.web_url`; `worker/groups.ts` (`applyInput`, INSERT/UPDATE, `groupShape`), `worker/harbors.ts` (`readWebUrl`, `updateHarbor`, `harborShape`), `admin.ts` (`adminRename`, `extra`), `admin-merge.ts` (`mergeHarbor`), `discover.ts` (`LISTED` exportiert), neu `worker/sitemap.ts`, `worker/index.ts` (Routen `/robots.txt`, `/sitemap.xml`, `route()`, noindex außerhalb der Hauptdomain, `canonical`/`og:url`), `src/domain/groups.ts` (`parseWebUrl`, `webUrlLabel`), `shared.ts` (`webLink`), `sx-group-page`, `sx-profile-page` (Hafen), `sx-admin-page`, `services/api.ts`, `legal.ts` | gebaut 03.11., wartet auf Review |
| `docs/moderation-abgleich` (Moderations-Konzept gegen K 18 abgleichen) | – | 35 | – | nur `docs/` | in Arbeit 03.11. |
