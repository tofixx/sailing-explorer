# Prinzipien

Diese Prinzipien gelten für jede Änderung am Sail Explorer. Bei Zielkonflikten
gilt die Reihenfolge innerhalb eines Abschnitts.

## Design

1. **Karte zuerst.** Die Karte ist das Produkt. UI-Chrome bleibt schmal, Panels
   ordnen sich der Karte unter, nichts verdeckt den Track ohne Grund.
2. **Eine Farbe = eine Bedeutung.** Wind ist immer `--c-wind`, Böen `--c-gust`,
   Wellen `--c-wave`, Speed `--c-speed` – in Karte, Diagramm, Kompass, Legende.
   Farben kommen ausschließlich aus Tokens (`src/styles/tokens.css`), auch im
   Canvas.
3. **Hell und dunkel sind gleichwertig.** Jede Fläche, jedes Diagramm und jedes
   Karten-Control funktioniert in beiden Schemata.
4. **Daten ehrlich zeigen.** Jede Zahl hat eine Einheit, jede Quelle wird
   genannt, Lücken und GPS-Ausreißer werden sichtbar markiert statt
   weggeglättet.
5. **Alles ist verknüpft.** Hover in Karte, Diagramm oder Kennzahl zeigt
   denselben Zeitpunkt überall gleichzeitig.
6. **Zugänglich by default.** Bedienbar per Tastatur, sichtbarer Fokus,
   semantische Elemente, `prefers-reduced-motion` wird respektiert,
   Icons statt Emojis, Texte mit ausreichend Kontrast.
7. **Mobil ist kein Sonderfall.** Ab < 760 px wird die Seitenleiste zum
   Bottom-Sheet, Touch-Ziele sind ≥ 40 px. Jeder Dialog und jedes Menü nutzt
   `dialogStyles` bzw. das Sheet-Muster aus `shared.ts` (mobil randlos bzw. von
   unten, Fokus bleibt im Dialog, Escape schließt) – keine eigenen Dialog-Stile.
   Neue Oberflächen werden bei 375 px Breite geprüft, und es ist festgelegt,
   was in Einbettungen (`/embed`) fehlt.

## Architektur

1. **Schichten mit klarer Richtung:**
   `domain` (rein, ohne DOM) → `services` (Netzwerk, Store) →
   `map` / `components` (Darstellung) → `main.ts` (Verdrahtung).
   Untere Schichten importieren nie aus oberen.
2. **Ein Zustand, eine Quelle.** Der App-Zustand liegt im Store; Komponenten
   bekommen Daten als Properties und melden Absichten als Events.
   Komponenten fetchen nicht und kennen Leaflet nicht.
3. **Komponenten sind klein und präsentational** (Lit Web Components mit
   Shadow DOM). Gemeinsames wie das Zeit-Diagramm existiert genau einmal.
4. **Progressive Enhancement.** Ohne Backend funktioniert alles außer dem
   Server-Teilen (Fallback: Link mit eingebetteten Daten für kleine Tracks).
   Ohne Wetter-API funktioniert alles außer Wind/Wellen.
5. **Domain-Logik ist getestet.** Parser, Statistik, Ausreißer-Erkennung,
   Zeitsegmentierung und Worker-Validierung haben Unit-Tests; CI blockiert bei
   roten Tests oder Typfehlern.
6. **Billig im Betrieb.** Der Worker macht nur, was der Client nicht kann
   (Speichern, Ausliefern, Vorschau-Metadaten). Rechenarbeit passiert im
   Browser – so bleibt alles im Cloudflare-Free-Tier.
   Daten haben ein Ablaufdatum: Ein nächtlicher Cron löscht, was nicht mehr
   gebraucht wird, in kleinen Portionen pro Lauf. Auch zahlende Konten haben
   feste Obergrenzen.
7. **Erweiterbar ohne Tabellenneubau.** Rollen und Sichtbarkeiten prüft
   `worker/validate.ts`, nicht ein SQL-`CHECK` (SQLite ändert Constraints nur
   per Neubau). Eigentum ist explizit (`owner_id`/`user_id`), weitere
   Berechtigte stehen in eigenen Tabellen (z. B. `boat_admins`).

## Erweitern

Regeln für neue Features, abgeleitet aus `docs/ARCHITECTURE-RETRO.md`. Sie
gelten ab der Architektur-Skizze (`CLAUDE.md`), nicht erst im Review.

1. **Neue Inhalte sind eine Art von `posts`, kein eigenes Objekt.** Autor,
   Heimatverlauf, Sichtbarkeit, „Sichtbar bis“, Stream, Pins und Löschen kommen
   vom Dach (Konzept 21); die Art bringt nur ihre Nutzlast (Untertabelle mit
   `post_id … ON DELETE CASCADE`) und einen lesbaren `body` als Rückfall mit.
   Vorbild: Fahrtenbuch als `shares.source` statt eigener Tabelle (Konzept 19, K1).
2. **Eine Regel, ein Modul – auch in SQL.** Sichtbarkeit, Sperre, Reichweite und
   Zählregeln stehen einmal als reine Funktion in `src/domain` und einmal als
   SQL-Baustein in einem `worker/*-sql.ts` (Vorbild `IN_LOGBOOK_SQL`). Neue
   Listen, Streams und Kennzahlen nutzen die Bausteine (`visible-sql.ts`:
   `publicSql`, `liveSql`, `notSuspendedSql`; `reach-sql.ts`, `member-sql.ts`).
   Literale wie `visibility = 'public'` oder `hidden_at IS NULL` werden nicht
   neu kopiert (Sperrklinke im Test, F-454). Ein Test hält Domain-Regel und
   SQL-Baustein gleich.
3. **Öffentliche Caches nur für Antworten, die für alle gleich sind.** Was vom
   Betrachter abhängt („Nur Mitglieder“, Schlüssel, Vorschau, eigene Rechte),
   wird `private, no-store` ausgeliefert. Die Verzögerung des Caches nach dem
   Herabstufen (60 s) steht im Konzept.
4. **Publikum aus einer Funktion.** Die Ziele eines Inhalts im Aktivitäts-Log
   berechnet je Inhalt genau eine Funktion aus dem aktuellen Zustand. Jede
   Änderung (Sichtbarkeit, Gruppen, Reichweite, Boot, Hafen, Austritt) baut sie
   damit vollständig neu auf und behält die Zeit der Aktivität. Es gibt keine
   Differenz-SQL je Änderungsart.
5. **Löschen ist registriert, nicht erinnert.** Bezüge ohne Fremdschlüssel
   (`subject_kind`, `target_kind`, `channel_kind`, R2-Schlüssel, Zähler) haben je
   Art eine Aufräumfunktion, die alle Löschwege (einzeln, Eltern-Objekt, Konto,
   inaktiv, Ablauf, Moderation, Zusammenführen) aufrufen. R2-Schlüssel und
   Zähleranteile werden vor einem Cascade eingesammelt. Für jeden Weg gibt es
   einen Test. Jede Tabelle, jede Spalte `*_kind` und jedes R2-Präfix steht im
   Lösch-Register `worker/cleanup-registry.ts` – zuerst dort eintragen, der
   Test gegen das Schema (F-451 … F-453) wird sonst rot.
6. **Migrationen: Nummer zuerst reservieren, nur additiv.** Vor dem ersten Code
   die nächste freie Nummer über alle Branches prüfen (`git ls-tree <branch>
   migrations/`) und sofort eine Datei `00NN_name.sql` committen. Eine
   deployte Migration wird nie umbenannt. Tabellen-Neubauten sind eine eigene
   Phase mit `PRAGMA defer_foreign_keys` und einem Migrations-Test.
7. **Grenzen und Zustandswechsel sind atomar.** Kontingente, Kapazitäten,
   Fehlversuche und Annahmen werden in einer SQL-Anweisung geprüft und
   geschrieben (`INSERT … SELECT … WHERE`, bedingtes `UPDATE`, `meta.changes`
   auswerten), nie erst gelesen und dann geschrieben.
8. **Frontend-Schnitt: Seite → Controller → Komponenten.** Ein Ablauf (Laden,
   Speichern, Schritte, `busy` gegen Doppelklick) gehört in einen Controller
   unter `src/controllers`. Seiten und Karten bekommen Properties und melden
   Events. `app.ts` registriert nur Route und Event. Dialoge und Abläufe werden
   über ein Event geöffnet (z. B. `sx-compose-open`), nicht über Verweise
   zwischen Komponenten. Ein Formular gibt es einmal, nicht je Einstieg.
9. **Neue Features bringen eigene Testdateien mit** (`test/functional/<bereich>.test.ts`)
   statt Sammeldateien wie `app.test.ts` zu verlängern.

## Security

1. **Daten bleiben lokal, bis der Nutzer teilt.** Hochgeladen wird nur nach
   ausdrücklichem Klick, mit Hinweis, dass Positionen und Zeitstempel
   öffentlich über den Link einsehbar sind.
2. **Alles Fremde ist untrusted** – GPX-Dateien, geteilte Daten, API-Antworten.
   Keine `innerHTML`-Konkatenation mit Fremddaten; Lit-Templates escapen,
   Leaflet-Tooltips bekommen escapte Strings. DOCTYPE/ENTITY in GPX wird
   abgelehnt.
3. **Strikte CSP.** Keine Inline-Skripte, keine CDNs; alle Abhängigkeiten
   werden gebündelt. Erlaubte Fremd-Hosts (Kacheln, Open-Meteo) stehen
   explizit in der Policy.
4. **Grenzen überall.** Max. Upload-Größe, max. Tracks, max. Länge von Titeln,
   Dekompressions-Limit auch im Client (gegen Zip-Bombs), Rate-Limit pro IP.
5. **Unratbare IDs, klare Eigentümer.** IDs mit ≥ 96 Bit Zufall. Jede
   Freigabe und jedes Boot hat einen Eigentümer; Ändern/Löschen nur durch ihn
   (bzw. Boots-Admins), fremde Objekte verhalten sich wie nicht existent (404).
   Session- und Login-Tokens liegen serverseitig nur als SHA-256-Hash.
6. **Fail closed.** Ohne echten Mailversand oder ohne Bot-Schutz verweigert
   der Server in Produktion die Anmeldung, statt still zu degradieren.
   Magic Links werden erst nach Bestätigung („Als … anmelden?“) eingelöst –
   Schutz gegen untergeschobene Links. Ohne Stripe-Schlüssel und Webhook-Secret gibt es
   kein Unterstützen-Angebot; freigeschaltet wird ausschließlich über einen
   signierten Webhook, nie über eine Angabe des Clients.
7. **Least privilege in CI.** Der Cloudflare-API-Token darf nur Workers und
   R2 dieses Accounts; Secrets nur im Deploy-Schritt und nur auf `main`.
8. **Eine Ausnahme pro Regel, benannt.** Mutationen verlangen Same-Origin –
   einzige Ausnahme ist `POST /api/webhooks/stripe`, die stattdessen per
   HMAC-Signatur (Vergleich in konstanter Laufzeit, max. 5 min alt) geprüft wird.
