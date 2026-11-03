# Luv & Leute (vormals Sail Explorer) – Hinweise für Agenten

Grundlagen: `docs/PRINCIPLES.md`, `docs/CONCEPT.md` (neue Abschnitte in `docs/concept/`), `docs/REQUIREMENTS.md`
(Tests nach F-IDs benannt).
Was als Nächstes kommt und welche Nummern reserviert sind: `docs/ROADMAP.md` (einzige Quelle dafür).
Ein Push auf `main` deployt die Produktion (segeln-potsdam.de) samt D1-Migrationen; andere Branches landen als
öffentliche Vorschau unter `dev-<branch>.segeln-potsdam.de`.

## Vor dem ersten Code: Architektur-Skizze

Jedes Feature, das Daten speichert oder mehr als eine Komponente berührt, beginnt mit einer kurzen Skizze im
Konzept-Abschnitt (höchstens eine Tabelle), geprüft gegen `docs/PRINCIPLES.md` (insbesondere „Erweitern“):
1. **Datenmodell** – neue Art von `posts` oder Erweiterung eines bestehenden Objekts? Tabellen/Spalten, reservierte
   Migrationsnummer (gleich als Datei committen).
2. **Querschnitte** – welche davon werden berührt: Sichtbarkeit/Sperre (welche SQL-Bausteine), Publikum im Stream
   (welche Ziel-Funktion), Caches, Zähler/Kontingente, Benachrichtigungen, Einbettungen, Admin/Moderation, Zusammenführen.
3. **Lösch- und Sichtbarkeitspfade** – Tabelle „gespeichert → entfernt auf welchem Weg“ (wie Konzept 21.3.3) und
   „wer sieht es wo“.
4. **Komponentenschnitt** – Seite, Controller, Komponenten, Events; welche geteilten Bausteine (`dialogStyles`, Sheet)
   genutzt werden; Verhalten bei 375 px.
5. **Parallele Arbeit** – welche anderen Branches dieselben Querschnitte anfassen (`git log --all -- <datei>` und
   Spalte „Berührt“ in den Reservierungen); dort vorher abstimmen statt nachher integrieren.

**Nummern vor dem Start reservieren:** Wer parallele Aufträge vergibt, reserviert vorab je Auftrag einen F-ID-Bereich
(z. B. zehn Nummern), eine Konzept-Abschnittsnummer und ggf. eine Migrationsnummer und trägt sie mit Branch in die
Tabelle „Reservierungen“ in `docs/ROADMAP.md` ein (laufend fortschreiben, Erledigtes als „gemergt“ markieren).
Agenten vergeben nur Nummern aus ihrer Reservierung und prüfen vor jeder Vergabe gegen diese Tabelle; ohne Reservierung
erst nachfragen. Die `git grep`-Prüfung über alle Branches (unten, „Lokale Arbeit“) bleibt zusätzlich Pflicht. In der
Spalte „Berührt“ trägt der Agent zu Beginn die Querschnitte und geteilten Dateien seiner Skizze ein – so sehen parallele
Agenten Überschneidungen selbst, ohne Umweg über den Betreiber.

**Docs konfliktarm:** Ein neuer Konzept-Abschnitt ist eine eigene Datei `docs/concept/NN-name.md` (NN = reservierte
Abschnittsnummer); in `docs/CONCEPT.md` steht dafür nur eine Verweiszeile an der Stelle der Nummer. Bestehende Abschnitte
bleiben, wo sie sind. Neue Anforderungen kommen in `docs/REQUIREMENTS.md` als zusammenhängender Block mit den reservierten
F-IDs (nicht verstreut), Änderungen alter F-IDs an ihrer Stelle.

## Vor Abgabe: Selbstprüfung des bauenden Agenten

Bevor der Bauende „fertig“ meldet, prüft er selbst – das sind die häufigsten Review-Befunde
(`docs/ARCHITECTURE-RETRO.md`, „Entwicklungszeit“). Der Review-Agent prüft danach nur nach.
1. **Löschwege mit Test:** jeder Weg aus der Skizze (einzeln, Eltern-Objekt, Konto, Zusammenführen von Konten/Häfen,
   Übergabe/Eigner-Wechsel, Moderation, Frist) hat einen Test; bei Migrationen ein Test mit Altbestand.
2. **Datenschutztext:** `src/content/legal.ts` nennt neue Daten, Fristen und Löschwege so, wie der Code sie umsetzt.
3. **Cache:** nichts Betrachterabhängiges (Mitgliedschaft, Rolle, Vorschau, eigene Inhalte) in einer öffentlich
   gecachten Antwort; Test „Gast sieht es nicht, auch nicht nach einem Abruf eines Mitglieds“.
4. **Ein Einstieg (UX N1):** kein zweiter Knopf/Link für eine vorhandene Aufgabe; Nennungen als Link (N3).
5. **Mobil:** 375 px mit `scripts/mobile-overflow.js` ohne Befund, Tippziele ≥ 44 px.
6. **Docs:** F-IDs in `REQUIREMENTS.md` mit Test, Konzept-Datei aktuell, Querverweise (Abschnittsnummern, Dateinamen,
   F-IDs) in geänderten Docs und Kommentaren stimmen (`git grep` nach alten Namen).
7. Typecheck und das volle `npm run check` einmal grün (siehe „Lokale Arbeit“).

## Vor jedem Deploy: Review durch einen eigenen Agenten

Bevor etwas nach `main` gemergt oder gepusht wird, prüft ein separater Agent den Diff (`main...<branch>`) – nicht
der Agent, der es gebaut hat. Seine Befunde werden bewertet und die echten behoben, erst dann wird deployt. Der Review
darf schon auf dem ersten vollständigen Commit (Code und Tests der Kernfunktion) starten, während der Bauende Doku,
Randfälle und Selbstprüfung abschließt; der Nachtrag wird danach nur noch als Diff seit dem geprüften Commit angesehen.

Prüfpunkte:
1. **Komplexität** – ist etwas komplizierter als nötig? Gibt es einen einfacheren Weg?
2. **Konflikte** – mit anderen Branches oder Sitzungen, mit bestehenden Regeln, Konzept-Entscheidungen,
   Migrationen; widersprüchliches Verhalten.
3. **Wiederverwendung vor Neuentwicklung** – vorhandene Helfer, Komponenten und Muster genutzt statt dupliziert?
4. **Modularisierung** – klare Modulgrenzen, reine Regeln in `src/domain`, keine Gottdateien.
5. **Architekturprinzipien** – `docs/PRINCIPLES.md` (auch „Erweitern“), fail closed, ein Löschpfad je Objekt,
   Sichtbarkeit beim Lesen prüfen, Tests je F-ID; stimmt der Code mit der Architektur-Skizze überein?
6. **Löschkonzept** – wird alles, was das Feature speichert (D1-Zeilen, R2-Dateien, Zähler), auf jedem Weg wieder
   entfernt: ersetzt (alte Datei), einzeln gelöscht, Eltern-Objekt gelöscht (Törn, Boot, Gruppe, Hafen), Konto gelöscht,
   inaktives Konto entfernt, Aufbewahrung abgelaufen (Saison), Moderation? Bleibt der Speicherzähler stimmig? Gibt es
   einen Test dafür? Datenschutz-Fristen (`src/content/legal.ts`) und Konzept passen dazu.
7. **Anforderungen dokumentiert** – ist jedes neue oder geänderte Verhalten als funktionale Anforderung mit F-ID in
   `docs/REQUIREMENTS.md` beschrieben (und im Konzept, wo es Entscheidungen gibt), gibt es zu jeder F-ID einen Test, und
   stimmen geänderte alte Anforderungen noch mit dem Code überein?
8. **Frontend in Komponenten** – UI gehört in Lit-Komponenten (`src/components`), gemeinsame Stile und Verhalten in
   geteilte Bausteine (`shared.ts`, z. B. `dialogStyles`) statt Kopien je Komponente; `app.ts`/`app.css` nur für
   Verdrahtung und Seitenraster. Bewährte Muster nutzen (Properties rein, Events raus, Controller für Abläufe, keine
   Logik im Template) und Mobil-Verhalten (Handy-Breite, Touch, Scrollen) mitdenken. **Verbindlich:** Jede geänderte
   Seite und jeder geänderte Dialog wird bei 375 px Breite geprüft – kein Element ragt über den rechten Rand, die Seite
   scrollt nicht seitlich, Elemente werden schmal genug. Gewollte seitliche Scroll-Bereiche (Slider, Reiter-/Filterleisten,
   Diagramm-Großansicht) tragen `data-scroll-x`. Prüfen mit `scripts/mobile-overflow.js` (im Browser per
   `javascript_tool` oder in der Konsole; Ergebnis `ok: true`, sonst Selektor, Breite, rechte Kante).

`npm run check` (Typecheck, Tests, Build) muss vorher grün sein.

## Auslieferung: Branch → Vorschau → `main`

Deployt wird nur bei Bedarf oder auf Wunsch; bis dahin lokal committen und Bescheid geben, dass es bereit ist. Geliefert
wird **ein Feature je Deploy**, sobald es fertig, reviewt und unabhängig ist – kein Sammel-Release mehrerer Features.
Wünsche, die während des Baus nachkommen, gehen in `docs/ROADMAP.md` (bzw. Notion) und in den nächsten Durchgang, außer
sie betreffen den laufenden Bau direkt. Soll es live gehen, immer dieser Weg – nie direkt ungeprüft auf `main`:
1. `npm run check` lokal grün, dann den Branch pushen. Woodpecker prüft ihn (Typecheck, Tests, Build) und stellt die
   Vorschau `dev-<branch>.segeln-potsdam.de` bereit (eigene Datenbank, ohne Anmeldung).
2. Währenddessen läuft der Review-Agent (oben). Befunde beheben, erneut pushen.
3. Erst wenn die Branch-Pipeline grün ist und die Vorschau lädt (Startseite, geänderte Seiten, mobil bei 375 px mit
   `scripts/mobile-overflow.js` ohne Befund – nichts ragt rechts heraus, kein seitliches Scrollen außer `data-scroll-x`): nach `main`
   mergen und pushen. Die Pipeline wendet die Migrationen an und deployt; danach die Produktion kurz prüfen (Bundle
   enthält die Änderung, betroffene `/api/…` antworten).
4. Gemergte Branches auf `origin` löschen (`git push origin --delete <branch>`) und den lokalen Worktree mit
   `scripts/remove-worktree.ps1 <ordner>` entfernen (löst die `node_modules`-Junction mit `cmd /c rmdir`, dann
   `git worktree remove`). Die Vorschau räumt der Schritt `preview-prune` nach dem nächsten Produktions-Deploy ab.

## Lokale Arbeit

Jede Sitzung arbeitet in einem eigenen `git worktree` (eigener Ordner, eigener Branch, gemeinsames `.git`) – kein
Branch-Wechsel im selben Ordner. Anlegen mit `scripts/new-worktree.ps1 <branch> <ordner>`: kappt das Upstream, legt bei
gleichem `package-lock.json` eine `node_modules`-Junction an (`vite.config.ts` gibt deren echten Pfad frei; sonst bzw. mit
`-Install` eigenes `npm ci`) und nennt einen freien Vite-Port. Worktrees nie mit `Remove-Item -Recurse` löschen (leert
das Junction-Ziel), sondern wie in „Auslieferung“ Schritt 4.

**Tests:** Während der Arbeit nur Typecheck und betroffene Testdateien – gezielt (`npx vitest run <datei> -t "F-…"`) bzw.
`npx vitest related <geänderte src-Dateien> --run --mode test`. `related` findet Worker-Tests nicht (der Worker wird im
Test per esbuild gebündelt): bei Änderungen unter `worker/` die passenden `test/functional/*.test.ts` direkt nennen. Das
volle `npm run check` läuft **einmal** vor der Abgabe; danach ist die Branch-Pipeline das Gate (dort ~70 s statt lokal
5–8 min) – nicht lokal wiederholen, nur um einen Push abzusichern. Ein Fehler nur unter Last (Zeitüberschreitung,
`ERR_RUNTIME_FAILURE`) wird mit der einzelnen Datei bestätigt, nicht mit einem zweiten Volllauf.

Neue F-IDs vor der Vergabe in allen Branches suchen (`git grep -n "F-2.." $(git branch --format="%(refname:short)") -- docs/REQUIREMENTS.md`),
parallele Sitzungen kollidieren sonst.
