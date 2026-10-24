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
   Bottom-Sheet, Touch-Ziele sind ≥ 40 px.

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
7. **Erweiterbar ohne Tabellenneubau.** Rollen und Sichtbarkeiten prüft
   `worker/validate.ts`, nicht ein SQL-`CHECK` (SQLite ändert Constraints nur
   per Neubau). Eigentum ist explizit (`owner_id`/`user_id`), weitere
   Berechtigte stehen in eigenen Tabellen (z. B. `boat_admins`).

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
   Schutz gegen untergeschobene Links. Ohne Webhook-Secret gibt es keine
   Unterstützen-Knöpfe; freigeschaltet wird ausschließlich über einen
   signierten Webhook, nie über eine Angabe des Clients.
7. **Least privilege in CI.** Der Cloudflare-API-Token darf nur Workers und
   R2 dieses Accounts; Secrets nur im Deploy-Schritt und nur auf `main`.
8. **Eine Ausnahme pro Regel, benannt.** Mutationen verlangen Same-Origin –
   einzige Ausnahme ist `POST /api/webhooks/stripe`, die stattdessen per
   HMAC-Signatur (Vergleich in konstanter Laufzeit, max. 5 min alt) geprüft wird.
