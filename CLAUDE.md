# Sail Explorer – Hinweise für Agenten

Grundlagen: `docs/PRINCIPLES.md`, `docs/CONCEPT.md`, `docs/REQUIREMENTS.md` (Tests nach F-IDs benannt).
Ein Push auf `main` deployt die Produktion (segeln-potsdam.de) samt D1-Migrationen; andere Branches landen als
öffentliche Vorschau unter `dev-<branch>.segeln-potsdam.de`.

## Vor dem ersten Code: Architektur-Skizze

Jedes Feature, das Daten speichert oder mehr als eine Komponente berührt, beginnt mit einer kurzen Skizze im
Konzept-Abschnitt (`docs/CONCEPT.md`, höchstens eine Tabelle), geprüft gegen `docs/PRINCIPLES.md` (insbesondere
„Erweitern“):
1. **Datenmodell** – neue Art von `posts` oder Erweiterung eines bestehenden Objekts? Tabellen/Spalten, reservierte
   Migrationsnummer (gleich als Datei committen).
2. **Querschnitte** – welche davon werden berührt: Sichtbarkeit/Sperre (welche SQL-Bausteine), Publikum im Stream
   (welche Ziel-Funktion), Caches, Zähler/Kontingente, Benachrichtigungen, Einbettungen, Admin/Moderation, Zusammenführen.
3. **Lösch- und Sichtbarkeitspfade** – Tabelle „gespeichert → entfernt auf welchem Weg“ (wie Konzept 21.3.3) und
   „wer sieht es wo“.
4. **Komponentenschnitt** – Seite, Controller, Komponenten, Events; welche geteilten Bausteine (`dialogStyles`, Sheet)
   genutzt werden; Verhalten bei 375 px.
5. **Parallele Arbeit** – welche anderen Branches dieselben Querschnitte anfassen (`git log --all -- <datei>`); dort
   vorher abstimmen statt nachher integrieren.

## Vor jedem Deploy: Review durch einen eigenen Agenten

Bevor etwas nach `main` gemergt oder gepusht wird, prüft ein separater Agent den Diff (`main...<branch>`) – nicht
der Agent, der es gebaut hat. Seine Befunde werden bewertet und die echten behoben, erst dann wird deployt.

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
   Logik im Template) und Mobil-Verhalten (Handy-Breite, Touch, Scrollen) mitdenken.

`npm run check` (Typecheck, Tests, Build) muss vorher grün sein.

## Deploy nur bei Bedarf

Nicht jedes fertige Feature sofort pushen: Push nach `main` (Produktion) und Branch-Pushes (Vorschau) nur, wenn es
nötig ist oder gewünscht wird. Sonst lokal committen, Review laufen lassen und Bescheid geben, dass es bereit ist.

## Lokale Arbeit

Jede Sitzung arbeitet in einem eigenen `git worktree` (eigener Ordner, eigener Branch, gemeinsames `.git`) – kein
Branch-Wechsel im selben Ordner. Für schnelle Runden gezielt testen (`npx vitest run <datei> -t "F-…"`), das volle
`npm run check` erst vor dem Commit.
Neue F-IDs vor der Vergabe in allen Branches suchen (`git grep -n "F-2.." $(git branch --format="%(refname:short)") -- docs/REQUIREMENTS.md`),
parallele Sitzungen kollidieren sonst.
