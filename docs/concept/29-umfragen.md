# 29. Umfragen (Phase 4, F-407, F-470 … F-478, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 29). Regeln aus Konzept 21.5 („Umfrage“), Phasenplan 21.8 (Phase 4:
`poll_votes`, Karte, Grenzen, `poll_closed`), Benachrichtigungen 21.7 (F-416) und Glocken-Stufe „Wichtiges“ (24.6/24.7).
Leitlinie: „weniger ist mehr, ein Weg nach Rom“ – eine Umfrage ist eine Art von `posts` (PRINCIPLES „Erweitern“ 1), keine
eigene Seite, kein eigener Einstieg.

## 29.1 Architektur-Skizze

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Art `poll` in `posts`: `body` = Frage (lesbarer Rückfall für alte Oberflächen, Mein Verlauf, Profil), `data.poll` = `{ options, max, closesAt, results, named }` (geprüft in `src/domain/polls.ts`, kein `CHECK`). Neu nur `poll_votes (post_id → posts ON DELETE CASCADE, user_id → users ON DELETE CASCADE, choice, created_at, PK (post_id, user_id, choice))` mit Index auf `user_id`, Migration `0036_poll_votes.sql` (additiv). Vorzeitiges Beenden setzt `closesAt` auf jetzt – ein Feld für „wann endet sie“. `data.poll.notified` merkt, dass `poll_closed` verschickt ist |
| Sichtbarkeit / Sperre | Abstimmen und „Wer hat was gewählt“ prüfen mit `visiblePost` (dieselbe Regel wie Reaktionen und `/p/<id>`, auch Schlüssel „Nur mit Link“, Gruppe, „Nur Mitglieder“, ausgeblendet, gesperrt); Karte über den Stream (`shapePost`, Ausbreitung „Sichtbar bis“ wie Text). Gesperrte Konten zählen nicht mit (`notSuspendedSql`), Namen nur öffentlicher Profile (`publicSql`) |
| Publikum im Stream | unverändert `recordPost`/`forActivity` wie Text-Beiträge – Ziele aus derselben Funktion |
| Caches | Der öffentliche 60-s-Cache (ohne Betrachter berechnet) enthält nur, was jeder Gast sehen darf: Einstellungen und – bei „Ergebnis immer“ bzw. nach dem Ende – Zähler und Teilnehmende (bis 60 s alt), nie eine eigene Wahl. Für Angemeldete hängt `attachKindData` (`worker/stream.ts`, je Art eine Zeile) Stimmen, eigene Wahl und Ergebnis **nach** dem Cache an (`addMine`, auch neben Tageskarten großer Gruppen, Phase 6) – `private, no-store`. Tests „Gast sieht nichts, auch nicht nach dem Abruf eines Mitglieds“ und „Ergebnis immer“ |
| Zähler / Grenzen | Anlegen zählt in `post_log` (5 je Verlauf und Tag, wie Text). Stimmen: Tagesgrenze gemeinsam mit Reaktionen (`reaction_log`, 300 Änderungen je Konto und Tag – ein Zähler für „Interaktionen“ statt eines zweiten). Höchstens 1000 Teilnehmende je Umfrage: atomar in einem Batch (`DELETE` eigene, `INSERT … SELECT … FROM json_each WHERE offen AND Teilnehmende < 1000`, `meta.changes`, R 10) |
| Benachrichtigungen | Neue Umfrage: `notifyPost` mit Art `poll` → Ereignis „Wichtiges“ (`notifyEventOf`, schon vorbereitet). Ende: `poll_closed` an die Autor:in, im Nachtlauf (`nightlyPollClosedStmts`, ein Batch, gedeckelt, `notified` markiert) – kein eigener Cron; vorzeitig selbst beendet → keine Meldung |
| Einbettungen / RSS | keine Abstimmung; RSS und alte Oberflächen zeigen die Frage als Text |
| Admin / Moderation | wie Text-Beiträge (melden, ausblenden, `removePost`) |
| Zusammenführen | Konten: Stimmen der Quelle wandern, wo das Ziel noch nicht abgestimmt hat (`mergeUsers`); Häfen: Beiträge wandern wie bisher, die Stimmen hängen an der Post-ID |
| Komponenten | `sx-compose` (+ „Umfrage“, eine Zeile), `sx-compose-dialog` (Formularteil je Art aus `KIND_FORMS`, eine Zeile je Art), `sx-post-composer` (Frage, Sichtbarkeit, „Sichtbar bis“, Publikums-Hinweis – ohne Link/Anhang bei `plain`), neu `sx-poll-form` (Antworten, Auswahl, Ende, Ergebnis, namentlich; meldet `sx-payload`), neu `sx-poll` (Karte; meldet `sx-poll-vote`, `sx-poll-close`, `sx-poll-who`), `sx-stream` (Nutzlast je Art, eine Zeile), `controllers/polls.ts` (Abstimmen, Beenden, Namen, `busy`). Mobil: Antworten als Liste in voller Breite, Tippziele ≥ 44 px, Balken ohne festen Mindestwert |
| Parallele Arbeit / Erweiterungspunkte | Eine neue Art (Veranstaltung, Galerie) ergänzt je Stelle eine Zeile: `src/domain/posts.ts`: `COMPOSE_LIMITS` (Länge, `plain`), `POST_KIND_LABEL`; `worker/post-kinds.ts`: `COMPOSE_KINDS` (`data` prüft die Eingabe, `view` formt die Karte; `kindView` nutzt es in `stream-shape.ts`); `worker/stream.ts`: `attachKindData` (je Betrachter nach dem Cache); `src/components/sx-compose.ts`: `KINDS`; `sx-compose-dialog.ts`: `KIND_FORMS`; `sx-stream.ts`: `kindPayload`; `shared.ts`: `POST_KIND_ICON` (Link aus Profil/„Mein Verlauf“ über `kindCardLink`/`hasKindCard` ohne Änderung); `src/domain/notifications.ts`: `notifyEventOf` und Satz in `notificationText`. `feature/fahrtenbuch-jahre` und `feature/grosse-gruppen` sind gemergt und eingearbeitet (Rebase auf 43f66cb) |

## 29.2 Löschen und Sichtbarkeit

| Gespeichert | entfernt auf welchem Weg | Test |
| --- | --- | --- |
| Umfrage (`posts`, `kind = 'poll'`) | wie Text-Beiträge: `removePost` (Autor:in, Verwalter des Verlaufs, Moderation), Gruppe (Cascade `group_id`), Hafen/Boot (`channelPostsCleanup`), Konto (Cascade `author_id`) | F-477 |
| Stimmen (`poll_votes`) | Cascade mit dem Beitrag (alle Wege oben) und mit dem Konto der Wählenden (`purgeUser`, inaktive Konten); zurücknehmen jederzeit bis zum Ende; Zusammenführen von Konten (`mergeUsers`) | F-477 |
| Tageszähler (`reaction_log`) | wie bisher nach 24 h bzw. mit dem Konto | – |
| `poll_closed` (`notifications`) | mit dem Beitrag (`deletePostNotifications`), Konto, nächtliche Fristen | F-476 |

| Wer sieht | was |
| --- | --- |
| wer den Beitrag sehen darf (auch über die Ausbreitung) | Frage, Antworten, Ende, Modus; abstimmen nur angemeldet und nicht gesperrt |
| dieselben, je „Ergebnis sichtbar“ | Zähler und Teilnehmende: „nach eigener Stimme“ (Standard), „immer“, „erst nach Ende“; die Autor:in immer |
| bei „namentlich“ (vorher angekündigt, nicht umstellbar) | wer ein Ergebnis sieht, sieht je Antwort die Namen öffentlicher Profile, den Rest als „+ n weitere“; anonym nie Namen – auch nicht die Autor:in |

## 29.3 Festlegungen gegenüber 21.5

- **Ende im Nachtlauf gemeldet:** Geschlossen ist eine Umfrage sofort (beim Lesen und Abstimmen geprüft). Die Meldung
  `poll_closed` an die Autor:in kommt im nächsten Nachtlauf (03:17 UTC) – ein zweiter Cron kostete mehr als er nützt;
  die Autor:in sieht das Ergebnis ohnehin immer.
- **„Nach eigener Stimme“: zurücknehmen nicht** (Review S1): Die Stimme macht das Ergebnis sichtbar; wer danach
  zurücknehmen könnte, sähe das Ergebnis ohne Stimme. Ändern bleibt bis zum Ende möglich; bei „immer“ und „erst nach
  Ende“ geht auch zurücknehmen.
- **Ausgeblendet** (gemeldet): keine Stimmen mehr, auch nicht von Verwaltern, die es noch sehen.
- **Tagesgrenze gemeinsam mit Reaktionen** (300 Änderungen je Konto und Tag, `reaction_log`): ein Zähler statt eines
  zweiten Logs.
- **Nicht änderbar:** Frage und Antworten lassen sich nie ändern (es gibt kein Bearbeiten von Beiträgen) – nur beenden
  oder löschen. Sichtbarkeit und „Sichtbar bis“ ändern geht wie bei Text-Beiträgen.
- **Mehrfachauswahl** „höchstens n“ mit n von 2 bis zur Zahl der Antworten.
- **Ohne eigene Stimme sichtbar** ist das Ergebnis bei „nach eigener Stimme“ auch nach dem Ende – sonst bliebe es für
  Spätkommende für immer verborgen.
- Profilseite für Besucher und „Mein Verlauf“ zeigen die Umfrage als Text (Frage) mit Link „Umfrage öffnen“; `/p/<id>`
  einer Umfrage im Profil öffnet die einzelne Karte statt des Ankers im Profil (dort gibt es keine Stream-Karte).
- Die Tagesgrenze von 5 Beiträgen je Verlauf gilt für Text und Umfragen zusammen.
