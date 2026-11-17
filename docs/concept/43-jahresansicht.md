# 43. Jahresansicht der Fahrten und Regatten im Profil (F-665 … F-669, 17.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 43). Wunsch des Betreibers (17.11.2026): *„Neben den Posts braucht es
für die Benutzer im Profil zur eigenen Ansicht und ggf. sichtbar machbar eine tabellarische Jahresansicht der Fahrten
und Regatten.“* Umgesetzt nach den Empfehlungen (autonom).

## 43.1 Architektur-Skizze

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Kein neues Objekt: die Ansicht wird aus dem Fahrtenbuch gerechnet (eigene und Crew-Törns, Regatta-Angaben aus Konzept 42). Neu ist nur der Schalter `profiles.season_table` (`private` Standard · `public`, Migration `0052_season_table.sql`) |
| Querschnitte | Sichtbarkeit: für sich selbst alles aus dem Fahrtenbuch (ohne Ausgeschlossene, Crew nach M1); für andere nur bei `public` und nur, wer das Profil sehen darf (öffentlich, „Nur mit Link“ mit Schlüssel) – und dann nur **öffentliche**, nicht ausgeblendete/gesperrte, im Fahrtenbuch stehende Einträge; Crew-Törns wie „Mitgesegelt“ (öffentlich); Boot nur, wenn öffentlich (F-82). Caches: `private, no-store`. Stream, Benachrichtigungen, Kontingente: unberührt |
| Komponentenschnitt | Reine Regeln `src/domain/season-table.ts` (Summen je Saison wie `seasonOf`, Fahrten einer Saison). Worker `worker/season-table.ts` (`GET /api/profiles/:handle/seasons`, `PUT /api/me/season-table`). Oberfläche: `sx-season-table` (Saison-Tabelle, Fahrten der gewählten Saison, Schalter), Abschnitt auf der Profilseite nach den Beiträgen; Ablauf `controllers/season-table.ts`, Client-API `services/season-table-api.ts`. Mobil: Tabellen in `data-scroll-x`-Bereichen, Saison-Knöpfe 44 px |
| Parallele Arbeit | keine (gleicher Branch wie 41/42) |

## 43.2 Inhalt

| Teil | Spalten |
| --- | --- |
| Je Saison | Saison · Fahrten · sm · davon aufgezeichnet · Regatten · bester Platz |
| Fahrten der gewählten Saison | Datum · Fahrt (Link, Crew markiert) · sm (* = angegeben) · Boot · Rolle · Regatta mit Platz und Details |

Die eigene Ansicht ersetzt „Mein Fahrtenbuch“ nicht (dort Filter, Zusatzangaben, Punkte, CSV, Druck) – sie ist die
schnelle Jahresübersicht auf dem Profil. Ein Einstieg je Aufgabe (N1): exportiert wird weiter im Fahrtenbuch.

## 43.3 Lösch- und Sichtbarkeitspfade (F-669)

| Gespeichert | entfernt auf welchem Weg |
| --- | --- |
| `profiles.season_table` | mit dem Profil (Konto löschen, inaktives Konto, Moderation über das Profil); zurück auf „nur ich“ jederzeit |
| Zeilen der Ansicht | nichts gespeichert – Einträge verschwinden mit dem Törn (alle Löschwege), beim Ausschließen aus dem Fahrtenbuch, bei Wechsel auf nicht öffentlich (für andere) |

| Wer | sieht |
| --- | --- |
| die Person selbst | immer, alle Fahrten aus dem Fahrtenbuch (auch nicht öffentliche und Crew-Törns nach M1) |
| andere mit Zugriff auf das Profil | nur bei Freigabe, nur öffentliche Fahrten; private Boote ohne Namen |
| sonst | 404, auch bei Freigabe, solange das Profil für sie nicht sichtbar ist |
