# Sail Explorer – Hinweise für Agenten

Grundlagen: `docs/PRINCIPLES.md`, `docs/CONCEPT.md`, `docs/REQUIREMENTS.md` (Tests nach F-IDs benannt).
Ein Push auf `main` deployt die Produktion (segeln-potsdam.de) samt D1-Migrationen; andere Branches landen als
öffentliche Vorschau unter `dev-<branch>.segeln-potsdam.de`.

## Vor jedem Deploy: Review durch einen eigenen Agenten

Bevor etwas nach `main` gemergt oder gepusht wird, prüft ein separater Agent den Diff (`main...<branch>`) – nicht
der Agent, der es gebaut hat. Seine Befunde werden bewertet und die echten behoben, erst dann wird deployt.

Prüfpunkte:
1. **Komplexität** – ist etwas komplizierter als nötig? Gibt es einen einfacheren Weg?
2. **Konflikte** – mit anderen Branches oder Sitzungen, mit bestehenden Regeln, Konzept-Entscheidungen,
   Migrationen; widersprüchliches Verhalten.
3. **Wiederverwendung vor Neuentwicklung** – vorhandene Helfer, Komponenten und Muster genutzt statt dupliziert?
4. **Modularisierung** – klare Modulgrenzen, reine Regeln in `src/domain`, keine Gottdateien.
5. **Architekturprinzipien** – `docs/PRINCIPLES.md`, fail closed, ein Löschpfad je Objekt, Sichtbarkeit beim Lesen
   prüfen, Tests je F-ID.
6. **Löschkonzept** – wird alles, was das Feature speichert (D1-Zeilen, R2-Dateien, Zähler), auf jedem Weg wieder
   entfernt: ersetzt (alte Datei), einzeln gelöscht, Eltern-Objekt gelöscht (Törn, Boot, Gruppe, Hafen), Konto gelöscht,
   inaktives Konto entfernt, Aufbewahrung abgelaufen (Saison), Moderation? Bleibt der Speicherzähler stimmig? Gibt es
   einen Test dafür? Datenschutz-Fristen (`src/content/legal.ts`) und Konzept passen dazu.
7. **Anforderungen dokumentiert** – ist jedes neue oder geänderte Verhalten als funktionale Anforderung mit F-ID in
   `docs/REQUIREMENTS.md` beschrieben (und im Konzept, wo es Entscheidungen gibt), gibt es zu jeder F-ID einen Test, und
   stimmen geänderte alte Anforderungen noch mit dem Code überein?

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
