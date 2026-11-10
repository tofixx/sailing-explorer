# 40. Kommentare an allen Beiträgen, Benachrichtigung je Verlauf (F-635 … F-644, 10.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 40). Wunsch des Betreibers (diktiert): „dass man quasi überall Kommentare
ergänzen kann und Benachrichtigungen nur in dem Verlauf erfolgen … nicht alle im Channel über weitere Benachrichtigungen
zu einem Termin informiert werden, sondern nur zu dem Termin selbst, zu den Kommentaren erst, wenn sie selbst einen
geschrieben haben … Benachrichtigen-an-Symbol: geht mit erstem Kommentar an, das kann man deaktivieren – oder stumm
schalten.“ Baut auf Konzept 4 (Kommentare), 17.9.1 (Mitkommentierende), 21 (Beiträge), 29–31 (Umfrage, Veranstaltung,
Galerie) auf. Leitlinie „weniger ist mehr, ein Weg nach Rom“: dieselbe Komponente, dieselben Endpunkte je Verlauf,
dieselbe Benachrichtigungsart `comment`.

## 40.1 Entscheidungen (ohne Rückfrage getroffen)

| Frage | Entscheidung | Warum |
| --- | --- | --- |
| Was ist ein „Verlauf“ (Thread)? | Ein **Törn** (`shares`, wie bisher – auch Fahrtenbuch-Einträge und Törn-Beiträge, deren Post-Zeile `share_id` trägt) oder ein **Beitrag ohne Törn** (`posts` der Arten Text, Umfrage, Veranstaltung, Galerie). Ein Kommentar hängt an genau einem von beiden (`comments.share_id` bzw. `comments.post_id`). | Törn-Beiträge haben schon ihre Törn-Kommentare; ein zweiter Faden am selben Törn wäre ein zweiter Weg. |
| Regeln | Für Beiträge **dieselben** wie für Törns: Länge, Links, Spam-Grenzen (`comment_log`, gelten über alle Verläufe), Profil nötig, gesperrte Konten nicht, Melden, Ausblenden, höchstens 500 je Verlauf. Kommentar-Modus `on`/`off`/`hidden` neu als `posts.comments_mode`. | Eine Regel, ein Modul. |
| Wer sieht und schreibt? | Wer den Beitrag sehen darf (`visiblePost`: Gruppe nur Mitglieder bei „Nur Mitglieder“, „Nur mit Link“ mit Schlüssel, ausgeblendet nur Autor:in/Admins) – sonst 404 (fail closed). Kommentarlisten sind immer `private, no-store`. | Sichtbarkeit beim Lesen prüfen, nichts Betrachterabhängiges im Cache. |
| Wer löscht fremde Kommentare? | Autor:in des Kommentars, Eigentümer:in des Verlaufs (Törn-Eigentümer:in bzw. Beitrags-Autor:in) und Admins – wie bei Törns. Verwalter einer Gruppe nicht (sie können den ganzen Beitrag löschen oder melden). | Gleiche Regel wie Törns; kein zweites Rechtemodell. |
| Kommentar-Modus am Beitrag | Setzt die Autor:in. Einstieg: Auswahl „Kommentare: an / keine neuen / ausgeblendet“ im Kopf der Kommentare des Beitrags (nur für sie). Törns behalten ihren Einstieg im Zahnrad-Menü (F-510). | Beiträge haben kein Zahnrad-Menü – je Gegenstand genau ein Einstieg (UX N1). |
| Wer wird benachrichtigt? | Nur die **Abonnent:innen des Verlaufs** (Art `comment`): die Eigentümer:in (Törn) bzw. Autor:in (Beitrag) – ohne Zeile automatisch an – und wer eine Zeile `state = 'on'` hat. Der Kanal bzw. die Gruppe hört nur vom Beitrag selbst (F-416/F-449, unverändert), nie von Kommentaren. | Wunsch des Betreibers. |
| Automatisch an | Der **erste eigene Kommentar** legt `on` an (`INSERT OR IGNORE`) – **nur, wenn es noch keine Zeile gibt**. Wer stumm geschaltet hat (`off`), bleibt stumm, auch nach weiteren eigenen Kommentaren; die Glocke schaltet es jederzeit wieder an. | Stummschalten muss halten; eine Wiederanmeldung ohne Zutun wäre überraschend. |
| An ohne Kommentar? | Ja: Wer den Verlauf mit seinen Kommentaren sehen darf und angemeldet ist, darf die Glocke selbst einschalten (ausdrückliches Opt-in). | Mitlesen ohne zu schreiben ist ein häufiger Wunsch (Termin-Absprachen); es bleibt ein bewusster Klick. |
| Eigentümer:in stumm | Eigene Zeile `off` – dann auch die Eigentümer:in stumm. Eigentum ohne Zeile gilt als `on` (kein Schreiben beim Anlegen, folgt einem Eigentümer-Wechsel beim Zusammenführen von selbst). | Kein zusätzlicher Write je Törn/Beitrag, kein Nachtrag für Altbestand. |
| Wann geliefert? | Wie bisher (17.9.1): nie an die Kommentierende selbst, nicht an gesperrte Konten, höchstens 50 (Eigentümer:in zuerst, dann die zuletzt Aktiven). Andere als die Eigentümer:in nur bei Törns, die öffentlich und weder ausgeblendet noch gesperrt sind, bzw. bei Beiträgen „Öffentlich“ oder „Nur Mitglieder“; beim Lesen prüft die Glocke erneut, ob die Empfängerin den Beitrag noch sehen darf (Gruppe: noch Mitglied; „Nur mit Link“ fällt für Abonnent:innen weg, wie bei Törns). Kanäle Mail/Push je Art bleiben (F-256). Ausgeblendete Kommentare benachrichtigen nicht (sie entstehen nicht ausgeblendet). | Bestehende Regel, auf Beiträge übertragen. |
| Altbestand | Die Migration legt für alle, die bisher als Mitkommentierende benachrichtigt wurden (nicht ausgeblendeter Kommentar, nicht Eigentümer:in), eine Zeile `on` an. Eigentümer:innen brauchen keine. | Niemand verliert die bisher stillschweigende Benachrichtigung. |
| Texte | Glocke: „Anna hat deinen Beitrag in „Verein X“ kommentiert“ bzw. „… einen Beitrag in …“; Sammelmail ohne Beitragstext (nur Verlauf, wie Veranstaltungen 30.3). Kommentar-Benachrichtigungen eines Beitrags werden gelesen, sobald man seine Kommentare öffnet. | Mails verlassen die Plattform – keine fremden Texte. |
| Zähler an der Karte | Kein Zähler. Törn-Karten haben keinen; die Beitragskarte hat „Kommentare“ zum Aufklappen. | Weniger ist mehr; kein zusätzlicher Unterabfrage-Aufwand je Stream-Zeile. |

## 40.2 Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“)

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Erweiterung bestehender Objekte, keine neue Art. **0048** Neubau `comments` (nur `share_id` nullable, wie 0038). **0049** `comments.post_id → posts ON DELETE CASCADE`, `posts.comments_mode`, neue Tabelle `comment_subscriptions (share_id → shares, post_id → posts, user_id → users, alle ON DELETE CASCADE; state on/off; created_at)` mit eindeutigen Teilindizes je Verlauf und Konto; Nachtrag aus `comments`. |
| Querschnitte | Sichtbarkeit: `visibleShare` bzw. `visiblePost` (unverändert genutzt). Caches: Kommentarlisten `private, no-store`; Stream unverändert. Zähler/Kontingente: `comment_log` wie bisher. Benachrichtigungen: `notifyComment(thread)` liest Abonnent:innen; Prüfung beim Lesen in `listNotifications` (Fall `post`/`comment`). Moderation: Melden (`visibleComment`), Admin-Vorschau, Entscheidungs-Hinweis (`report-notices`) kennen Beitrags-Kommentare. Zusammenführen: Abos wandern mit. Einbettungen, Publikum im Stream: unberührt. |
| Lösch- und Sichtbarkeitspfade | 40.3 |
| Komponentenschnitt | Reine Regel `src/domain/comment-thread.ts` (`isSubscribed`). Worker: `worker/comments.ts` je Verlauf (`threadOf`), Routen `GET/POST /api/{shares,posts}/:id/comments`, `PUT …/comments/subscription { on }`; `PATCH /api/posts/:id { commentsMode }`. Oberfläche: `sx-comments` bekommt `thread` und die Glocke im Kopf (44 px, `aria-pressed`); Ereignisse tragen `el`, der `CommunityController` bedient jede Instanz (Törn-Panel und Beitragskarten). Neu `sx-post-comments` („Kommentare“ zum Aufklappen, geladen erst dann) unter jeder Beitragskarte in `sx-stream`, `sx-profile-posts` und `sx-my-posts` – ein Baustein, drei Listen. 375 px: Knopf und Glocke brechen um, Auswahl schrumpft (`min-width: 0`). |
| Parallele Arbeit | `feature/wertung-bsv` fasst nur Wertung/Fahrtenbuch an; keine Überschneidung. |

## 40.3 Lösch- und Sichtbarkeitspfade

| Gespeichert | Entfernt auf welchem Weg |
| --- | --- |
| Kommentar an einem Beitrag | einzeln (`removeComment`: Autor:in, Autor:in des Beitrags, Moderation); mit dem Beitrag per `ON DELETE CASCADE` auf jedem Löschweg von `posts` (`removePost`, `removeGroup`, `channelPostsCleanup`, `purgeUserGroups`, Frist der Veranstaltungen); Konto (`purgeUser`, Kaskade `users`); Meldungen dazu mit `removePost` bzw. nächtlich als Waisen. |
| Abo (`comment_subscriptions`) | Glocke aus bleibt als `off` stehen (Merken); mit Törn (`removeShare`, Frist) bzw. Beitrag (alle Wege) per Kaskade; Konto gelöscht (Kaskade); Zusammenführen (`mergeUsers` hängt um, Doppeltes fällt). |
| `posts.comments_mode` | mit der Zeile. |

Wer sieht es wo: Kommentare und Glocke nur, wer den Verlauf sehen darf (bei `hidden` nur Eigentümer:in und Admins).
Die Glocke zeigt nur eingeloggten Personen ihren eigenen Zustand.

## 40.4 Anforderungen

F-635 … F-644 in `docs/REQUIREMENTS.md` (Block „Kommentare überall“); Tests in `test/functional/comment-threads.test.ts`,
`test/functional/migration-comments.test.ts` und `test/functional/comment-threads-ui.test.ts`.
