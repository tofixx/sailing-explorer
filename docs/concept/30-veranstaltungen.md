# 30. Veranstaltungen (Phase 5, F-408, F-410, F-480 … F-489, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 30). Regeln aus Konzept 21.5 („Veranstaltung“), Phasenplan 21.8 (Phase 5:
`post_events`, `event_rsvps`, Kapazität, Erinnerungen im Cron, `.ics`, „Ins Fahrtenbuch übernehmen“), Benachrichtigungen
21.7 (F-416) und Glocken-Stufe „Wichtiges“ (24.6). Leitlinie: „weniger ist mehr, ein Weg nach Rom“ – eine Veranstaltung
ist eine Art von `posts` (PRINCIPLES „Erweitern“ 1), ohne eigene Seite und ohne eigenen Einstieg; sie hängt sich an
dieselben Erweiterungspunkte wie Umfragen (Konzept 29).

## 30.1 Architektur-Skizze

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Art `event` in `posts`: `body` = Titel (erste Zeile, der Text des Beitrags) und Beschreibung – lesbarer Rückfall für alte Oberflächen, „Mein Verlauf“, Profil, Link-Vorschau. Neu `post_events (post_id → posts ON DELETE CASCADE, type, starts_at, ends_at, place, capacity, reminded_at, cancelled_at)` mit Index auf `starts_at` und `event_rsvps (post_id → post_events ON DELETE CASCADE, user_id → users ON DELETE CASCADE, status, updated_at, PK (post_id, user_id))` mit Index `(user_id, updated_at)`. Migration `0037_events.sql`, additiv. Regeln (Arten, Grenzen, Prüfung, Zusage, `.ics`, Fahrtenbuch-Vorlage) rein in `src/domain/events.ts` |
| Erweiterungspunkte | je eine Zeile: `COMPOSE_LIMITS`, `POST_KIND_LABEL` (src/domain/posts.ts), `COMPOSE_KINDS.event` (worker/post-kinds.ts: `data` prüft Termin und Beschreibung, `body` setzt Titel + Beschreibung, `rows` schreibt `post_events` im selben Batch statt `posts.data`), `attachKindData` (worker/stream.ts), `KINDS` (sx-compose), `KIND_FORMS` (sx-compose-dialog), `kindPayload` (sx-stream), `POST_KIND_ICON`; `notifyEventOf` kannte `event` schon |
| Sichtbarkeit / Sperre | Zusagen und „Wer kommt?“ prüfen mit `visiblePost` (dieselbe Regel wie Reaktionen, Umfragen und `/p/<id>`). Die Karte kommt über den Stream (`shapePost`, Ausbreitung „Sichtbar bis“ wie Text). Namen nur öffentlicher Profile (`publicSql`), gesperrte Konten zählen nirgends (`notSuspendedSql`, auch nicht für die Kapazität) |
| Publikum im Stream | unverändert `recordPost`/`forActivity` wie Text-Beiträge |
| Caches | Termin und Zähler stehen wie Reaktionen im 60-s-Cache öffentlicher Streams (für alle gleich); die eigene Zusage und „Ändern oder absagen“ hängt `attachKindData` je Betrachter erst nach dem Cache an (`addMine`, auch in Tageskarten). Test „Gast sieht keine eigene Zusage, auch nicht nach dem Abruf eines Mitglieds“ |
| Zähler / Grenzen | Anlegen zählt in `post_log` (5 je Verlauf und Tag, wie Text). Zusagen: jede Änderung zählt in die gemeinsame Tagesgrenze der Interaktionen (`reaction_log`, 300 je Konto und Tag, mit Reaktionen und Stimmen; im selben Batch, nur wenn die Zusage gespeichert wurde). Kapazität 1–500, atomar in **einer** Anweisung (`INSERT … SELECT … WHERE Zusagen < capacity … ON CONFLICT`, `meta.changes`, R 10) |
| Benachrichtigungen | Neue Veranstaltung: `notifyPost` mit Art `event` → „Wichtiges“. Neu `rsvp` (Zusage an die Autor:in, solange die Person noch nicht zugesagt hatte, gebündelt, nur Glocke) und `event` (Erinnerung bzw. Änderung/Absage an „Nehme teil“/„Vielleicht“, auch in stummen Verläufen – eigene Zusage; höchstens 200 Empfänger wie neue Beiträge). Beim Lesen: neue Veranstaltungen wie neue Beiträge (`postWhere`, Satz „neue Veranstaltung“); Erinnerung, Änderung und Absage gelten, solange die Zusage gilt und Beitrag, Autor:in und Verlauf nicht ausgeblendet bzw. gesperrt sind – auch „Nur mit Link“ (Ziel mit Schlüssel, `eventWhere`). Kanal „Veranstaltungen“ wählbar (Glocke · Mail · Push, Standard Glocke) |
| Mail-Budget | **Kein eigener Mailversand.** Wer für „Veranstaltungen“ Mail wählt, bekommt Erinnerung bzw. Änderung in der bestehenden täglichen Sammelmail (`sendNotificationDigests`, höchstens 25 je Nacht) – das Budget (100/Tag, geteilt) ändert sich nicht. Die Mail nennt nur den Verlauf („Veranstaltung in „PYC“: Erinnerung …“), nie den Titel |
| Cron | Kein neuer Trigger: der Nachtlauf 03:17 UTC (`runRetention`) löscht abgelaufene Veranstaltungen (höchstens 20) und erinnert vor der Sammelmail an Veranstaltungen der nächsten 36 h (einmal, `reminded_at`, höchstens 50) – nur Glocke und Sammelmail, **kein Push um 3 Uhr nachts** |
| Einbettungen / RSS | keine Zusage; RSS und alte Oberflächen zeigen Titel und Beschreibung als Text |
| Admin / Moderation | wie Text-Beiträge (melden, ausblenden, `removePost`) |
| Zusammenführen | Konten: Zusagen der Quelle wandern, wo das Ziel noch keine hat (`mergeUsers`); Häfen: Beiträge wandern wie bisher, Termin und Zusagen hängen an der Post-ID |
| Komponenten | Formularteil `sx-event-form` (Art, Beginn, Ende, Ort, Plätze, beim Anlegen Beschreibung; meldet `sx-payload` { value, ok, message }, geprüft mit `parseEventInput` – einmal, auch im Ändern-Dialog), `sx-event` (unter dem Text: Datum, Termin, Ort, Zähler, Zusage-Knöpfe, „Wer kommt?“, `.ics`, „Ins Fahrtenbuch übernehmen“, „Ändern oder absagen“), `sx-event-dialog` (Ändern/Absagen, `dialogStyles`), `controllers/events.ts` (Zusage, Namen, `.ics`, Ändern, `busy`), `sx-logbook-form` (`preset`). Mobil: Zusage-Knöpfe in voller Breite, Tippziele ≥ 44 px |
| Parallele Arbeit | auf Umfragen (Konzept 29) aufgebaut; „Ins Fahrtenbuch übernehmen“ nutzt die Zusatzangaben aus Phase 8 (Konzept 27) |

## 30.2 Löschen und Sichtbarkeit

| Gespeichert | entfernt auf welchem Weg | Test |
| --- | --- | --- |
| Veranstaltung (`posts`, `kind = 'event'`) | wie Text-Beiträge: `removePost` (Autor:in, Verwalter des Verlaufs, Moderation), Gruppe (Cascade `group_id`), Hafen/Boot (`channelPostsCleanup`), Konto (Cascade `author_id`); **Frist:** 12 Monate nach Ende im Nachtlauf (`expireEvents` → `removePost`). Übernommene Fahrtenbuch-Einträge bleiben, sie sind eigene Törns | F-488 |
| Termin (`post_events`) | Cascade mit dem Beitrag (alle Wege oben) | F-488 |
| Zusagen (`event_rsvps`) | Cascade mit dem Termin und mit dem Konto (`purgeUser`, inaktive Konten); ändern bis zum Ende; Zusammenführen (`mergeUsers`) | F-488 |
| `event`, `rsvp` (`notifications`) | mit dem Beitrag (`deletePostNotifications`), Konto, nächtliche Fristen; ohne eigene Zusage („Nehme teil“/„Vielleicht“) erscheint die Erinnerung nicht mehr | F-485 |
| Zähler (`reaction_log`) | wie bisher nach 24 h bzw. mit dem Konto | – |

| Wer sieht | was |
| --- | --- |
| wer den Beitrag sehen darf (auch über die Ausbreitung) | Titel, Art, Termin, Ort, Kapazität, Zähler je Status; zusagen nur angemeldet und nicht gesperrt |
| dieselben | „Wer kommt?“: bei „Nehme teil“ und „Vielleicht“ Namen öffentlicher Profile, der Rest als Anzahl; „Nehme nicht teil“ nur als Anzahl |
| Autor:in sowie Eigner und Admins der Gruppe (21.5) | alle Anzeigenamen der Zusagen (wie die Mitgliederliste), auch „Nehme nicht teil“ |
| nur man selbst | die eigene Zusage (nie im Cache) |

## 30.3 Festlegungen gegenüber 21.5

- **Text = Titel:** Im Formular ist der Text des Beitrags der Titel (≤ 120 Zeichen, eine Zeile); Beschreibung, Termin,
  Ort und Plätze stehen im Formularteil. Gespeichert wird `body` = Titel + Beschreibung, damit alte Oberflächen,
  Link-Vorschau (`firstLine`), „Mein Verlauf“, Profil und Benachrichtigungen ohne Sonderweg funktionieren. Titel und
  Beschreibung lassen sich wie bei allen Beiträgen nicht ändern; ändern lassen sich Art, Beginn, Ende, Ort und
  Kapazität – und absagen.
- **In jedem Verlauf**, auch im Profil: Profil und „Mein Verlauf“ verlinken die Karte (`hasKindCard`, wie Umfragen),
  `/p/<id>` zeigt sie mit Zusage.
- **Ort als Freitext** („Steg B, Vereinsheim“, ≤ 120 Zeichen) statt Hafen-Auswahl oder Kartenpunkt: der Ort steht im
  Verlauf ohnehin fest, und ein Freitext braucht keinen Lösch- und Zusammenführen-Pfad (`harbor_id`, `lat`, `lon` aus
  21.3.2 entfallen). „Ins Fahrtenbuch übernehmen“ belegt darum Datum, Titel und die Zusatzangaben aus Phase 8 vor
  (Regatta mit Namen; Arbeitsdienst, Training, Kurs als Posten), den Hafen wählt man im Formular.
- **Absagen statt Löschen:** eine abgesagte Veranstaltung bleibt als Karte („Abgesagt“) stehen, Zusagen und
  Kalender-Datei entfallen, alle mit Zusage bekommen `event`. Löschen bleibt daneben möglich (ohne Meldung).
- **Erinnerung nur in Glocke und Sammelmail:** der Nachtlauf schickt keinen Push (03:17 UTC weckt niemanden, und die
  Subrequest-Grenze des Free Tiers bleibt unberührt). Änderungen und Absagen gehen sofort; Push bei einer neuen Meldung,
  nach einer ungelesenen Erinnerung (die selbst nicht geweckt hat) und bei jeder Absage – wiederholtes Ändern weckt nicht
  jedes Mal. Ändern und Absagen nur mit aktuellem Schreibrecht im Verlauf (wie Erweitern, F-409). Erinnert wird einmal je Termin;
  wird der Beginn verschoben, gibt es eine neue Erinnerung.
- **Erinnerung und Änderung teilen eine Art** (`event`): solange ungelesen, bündelt die Glocke sie in einer Zeile; ihr
  Text richtet sich nach dem jüngsten Anlass (Erinnerung ohne handelnde Person, Änderung durch die Autor:in, Absage aus
  dem Zustand). Ein Kanal „Veranstaltungen“ statt zweier.
- **Sammelmail ohne Titel:** Mails verlassen die Plattform – sie nennen wie bei Beiträgen nur den Verlauf (Regel von
  `mailLine`), im Profil-Verlauf nicht einmal den.
- **Zusage an die Autor:in:** `rsvp` meldet „Nehme teil“ bzw. „Vielleicht“, solange die Person noch nicht zugesagt hatte
  (auch nach „Nehme nicht teil“), nie einen Wechsel zwischen beiden.
- **Kapazität verkleinern** geht; wer schon „Nehme teil“ hat, behält es und kann es erneut bestätigen (keine
  Warteliste, kein Hinauswurf).
- **Kalender-Datei** mit `LAST-MODIFIED` und `SEQUENCE` aus dem letzten Ändern (`posts.updated_at`), damit Kalender
  eine verschobene Zeit beim erneuten Laden übernehmen.
- **Zeitzone:** gespeichert in UTC (ms), angezeigt in der Zeit des Geräts; `.ics` mit UTC-Zeiten (`Z`).
- **Grenzen:** Titel ≤ 120, Ort ≤ 120 Zeichen, Beschreibung ≤ 1879 (Titel und Beschreibung zusammen wie ein Beitrag),
  Ende nach Beginn und höchstens 14 Tage später, Beginn höchstens zwei Jahre voraus; anlegen und ändern nur, solange die
  Veranstaltung nicht vorbei ist.

## 30.4 Anforderungen

F-408 und F-410 aus 21.9 sind ausformuliert; Einzelheiten F-480 … F-489 in `docs/REQUIREMENTS.md`.
