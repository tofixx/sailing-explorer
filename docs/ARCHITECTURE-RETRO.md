# Architektur-Retrospektive (Stand 02.11.2026)

Grundlage: Git-Historie aller Branches (192 Commits, 39 Merges, 25 Review-Fix-Commits seit 24.10.), Churn je Datei,
Merge-Konflikte und Review-Befunde aus den Sitzungsprotokollen, Code-Stand `main` (`23d921e`) und der laufende Stand von
`feature/beitraege-phase2`. Ziel: Was hat beim Hinzufügen von Features am meisten Nacharbeit verursacht, und welche Regeln
verhindern das künftig früh? Die daraus abgeleiteten Regeln stehen in `docs/PRINCIPLES.md` (Abschnitt „Erweitern“) und
als Schritt „Architektur-Skizze“ in `CLAUDE.md`.

## Kurzfassung

1. **Der Grundtyp „Beitrag“ kam zu spät.** Törn, Fahrtenbuch-Eintrag, Gruppen-Neuigkeit, Foto und Aktivität entstanden
   als fünf getrennte Dinge (Konzept 21.1). Jede neue Art hat Sichtbarkeit, Stream-Ziele, Löschpfade und Zähler noch
   einmal nachgebaut. Erst `9514c0b` (Phase 1, 44 Dateien) hat sie unter ein Dach geholt.
2. **Sichtbarkeit ist eine Regel, steht aber als 66 + 93 SQL-Kopien im Code.** `visibility = 'public'` kommt 66-mal in
   18 Worker-Dateien vor, `hidden_at IS NULL` 93-mal. Die häufigste Review-Befundklasse (26 Treffer in den Texten
   der Fix-Commits, doppelt so viele wie die nächste Klasse) ist „X ist für Y sichtbar, obwohl nicht öffentlich, gesperrt oder ausgeblendet“.
3. **Löschpfade sind Handarbeit ohne Register.** Polymorphe Bezüge (`subject_kind` in Reaktionen, Benachrichtigungen,
   Meldungen und Aktivität, `channel_kind` in Beiträgen) haben keinen Fremdschlüssel. Jede neue Art muss an fünf bis
   sieben Aufräumstellen gedacht werden. Lücken fielen fast immer erst im Review auf (13 Lösch-Befunde, eigener
   Prüflauf `7e08efe`/`5a51a58`).
4. **Die Ziele im Aktivitäts-Log werden pro Änderungsart einzeln angepasst statt neu berechnet.** Daraus entstand
   der einzige reine Integrations-Fix-Commit (`79d31ed`) und mehrere Bündel-Befunde (`658ed49`).
5. **Gemeinsame Dateien sind Engstellen.** `app.ts` (1203 Zeilen, 70 Commits), `api.ts`, `session.ts`, `app.test.ts`
   (1704 Zeilen, häufigster Merge-Konflikt), `REQUIREMENTS.md` und `worker/index.ts`. Dazu kamen vier
   Migrations-Umbenennungen nach Nummernkollisionen und zwei F-ID-Umnummerierungen.

## (a) Fehlende bzw. zu spät getroffene Architekturentscheidungen

| # | Entscheidung | Wann getroffen | Folge der Verspätung | Belege |
|---|---|---|---|---|
| A1 | **Gemeinsamer Inhalts-Grundtyp** (Autor, Verlauf, Sichtbarkeit, Reichweite, Löschen) | 02.11. (Konzept 21), nach 9 Inhaltsfeatures | Jede Art hat eigene Sichtbarkeits-, Stream- und Löschlogik. Die Rückfüllung `0029` muss Törn-ID = Post-ID halten, `posts.share_id → shares` braucht künftig `defer_foreign_keys`. Galerie-Fotos brauchen einen Tabellen-Neubau von `photos` (Phase 7, „größtes Migrationsrisiko“) | `9514c0b`, `0a98fde`, Konzept 21.3.4 |
| A2 | **Sichtbarkeit als zentrales SQL-Prädikat**: öffentlich, nicht gesperrt, Profil öffentlich, Boot öffentlich, reach | nie. Es gibt `canView`/`visibility.ts` für Einzelobjekte, aber keine Bausteine für Listen und Streams | Jede neue Liste (Entdecken, Hafen, Gruppe, Profil, RSS, Kennzahlen) baut die Bedingung neu und vergisst einen Teil | `4569f03`, `f2f0571`, `0a98fde`, `658ed49` („gesperrte Häfen“), `4b42063` |
| A3 | **Sperr- und Moderationszustand als Querschnitt** (`hidden_at`, gesperrt, suspendiert) | spät (Admin-Bereich 27./28.10.) | Nachträglich in alle Lesepfade eingebaut, deshalb 93 Kopien. Befunde „gesperrte Konten/Häfen“ in mehreren Features | `dfe1054`, `2532bd0`, `4569f03`, `658ed49` |
| A4 | **Lösch-Register für polymorphe Bezüge** | nie, nur Prüfpunkt 6 als Checkliste (27.10.) | Aufräumen ist über `reaction-cleanup.ts`, `notification-cleanup.ts`, `activity.ts` (`boatCleanup`, `groupActivityCleanup`, `harborActivityCleanup`, `userActivityCleanup`), `purgeUser` und `retention.ts` verteilt | `5ffd74e`, `7e08efe`, `5a51a58`, `3316822`, `597025f` |
| A5 | **Publikum eines Inhalts als eine Funktion** (Ziele aus dem aktuellen Zustand neu berechnen) | teilweise (`syncPostActivity` in Phase 2) | `syncShareGroupTargets`, `memberShareTargetsCleanup`, `recordLogbook`-Bündel und Phase-2-reach sind je eigene Differenz-SQL | `79d31ed`, `658ed49`, `70e9dc3` |
| A6 | **Vergabe von Migrationsnummern** | nur „vor Vergabe prüfen“ (Konzept 21.8) | 0012→0013 (`fa5e2ef`), stream_seen 0019→0020→0023→0024, admin 0020→0023 (`2532bd0`, `c4b916c`); auf `main` fehlt 0020; Reihenfolgefrage 0025/0026 beim Merge | Protokolle, `git log --diff-filter=R -- migrations` |
| A7 | **Frontend-Schnitt: Seite → Controller → Komponente, app.ts nur Verdrahtung** | als Prüfpunkt 8 erst nachträglich | `app.ts` und `session.ts` sind die Code-Dateien mit den meisten Änderungen (52 bzw. 33) und mit den meisten Review-Fixes (15 bzw. 11). `shared.ts` wird zum Sammelbecken (Stile, Helfer, Post-Symbole) | Churn, `dfe1054`/Befund 7 („Admin-Seite holt Daten selbst“) |
| A8 | **Mobiles Grundlayout für Dialoge, Sheets und Toasts** | 28.10. (F-291/F-292), nach den meisten Dialogen | Jeder Dialog hat Mobil-Fixes einzeln bekommen | `aa9ed83`, `ffc3101`, `8bd2314`, `7f9bcc5`, `dfd6a3c`, `0a98fde` |
| A9 | **Nebenläufigkeit: atomare Prüfung in D1** (Grenze, Annahme, Reservierung in einer Anweisung) | nicht als Regel, jeweils im Review | Rennbedingungen in Code-Anmeldung, Passkeys, Verifizierung, Crew-Rollen und Titelbild | `cea8f88`, `597025f`, `4b42063`, `5a51a58`, Crew-Review |

Gut gelaufen und als Muster zu behalten: **Fahrtenbuch K1** („kein eigenes Objekt, `shares` mit `source`“). Es erbte
alle Löschpfade, Sichtbarkeiten und Kommentare (Konzept 19.3). Ebenso der Phase-A-Vertrag (`PHASE-A-CONTRACT.md`) als
kurze, verbindliche Schnittstelle vor dem Code sowie die Bausteine `IN_LOGBOOK_SQL`, `expiry-sql.ts` und `photo-keys.ts`
(eine Regel, ein Modul).

## (b) Die teuersten Features und Stellen

| Feature / Stelle | Aufwandssignal | Warum |
|---|---|---|
| **Stream / Aktivität** (`activity.ts`, `stream.ts`, `stream-sql.ts`, `stream-shape.ts`) | Jedes Social-Feature fasst sie an. Stream-Modi brauchten einen eigenen Review-Fix über 27 Dateien (`168a3ea`), dazu `79d31ed` nach dem Merge | Ziel-Logik je Änderungsart (A5), Sichtbarkeit beim Lesen ohne Bausteine (A2), 60-s-Cache verlangt bei jeder neuen Sichtbarkeitsstufe (members, Vorschau) eine Ausnahme |
| **Löschkonzept** | eigener Prüflauf mit 9 Befunden (`7e08efe`, `5a51a58`), Löschpfad-Befunde in Passkeys, Verifizierung, Fotos und Kommentaren | A4. R2 und Speicherzähler laufen nicht per Cascade mit |
| **Admin-Bereich / Sperren** | `dfe1054` (33 Dateien) + Review-Fix über 31 Dateien (`2532bd0`) + `5aa757d` (35 Dateien) | A3: Sperrstatus musste nachträglich in fast alle Lesepfade |
| **Fahrtenbuch** | größter Feature-Commit (`ba27811`, 55 Dateien), Bündel-Befunde, Integration über zwei Zwischen-Merges (`8cb7d20`, `1bb8509`) | `dist_source`/`IN_LOGBOOK_SQL` in jeder Summe; Bündel-Ziele eigens (A5) |
| **Beiträge Phase 1** | 44 Dateien, Review: Löschrecht gegen Kopie statt `shares.user_id`, Sichtbarkeit erst nach dem Laden gefiltert | A1, A2 |
| **Integration am 28.10.** | 8 Merges in 7 Minuten, dann Release-Branches und Querschnitt-Merges bis 00:07 | parallele Features an denselben Querschnitten (Stream, Konto-Dialog, Startseite) ohne gemeinsamen Vertrag |
| **Konto-Dialog** `sx-account-dialog.ts` (1120 Zeilen) | 22 Änderungen, 5 Merge-Konflikte | Sammelt alle „Meine …“-Reiter; Konzept 21.6 plant ihn bereits als Verwaltungsbereich |
| **Tests** `app.test.ts` (1704 Zeilen) | häufigster Merge-Konflikt (7) | ein Sammeltest für alles Frontend |

## (c) Wiederkehrende Review-Befundklassen

Gezählt in den Fix-Commit-Texten (Mehrfachnennung möglich) und in den Review-Berichten der Protokolle:

| Klasse | Häufigkeit | Typisches Beispiel | Ursache (A#) |
|---|---|---|---|
| Sichtbarkeit / Sperre / Spaßname | 26 | Gruppen zeigten nicht öffentliche Törns (`4569f03`), Profil-Beiträge erst nach dem Laden gefiltert (`0a98fde`), gesperrte Häfen (`658ed49`) | A2, A3 |
| Löschpfad / Zähler / R2 | 13 + 4 | Titelbild kehrt nach Moderation zurück, Sperre überdauert Kontolöschung nicht (`4b42063`), Speicherzähler (`3316822`) | A4 |
| Migration (Nummer, Reihenfolge, Neubau) | 10 | `fa5e2ef`, `c4b916c`, `2532bd0` | A6 |
| Nebenläufigkeit / atomar | 5 | Versuch vor dem Vergleich reservieren (`cea8f88`), Annahme atomar (`4b42063`) | A9 |
| Doppelklick / busy / doppeltes Speichern | 5 | `153cf54`, `7f9bcc5` | fehlendes `busy`-Muster im Controller |
| Mobil / Dialog / Fokus / ARIA | 6+ | Sheet, randlos, Escape, `role=menu` (`aa9ed83`), z-index (`dfd6a3c`) | A8 |
| Einbettungen (`/embed`) vergessen | 3 | Knöpfe in Einbettungen (`597025f`, `dfd6a3c`, `aa9ed83`) | keine Regel „Was gilt in Einbettungen?“ |
| Zustand beim Wiederverwenden eines Elements (SPA) | 2 | `sx-page-media` behält den Modus beim Objektwechsel | keine Regel für `willUpdate` bei Schlüsselwechsel |
| F-ID-Kollision | 2 | `aa9ed83`, `c4b916c` | bereits Regel in CLAUDE.md (27.10.) |

## (d) Empfehlungen, priorisiert nach Nutzen/Aufwand

Nur beschrieben, nicht umgesetzt. Die Spalte „Phase 2“ markiert, was sofort in `feature/beitraege-phase2` greift.

| Prio | Maßnahme | Nutzen | Aufwand | Phase 2 |
|---|---|---|---|---|
| 1 | **Sichtbarkeits-Bausteine** `worker/visible-sql.ts`: `publicShareSql(alias)`, `publicBoatSql`, `publicProfileSql`, `notHiddenSql`, `reachAtLeastSql(param, level)`; Stufen aus `src/domain` erzeugt. Ein Test vergleicht SQL und Domain-Regel für alle Kombinationen. Bestehende Kopien schrittweise ersetzen, sobald eine Datei ohnehin angefasst wird | größte Befundklasse | S für neue Stellen, M für die Migration aller Kopien | **ja**: reach steht schon in `activity.ts` und `harbors.ts` doppelt |
| 2 | **Publikum als eine Funktion**: `shareTargets`/`postTargets` als einzige Quelle; `syncShareActivity`/`syncPostActivity` berechnen alle Ziele neu (Zeit der Aktivität bleibt). Matrix-Test „ändern in beliebiger Reihenfolge = neu anlegen“ | beendet die Klasse der Bündel- und Ziel-Befunde | S–M | **ja** |
| 3 | **Lösch-Register** `worker/cleanup-registry.ts`: je polymorpher Art (`subject_kind`, `channel_kind`, `target_kind`) eine Aufräumfunktion; `removeX`, `purgeUser` und `retention` holen ihre Anweisungen von dort. Test über `sqlite_master`: jede Tabelle und jede Spalte `*_kind` muss im Register oder in einer Ausnahmeliste stehen | macht Prüfpunkt 6 maschinell | M | **ja**: `channelPostsCleanup` dort eintragen; für Pins, Umfragen und Veranstaltungen zwingend |
| 4 | **Migrationsnummern reservieren**: vor der ersten Zeile Code eine leere Datei `migrations/00NN_name.sql` committen, Nummer per `git ls-tree` über alle Branches prüfen; nur additive Migrationen in Feature-Branches, Neubauten (`photos`, `shares`) als eigener Schritt | keine Umbenennungen mehr | XS | **ja**: `0030_post_reach.sql` ist noch nicht committet |
| 5 | **Frontend-Schnitt**: neue Abläufe als Controller (`src/controllers/*`) mit `busy`-Zustand gegen Doppelklick; Seiten-Komponente hält nur Properties; `app.ts` registriert Routen und Events (Ziel: keine neue Logik in `app.ts`); Öffnen von Dialogen über ein Event (`sx-compose-open`) | weniger Konflikte in `app.ts`/`session.ts` | S je Feature | **ja**: ein Editor statt `sx-post-composer` + `sx-compose`; Plus-Knopf über ein Event |
| 6 | **Mobil-Grundlayout als Baustein**: `dialogStyles` + Sheet-Muster (< 760 px randlos/unten, Fokusfalle, Escape, Sticky-Kopf) sind Pflicht für jeden Dialog; Prüfung bei 375 px vor dem Review | Klasse „Mobil/Dialog“ | XS | **ja**: Plus-Menü als Bottom-Sheet |
| 7 | **Tests nach Bereichen schneiden**: `app.test.ts` aufteilen (Startseite, Törn, Konto, Gruppen); neue Features legen eigene Testdateien an | weniger Merge-Konflikte | S | neue Tests in eigene Dateien |
| 8 | **`shared.ts` aufteilen** in `styles/` (base, dialog, menu, cards) und `helpers.ts` | weniger Konflikte, klarere Wiederverwendung | S | optional |
| 9 | **Konto-Dialog in Verwaltungsbereich überführen** (Konzept 21.6, Phase 8) – vorher keine neuen Reiter im Konto-Dialog | stoppt Wachstum der größten Komponente | M | Phase 2 keine neuen Konto-Reiter |
| 10 | **Atomare Grenzen als Muster**: `INSERT … SELECT … WHERE (Zählung) < n` bzw. bedingtes `UPDATE … WHERE state = ?` und Prüfung von `meta.changes` | Klasse Nebenläufigkeit | XS | relevant für Kapazität (Phase 5) |

Nebenbefund zu Phase 2 (gelesen, nicht angefasst): `sx-post-composer` und `sx-compose` bestehen nebeneinander. Die
reach-Bedingung steht als `shareReachIn` in `worker/activity.ts` und als `REACHES_HARBOR` in `worker/harbors.ts`;
`0030_post_reach.sql` ist noch nicht committet. Die Hinweise sind an die Phase-2-Sitzung weitergegeben.

## (e) Entwicklungszeit (Stand 02.11.2026)

Frage des Betreibers: Wo geht Entwicklungszeit verloren, und wie lässt sie sich verkürzen? Grundlage sind `git log` über
alle Branches, die Woodpecker-API (86 Pipelines vom 24.10. bis 02.11.), Messungen in diesem Worktree und die
Beobachtungen des Koordinators vom 02.11. (fünf parallele Agenten).

**Messwerte**

| Größe | Wert |
|---|---|
| Commits / Merges (alle Branches) | 173 / 46. Spitzentag 27.10.: 61 Commits, 40 Pipelines |
| Review-Fix-Commits | 34, verteilt auf 33 Features: Praktisch **jedes Feature hatte mindestens eine Review-Runde** mit Fixes, Commit und Merge |
| Inhalt der Review-Fixes | 32 von 34 ändern Tests, 30 ändern Docs, 5 ändern `legal.ts`. Wiederkehrend: Löschweg ohne Test (Zusammenführen, Übergabe, Altbestand), Datenschutztext ≠ Löschweg, Betrachterabhängiges im öffentlichen Cache, Doppel-Einstiege (N1), Tippziele < 44 px, veraltete Querverweise |
| Sammeldateien (Commits, die sie ändern) | `REQUIREMENTS.md` 84, `CONCEPT.md` 69, `app.ts` 56, `api.ts` 44, `app.test.ts` 31. Dazu 4 Migrations-Umbenennungen und 2 F-ID-Umnummerierungen |
| Pipeline (NUC) | Median 66 s, p90 111 s, max. 274 s. Davon `check` (Typecheck, Tests, Build) ≈ 70 s, Wartezeit in der Warteschlange ≈ 6 s. 19 von 86 nicht erfolgreich (11 Fehler, 5 abgebrochen durch neueren Push, 3 Fehler der Umgebung) |
| Lokal (Windows) | volle Tests 222 s ohne Last, 356 s bei parallelen Agenten (einmal mit Zeitüberschreitung). Typecheck 81 s unter Last. `npm run check` damit **5–8 min**, also etwa 5-mal so lange wie in der Pipeline. `vitest related` für eine Komponente: 17 s |
| Umgebung | `npm ci` je Worktree dauert einige Minuten. Mit Junction scheiterte `npm run check` an „Denied ID … leaflet.css?inline“ (inzwischen behoben). `ERR_RUNTIME_FAILURE` von workerd unter Last führte zu wiederholten Volläufen |

**Wo die Zeit hingeht**, geordnet nach Wirkung:

1. **Review-Schleifen.** Fertig, Review, Fixes, `check`, Merge. Die meisten Befunde hätte der Bauende mit einer festen
   Liste selbst gefunden.
2. **Lokale Volläufe.** Mehrere `npm run check` je Agent, jeweils 5–8 min. Wiederholt wurden sie oft nur wegen Flakes
   unter Last, obwohl die Pipeline denselben Check bei jedem Push in rund 70 s macht.
3. **Konflikte in Sammeldateien und Nummern-Kollisionen.** Alle Agenten hängen Abschnitte ans Ende von `CONCEPT.md` und
   `REQUIREMENTS.md` an und vergeben Nummern ohne Absprache.
4. **Große Sammel-Releases.** Fünf Features in einem Deploy machen Review und Integration teurer, und nachgereichte
   Wünsche müssen in laufende Agenten eingefädelt werden.
5. **Abstimmung über den Betreiber.** Wer welche Querschnitte berührt, ist nirgends für alle sichtbar.

**Maßnahmen und geschätzte Ersparnis** (umgesetzt in `CLAUDE.md`, `scripts/` und `docs/ROADMAP.md` → Prozess):

| Maßnahme | Ersparnis (grob) |
|---|---|
| Selbstprüfung „Vor Abgabe“ mit den sechs wiederkehrenden Befundklassen; der Review prüft nur noch nach | ~15–25 min je Feature (etwa jede zweite Review-Runde entfällt; eine Runde kostet 30–45 min) |
| Test-Strategie: lokal Typecheck und betroffene Dateien, ein Vollauf vor Abgabe, danach ist die Pipeline das Gate; Flake einzeln bestätigen; gezielter Start-Retry in `worker-harness.ts` | ~10–15 min je Agent (2–3 Volläufe à 5–8 min weniger) |
| Docs konfliktarm (`docs/concept/NN-name.md`, F-ID-Block) und Reservierungen mit Spalte „Berührt“ | ~10–20 min je Integration, keine Umnummerierungen mehr. Weniger Abstimmung über den Betreiber |
| `scripts/new-worktree.ps1` / `remove-worktree.ps1` mit Junction und Vite-Freigabe | ~3–5 min je Agent, dazu kein Risiko mehr, ein fremdes `node_modules` zu leeren |
| Ein Feature je Deploy; nachgereichte Wünsche in die Roadmap | Kürzere Reviews, Konflikte bleiben klein. Die Wartezeit bis live sinkt um Stunden statt Minuten |
| Review ab dem ersten vollständigen Commit | ~10–15 min Wartezeit je Feature, weil Review und Doku parallel laufen |
