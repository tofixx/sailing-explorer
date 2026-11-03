# Roadmap

Einzige Quelle für „was kommt als Nächstes“. Stand 03.11.2026 abends, Code-Stand `main` (9654bc5).
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
| Menüwege der empfohlenen Apps in echten Apps prüfen | Die Anleitung soll stimmen. Belegt sind die Menüpfade bisher nur teilweise | S | N (Todo), K 25.2 | Geräte bzw. Apps |
| B&G/Simrad/Lowrance-GPX klären | Klären, ob diese Plotter GPX mit Zeitstempeln exportieren. Danach eine konkrete statt einer allgemeinen Anleitung | S | N (Todo), K 25.2 | Handbuch oder Testdatei |

## Als Nächstes

Die Reihenfolge ist die Empfehlung. Die ersten fünf zahlen am stärksten auf die Gewinnung von Vereinen und Seglern
ein.

| # | Eintrag | Nutzen | Aufwand | Quelle | Abhängigkeiten |
|---|---|---|---|---|---|
| 1 | **2–3 Potsdamer Vereine gewinnen** (Pilot) | Ohne Vereine ist der Stream leer. Jeder Verein bringt Mitglieder mit, und Rückmeldungen aus dem Pilot steuern die Phasen 4–9 | S (Betreiber) | N (Lücken) | Name/Domain-Entscheidung hilft; Veranstaltungen (#4) als Argument |
| 6 | **.ADM direkt importieren** | Garmin-Plotter-Nutzer sparen den Umweg über BaseCamp/HomePort. Das senkt die Einstiegshürde für Eigner größerer Boote | M | N (Todo), [K 25.1](CONCEPT.md#251-umsetzung) | Format-Analyse mit echten Dateien. Nur ACTIVE LOG mit Zeit |

## Danach

| Eintrag | Nutzen | Aufwand | Quelle | Abhängigkeiten |
|---|---|---|---|---|
| **Export / Segellebenslauf** (Rest) | CSV und Druck des Fahrtenbuchs gibt es (Phase 8, F-457/F-458); offen: alle Saisons in einer Datei bzw. ein „Segellebenslauf“ über alle Jahre. Eigene Daten mitnehmen. Schafft Vertrauen und ist ein Argument gegen Lock-in | S–M | N (Lücken) | Phase 8 (gleiche Liste wie der Jahresbericht) |
| **Routen und Heatmap auf der Community-Karte** (mit Cluster-Pins) | Das Revier wird sichtbar: „Hier wird gesegelt“. Starker Eindruck für Gäste | M | N (Quick Wins) | Nur Törns mit „Sichtbar bis: überall“ (`LISTED`). Cluster wie `src/domain/cluster.ts` |
| **`sx-page-header`, `sx-entity-link`/`sx-avatar`, `sx-tabs`** | Ein Seitenkopf und klickbare Nennungen überall (N3, N5, N8). Weniger Sonderwege je Seite | M | [U 6](UX-NAVIGATION.md#6-optimierungsvorschläge-priorisiert-schnelle-gewinne-zuerst) 10–12, U B6, B7, B18 | #7 aus „Als Nächstes“ |
| **`sx-invite-box`** und „Freunde einladen“ auf der eigenen Seite | Ein Einladungsmuster statt vier. Einladen geht nach „Später“ nicht mehr verloren | S–M | U 6 Nr. 13, U B14, B15 | – |
| **GPX zu gespeicherten Törns** | Vergessene Tracks lassen sich nachreichen, ohne den Törn neu anzulegen | M–L | N (Todo), [K 23.3](CONCEPT.md#233-offen) | Plausibilität, Speicherzähler, Wetter, Fotos, Vorschaubild |

## Später

| Eintrag | Nutzen | Aufwand | Quelle | Abhängigkeiten |
|---|---|---|---|---|
| **Moderation 1: Titelbilder absichern** (Tageslimit, Titelbild neuer Konten bis zur Freigabe zurückhalten, Entfernen nur des Bildes) | Größte Moderationslücke: Jedes Wegwerfkonto setzt sofort ein öffentliches Banner. Erster Punkt der Gruppe, sobald Moderation drankommt | S–M | [K 35](concept/35-moderation.md) 35.1/35.3 | `worker/covers.ts`, Admin-Liste |
| **Moderation 2: CSAM-Scanning-Tool einschalten** (Cloudflare-Dashboard, Cache-Weg prüfen) | Schutz vor dem schwersten Fall, kostenlos, ohne Code | S (Betreiber) | K 35 | Mailadresse, Ablauf bei Treffer festlegen |
| **Moderation 3: Admin-Hinweis auf offene Meldungen** (Sammelmail im Nachtlauf, Zähler am Konto-Knopf) | Meldungen liegen heute, bis jemand nachsieht | S | K 35, F-294 | Mechanismus der Sperr-Erinnerung |
| **Moderation 4: Melde-Gewicht und Gründe** (neue Konten zählen 0, „abgebildet“ nur bei Bildern, Grund „Kinder abgebildet“) | Drei frische Konten blenden heute alles aus | S–M | K 35, F-114 | `isNewAccount` (Konto < 7 Tage, kein Unterstützer) |
| **Moderation 5: Textfilter** (Wortliste in D1, Normalisierung, Stufe A blocken, Stufe B zurückhalten) | Hass und Beleidigungen kommen gar nicht erst öffentlich an | M | K 35 | Wortliste vom Betreiber; ein Aufruf je Schreibweg |
| **Moderation 6: Begründungsmail bei Meldungs-Entscheidungen** (DSA Art. 17) | Bisher nur beim Sperren (F-296) | S–M | K 35, F-296 | `lockNoticeMail` |
| **Moderation 7: Seite „Regeln“** (Nutzungsregeln, Fristzusage, Einspruch per Mail) | Art. 14 DSA, Grundlage der Begründungen | S + Text | K 35 | Text vom Betreiber |
| **Moderation 8: Admin-Hinweise beim Löschen** (Strafbares sperren statt löschen, Missbrauchsdarstellung nicht kopieren) | „Löschen“ in der Meldungs-Ansicht hebt den Beleg sofort auf | S | K 35, K 18.3 | – |
| **Vereins- und Hafen-Challenges** (zurückgestellt) | Bindung über gemeinsame Ziele | M | N (Quick Wins) | Entschieden 03.11.: keine Ranglisten zwischen Personen (K6); höchstens persönliche Ziele oder Vereinssummen |
| **Segelschulen und Vereinsjugend mit Trainer-Rolle** | Eine neue Zielgruppe mit vielen Seglerinnen und Seglern | M–L | N (Quick Wins) | Rollenmodell (K 15, 12.12). Datenschutz Minderjährige |
| **Aufzeichnen unterwegs** (PWA, später nativ) | Schließt die größte Lücke zur Konkurrenz: Man braucht keine zweite App mehr | L | N (Lücken) | Hintergrund-Ortung in PWAs (vor allem iOS) begrenzt, deshalb vorher ein Machbarkeitstest |
| **Live-Standort teilen** | Sicherheit und Gemeinschaft auf dem Wasser | L | N (Lücken) | Aufzeichnen unterwegs. Datenschutz, Kosten (WebSocket/Durable Object) |
| Tests nach Bereichen schneiden, `shared.ts` aufteilen | Weniger Merge-Konflikte (`app.test.ts` hat 1853 Zeilen, `shared.ts` 606) | S | R 7, R 8 | Nebenbei, sobald die Dateien ohnehin angefasst werden |

## Bewusst nicht

| Thema | Warum |
|---|---|
| Navigation, Seekarten | Dafür gibt es Plotter und Navigations-Apps. Luv & Leute wertet aus und verbindet |
| Regatta-Organisation | Höchstens eine Schnittstelle (Ergebnisse übernehmen), kein eigenes Meldesystem |
| Vereinsverwaltung | Beiträge, Mitgliedsdaten und Buchhaltung bleiben in den Vereinssystemen |
| Hochsee, Charter | Der Fokus liegt auf Binnen- und Küstenrevieren mit Vereinen und Häfen (K 22.1) |
| Instrumente (NMEA live) | Hardware-Vielfalt und Support-Aufwand, kein Nutzen für die Gewinnung |

## Offene Entscheidungen

| Frage | Optionen / Empfehlung |
|---|---|
| **Neuer Name** | **Entschieden 03.11.: „Luv & Leute“** (Betreiber). Umstellung in der App: `feature/name-luv-leute` (F-515 … F-517), gemergt 03.11. Marke (DPMA/EUIPO) und Domain prüft der Betreiber; `segeln-potsdam.de` bleibt bis dahin |
| **`feature/supporter-badges`** (7 Commits, Stand 27.10.) | **Entschieden 03.11.: verworfen** (Stand gesichert als Tag `archiv/supporter-badges`). Brauchbare Ideen werden bei Bedarf neu aufgesetzt. Die Migration `0015_paid_support.sql` kollidiert mit `0015_approvers.sql`. Gutschein (K 18.9a) und freie Eigner (K 13.5) sind inzwischen anders gelöst |
| **`feature/moderation-konzept`** (nur `docs/MODERATION.md`) | **Erledigt 03.11.: abgeglichen in K 35** ([`concept/35-moderation.md`](concept/35-moderation.md)); der Rest steht unter „Später“ (Moderation 1–8), der Branch kann gelöscht werden. Ursprünglicher Auftrag: Offene Teile (Textfilter, Vertrauensstufen, Bildprüfung) mit dem Admin-Bereich (K 18) abgleichen. Was noch fehlt, wird ein Konzept-Abschnitt mit Reservierung, der Branch wird danach gelöscht |
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

Vergeben bis einschließlich **F-450**, **Konzept 26**, **Migration 0033**, reserviert bis **F-614**, **Konzept 38**, **Migration 0046** (Stand 9316c24, 0033 = `follows_cleanup`). Die nächsten freien Nummern
sind F-615, Konzept 39 und Migration 0047. Neue Aufträge bekommen ihren Bereich hier, bevor
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
| `feature/name-luv-leute` (Markenname „Luv & Leute“ überall in der App) | F-515 … F-517 (F-518/F-519 frei) | – | – | sichtbare Texte in rund 25 Dateien (`document.title` in Controllern, `sx-topbar`, `sx-support`, `share-image.ts`, `invite-text.ts`, `claims.ts`, `limits.ts`, Worker-Hinweise), neu `src/domain/brand.ts`, `index.html`, `manifest.webmanifest`, `sw.js`, `APP_NAME`/`MAIL_FROM` in `wrangler.jsonc`, `deploy-preview.mjs`, `mail.ts` (Escaping), Tests mit Seitentiteln, Doku-Kopfzeilen; `legal.ts` unverändert (nennt keinen Produktnamen) | gemergt 03.11. |
| `feature/saisonrueckblick` (Als Nächstes #2: „Meine Saison“-Bild, Abzeichen-Reihe) | F-520 … F-529 | 33 | 0041 (nicht gebraucht) | keine Querschnitte (nichts gespeichert, kein Endpunkt); `share-image.ts` (Markenzeile als `drawBrand`, geteilte Helfer), `controllers/session.ts` (Teilen/Herunterladen über die Helfer), neu `src/domain/season-review.ts`, `src/services/season-image.ts`, `sx-season-badges`, `sx-season-review`; `sx-logbook-page` (Saison-Abschnitt), `controllers/logbook-page.ts`, `legal.ts` (ein Satz) | gemergt 03.11. |
| `feature/kleinkram-navigation` (Jetzt: doppelter Discover-Abruf, Zahnrad am Kartenstil; Als Nächstes #7: `ENTITY_ICON`, Byline mit Boot) | F-530 … F-533 (F-534 frei geblieben) | – | – | `app.ts` (`loadDiscoverStrip`), `GuestSliderController`, `sx-map-style`, `sx-account-menu`, `sx-voyage-byline`, `icons.ts` (`ENTITY_ICON`, `groupIcon`, Symbole `layers`/`team`), `shared.ts` (`POST_KIND_ICON`), Icon-Zeilen in `sx-discover`, `sx-group-page`, `sx-home-feed`, `sx-profile-page`, `sx-stream`, `sx-my-posts`, `sx-logbook-page`; `worker/share-context.ts` (`boatPage`). Keine Migration, kein Cache | gemergt 03.11. |
| `feature/bootsklasse` (Als Nächstes #8: Filter nach Bootsklasse in Entdecken) | F-535 … F-539 | 34 | 0042 (`boat_class`) | neu `src/domain/boat-class.ts`, `src/components/boat-class-options.ts`; Spalte `boats.boat_class` (`worker/boats.ts`), `worker/discover.ts` (Bausteine `CLASS`, `?4`), `publicGroups` in `worker/groups.ts`, `sx-discover` (Auswahl, Zeile `facts`), `controllers/discover.ts`, Bootsformular in `sx-account-dialog`, `api.ts`, `app.ts` (1 Zeile), `legal.ts`. Kein Lösch-Register-Eintrag (Spalte geht mit dem Boot) | gemergt 03.11. |
| `feature/web-url` (Web-URL für Vereine und Häfen) und Auffindbarkeit (Sitemap öffentlicher Seiten, SEO-Prüfung) | F-540 … F-549 (vergeben bis F-546) | – (Skizze in REQUIREMENTS) | 0043 (`web_url`) | `groups.web_url`, `harbors.web_url`; `worker/groups.ts` (`applyInput`, INSERT/UPDATE, `groupShape`), `worker/harbors.ts` (`readWebUrl`, `updateHarbor`, `harborShape`), `admin.ts` (`adminRename`, `extra`), `admin-merge.ts` (`mergeHarbor`), `discover.ts` (`LISTED` exportiert), neu `worker/sitemap.ts`, `worker/index.ts` (Routen `/robots.txt`, `/sitemap.xml`, `route()`, noindex außerhalb der Hauptdomain, `canonical`/`og:url`), `src/domain/groups.ts` (`parseWebUrl`, `webUrlLabel`), `shared.ts` (`webLink`), `sx-group-page`, `sx-profile-page` (Hafen), `sx-admin-page`, `services/api.ts`, `legal.ts`; nach Review: `readWebUrl` in `validate.ts`, neu `worker/http-error.ts`, `indexableHost` in `canonical.ts` | gemergt 03.11. |
| `docs/moderation-abgleich` (Moderations-Konzept gegen K 18 abgleichen) | – | 35 | – | nur `docs/` | gemergt 03.11. |
| `feature/community-ohne-auto` (Community-Stream ohne automatische Einträge, Schalter nur unter „Meine“) | F-550 … F-554 (vergeben bis F-551) | – | – | Berührt `worker/stream.ts` (`recentCandidates`, `targetCandidates`/`groupItems` mit `postsOnly`, `harborPosts` statt `harborItems`, `publicStream`, `nearStream`), `worker/stream-sql.ts` (`postKindsSql`, `PUBLIC_TARGETS_SQL`, `RECENT_POSTS_SQL`, `PERSONAL_SQL` unverändert), `src/domain/groups.ts` (`STREAM_POST_KINDS`), `sx-home-feed` (`modeTabs`), `controllers/groups.ts` (`autoPref`: Gäste immer „zeigen“); öffentlicher 60-s-Cache (Schlüssel unverändert). Keine Migration, keine Löschwege | gemergt 03.11. |

**Entscheidungen `feature/kleinkram-navigation` (03.11., ohne Rückfrage getroffen):**
- Ein Abruf für Leiste und Slider (F-530): die App hält das Versprechen von `api.discover(6)`, solange die Seite lebt,
  und gibt es beiden; nach einem Fehler lädt die Leiste beim nächsten Weg zur Startseite neu, der Slider (lauscht auf
  `home`) teilt diesen Versuch. Hat der Gast einen
  Ort gemerkt, bleibt der Umgebungs-Abruf des Sliders eigen – das sind andere Daten.
- Kartenstil (F-531): neues Symbol `layers`, Beschriftung „Kartenstil“ statt „Ansicht konfigurieren“. Das Zahnrad im
  Konto-Menü („Konto & Einstellungen“) wird zu Schiebereglern (`sliders`, unterscheidbar von „Meine Seite“), damit N6 gilt;
  ein Test prüft, dass `icon('gear')` nur in `sx-page-menu` vorkommt.
- `ENTITY_ICON` (F-532) liegt in `icons.ts` (neben den Symbolen, ohne `shared.ts` wachsen zu lassen); Team bekommt das neue
  Symbol `team` (drei Köpfe). Allgemeine Knöpfe „Verein oder Team gründen“ behalten `pennant`; Hinweise ohne Objekt
  (Unterstützer-`pennant`) bleiben; Orte ohne Objekt bekommen die Stecknadel `location`, der Anker heißt nur noch Hafen.
  `sx-entity-link` (Danach) baut darauf auf.
- Boot in der Byline (F-533): eigenes Feld `boatPage` aus `shareContext` statt `boat` umzudeuten – `boat` nennt der
  Eigentümer:in auch Boote, deren Seite sie nicht (mehr) öffnen darf. „Nur mit Link“-Boote nennt die Byline nur
  Verwaltern (der Boots-Schlüssel fehlt dem Betrachter), gesperrte nie, bei gesperrtem Konto (Törn oder Boot) nichts;
  Plattform-Admins sehen ausgeblendete Boote dort nicht (enger als `getBoat`). Gesperrte Boote fallen auch aus `boat`.
  Wortlaut „auf <Boot>“.
| `fix/saison-ab-maerz` (Fahrtenbuch und Wertung wählen bis Ende Februar die abgelaufene Saison) | F-555 … F-559 | – | – | `src/domain/support.ts` (`shownSeason`), `logbook-year.ts`, `controllers/logbook-page.ts`, `scoring.ts` (`clubListSeason`), `controllers/scoring-page.ts` | gemergt 03.11. |
| `feature/moderation-titelbilder` (Moderation 1 und 4: Titelbilder absichern, Melde-Gewicht und Gründe) | F-560 … F-569 | 36 | 0044 | `worker/covers.ts`, `worker/reports.ts`, Admin-Liste, `isNewAccount` (`src/domain`), `legal.ts` | in Arbeit 03.11. |
| `feature/moderation-admin` (Moderation 3, 6, 8: Hinweis auf offene Meldungen, Begründungsmail, Hinweise beim Löschen) | F-570 … F-579 | – | 0045 (falls nötig) | Nachtlauf (`retention.ts`), `worker/mail.ts`, Admin-Meldungsansicht, Konto-Knopf | in Arbeit 03.11. |
| `feature/revier-heatmap` (Routen und Heatmap auf der Community-Karte, Cluster-Pins) | F-580 … F-589 | 37 | – | Karte (`src/map`), `worker/discover.ts` bzw. neuer öffentlicher Endpunkt, `src/domain/cluster.ts` | in Arbeit 03.11. |
| `feature/invite-box` (`sx-invite-box`, „Freunde einladen“ auf der eigenen Seite) | F-590 … F-599 (vergeben bis F-592) | – | – | neu `sx-invite-box` (`friendInviteBox`); `sx-crew` (`voyageTitle`), `sx-group-page`, `sx-account-dialog` (Boots-Admins), `sx-home-feed` (Willkommens-Karte), `sx-profile-page` (Zahnrad „Freunde einladen“, `inviteLink`), `invite-text.ts` (`inviteShareText`), `controllers/session.ts` (`shareInvite`, `voyageTitle`), `controllers/groups.ts`/`social.ts` und `api.ts` (`{ to }` statt `email`), `app.ts` (2 Zeilen). Keine Endpunkte, keine Daten, kein Cache | gepusht 03.11., bereit zum Review |
| `feature/gpx-nachreichen` (GPX zu gespeicherten Törns) | F-600 … F-609 | 38 | 0046 (falls nötig) | `worker/shares.ts`, Upload, Speicherzähler, Wetter, Vorschaubild, Fotos | in Arbeit 03.11. |
| `feature/segellebenslauf` (Export über alle Saisons) | F-610 … F-614 | – | – | `worker/logbook-list.ts` (CSV), `sx-logbook-page` | in Arbeit 03.11. |

**Entscheidungen `feature/invite-box` (03.11., ohne Rückfrage getroffen):**
- Ein Baustein `sx-invite-box` (F-590), rein darstellend; er meldet `invite-create`/`invite-revoke` nur an das
  einbettende Element, das in die bisherigen Events übersetzt. So bleiben Controller und `app.ts` fast unverändert;
  nur Gruppe und Freunde melden jetzt `{ to }` statt `{ email }`, weil die Endpunkte Profilnamen schon kannten.
- Abgeleitet aus den vier Vorgängern: Link nur „jetzt sichtbar“, danach kein zweiter Erzeugen-Knopf (wie bisher bei
  der Crew; die Gruppe zeigte vorher beides). Boots-Admins ohne Link (Endpunkt verlangt ein Ziel). Freunde ohne Liste
  offener Einladungen (es gibt dafür keinen Endpunkt; nicht neu gebaut). QR-Codes gab es nirgends – keine.
- „Mail-Text“ (F-591): mit Teilen-Menü des Geräts „Teilen“ mit Begleittext, sonst „Per Mail senden“ als `mailto:` mit
  Betreff, Text und Link – höchstens zwei Knöpfe neben dem Link, kein Server, keine Zählung. Der serverseitige Mailversand
  bleibt das Feld „E-Mail oder Profilname“.
- „Freunde einladen“ (F-592) nur im Zahnrad der eigenen Seite (N6: Seiten-Aktion; N1: kein Eintrag im Konto-Menü). Die
  Willkommens-Karte bleibt als Abkürzung im Kontext und nennt den festen Ort. Der Link wird an Karte und Seite gegeben;
  die Seite vergisst ihn beim Wechsel auf eine andere Seite.
