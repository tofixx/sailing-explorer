# Funktionale Anforderungen

Jede Anforderung hat eine ID; Tests referenzieren sie im Testnamen (z. B. `[F-03]`).

## Tracks laden & auswerten

- **F-01** GPX-Dateien (eine oder mehrere) per Dateiauswahl oder Drag & Drop laden; Track-, Routen- oder Wegpunkte werden erkannt.
- **F-02** Ungültige Dateien (kein GPX, kaputtes XML, DOCTYPE/ENTITY, < 2 Punkte) werden mit verständlicher Meldung abgelehnt; gültige Dateien im selben Vorgang werden trotzdem geladen.
- **F-03** Pro Track: Distanz (sm), Fahrzeit (h), Ø-Speed, Max-Speed (kn) aus den Zeitstempeln.
- **F-04** GPS-Ausreißer werden erkannt, aus Statistik und Max-Speed entfernt und in der Trackliste gezählt.
- **F-05** Tracks ohne Zeitstempel funktionieren (Distanz, Karte), Wetter wird dann nicht zugeordnet – mit Hinweis.
- **F-06** Beispiel-Tracks lassen sich aus dem Startbildschirm öffnen; `?track=<name>` lädt Dateien nur aus `/tracks/`.

## Karte & Darstellung

- **F-10** Track auf OpenStreetMap/OpenSeaMap, Start/Ziel markiert, Karte zoomt auf die Tracks.
- **F-11** Einfärbung nach Speed, Wind, Böen oder Wellen; Metriken ohne Daten sind deaktiviert; Legende zeigt Bereich und Einheit.
- **F-12** Ebenen schaltbar: Seezeichen, Wassertiefe, Windfähnchen, Wellenpfeile.
- **F-13** Hover auf Karte, Diagramm oder Max-Kennzahl zeigt denselben Zeitpunkt überall (Karte, Bedingungen, beide Diagramme).
- **F-14** Diagramme trennen Pausen zwischen Etappen statt sie zu überbrücken; Speed-Diagramm zeigt den Median.
- **F-15** Tracks lassen sich ein-/ausblenden und entfernen; Kennzahlen und Diagramme beziehen sich auf sichtbare Tracks.
- **F-16** Hell- und Dunkelmodus, Bedienung per Tastatur, mobil als Bottom-Sheet.

## Wetter

- **F-20** Wind (Forecast, sonst Archiv) und Seegang (Marine) von Open-Meteo für Zeitraum und Gebiet des Tracks, stündlich, jedem Punkt zugeordnet.
- **F-21** Ohne Netz/Daten bleibt die App benutzbar; der Status erklärt, warum Daten fehlen.

## Sitzung, Konto, Teilen

- **F-30** Gast-Sitzung: geladene Tracks bleiben lokal (IndexedDB) und werden beim nächsten Besuch wiederhergestellt; ein Hinweis zeigt „nur dieses Gerät“. Ohne Teilen verlässt nichts das Gerät.
- **F-31** Teilen persistiert auf dem Server und setzt eine Anmeldung voraus. Nicht angemeldet → Anmeldedialog, danach geht es direkt mit dem Teilen weiter.
- **F-32** Anmeldung per Magic Link: E-Mail eingeben → Link (15 min, einmalig) → Klick meldet an, auch im ursprünglichen Tab. Antwort verrät nicht, ob ein Konto existiert. Begrenzung pro Adresse und IP.
- **F-33** Freigabe: Titel, Sichtbarkeit „Alle mit dem Link“ oder „Nur ich“, optional aktuelle Ansicht (Einfärbung, Ebenen). Ergebnis: Link `/s/<id>` zum Kopieren/Teilen.
- **F-34** Geteilte Links öffnen eine vollständig interaktive Ansicht (Karte, Wetter, Diagramme, Hover), ohne Anmeldung (außer „Nur ich“). Der Ansichtszustand steht in der URL (`?m=…&l=…`).
- **F-35** Private Freigaben sind für andere nicht von gelöschten/unbekannten unterscheidbar (404).
- **F-36** „Meine Tracks“: eigene Freigaben auflisten, öffnen, Link kopieren, umbenennen, Sichtbarkeit ändern, löschen (mit Bestätigung).
- **F-37** Konto: abmelden; Konto löschen entfernt Sessions, Freigaben und Dateien.
- **F-38** Fremde Freigaben lassen sich nicht ändern oder löschen.
- **F-39** Link-Vorschau (Messenger) zeigt Titel und Kurzinfo öffentlicher Freigaben, private bleiben neutral.
- **F-41** Profil: Angemeldete legen ein Profil mit Profiladresse (`/u/<name>`), Anzeigename und Bio an; standardmäßig privat. Die E-Mail-Adresse erscheint nie öffentlich. Reservierte und vergebene Namen werden abgelehnt.
- **F-42** Boote: Angemeldete legen Boote an (Name, Typ, Länge, Segelnummer, Heimathafen optional, Beschreibung, Sichtbarkeit). Jedes Boot hat genau einen Eigner; weitere Admins sind im Modell vorgesehen. Bearbeiten dürfen Eigner und Admins, löschen nur der Eigner – Törns bleiben dabei erhalten.
- **F-43** Jede Freigabe hat einen Eigentümer (den Hochladenden) und kann einem Boot zugeordnet werden, das man verwalten darf.
- **F-44** Sichtbarkeit einer Freigabe: „Öffentlich“ (auf Profil- und Bootsseite gelistet), „Mit Link“, „Nur ich“.
- **F-45** Profil- und Bootsseiten zeigen Kennzahlen (Seemeilen, Törns) und die öffentlichen Törns; private Seiten sind für andere 404.
- **F-46** Link-Vorschau für öffentliche Profil- und Bootsseiten; diese dürfen indexiert werden, geteilte Törns nicht.
- **F-40** Ohne Backend (statisches Hosting) funktioniert alles außer Server-Teilen; kleine Tracks können als Link mit eingebetteten Daten geteilt werden; alte `#g=`-Links funktionieren weiter.

## Unterstützen

- **F-60** Kontingent: Ein Konto (eine E-Mail-Adresse) speichert bis zu 3 Freigaben kostenlos (`FREE_SHARES`). Ab der 4. braucht es den Unterstützer-Status, sonst lehnt der Server vor dem Upload mit 402 `supporter_required` und deutscher Meldung ab. Bestehende Freigaben bleiben erhalten, auch wenn es schon mehr sind; Löschen schafft Platz. `GET /api/me/support` liefert `supporter`, `sharesUsed`, `sharesFree`.
- **F-61** „Kaffee/Bier ausgeben“: Bezahlt wird über Stripe-Payment-Links mit `client_reference_id` = Konto-ID. Freigeschaltet wird nur durch den Webhook `checkout.session.completed` (bzw. `…async_payment_succeeded`) an `POST /api/webhooks/stripe` mit gültiger Signatur (HMAC-SHA256, max. 5 min alt). Doppelte Zustellung zählt einmal, unbekannte Konten und andere Ereignisse werden ignoriert. Nur diese Route ist von der Origin-Prüfung ausgenommen. Unterstützungen bleiben bei Kontolöschung ohne Bezug zum Konto erhalten.
- **F-62** Fail closed: Ohne Webhook-Secret oder ohne Payment-Link gibt es keine Unterstützen-Knöpfe, der Webhook antwortet 503 und die 4. Freigabe wird mit verständlicher Meldung (älteren Törn löschen) abgelehnt.
- **F-63** Oberfläche: Unterstützen wird dezent angeboten (Teilen-Ergebnis, Konto). Teilen-Dialog und Konto zeigen „2 von 3 kostenlosen Freigaben genutzt“. Ist das Kontingent ausgeschöpft, zeigt „Teilen“ statt des Formulars eine Karte mit „Kaffee/Bier ausgeben“ (Payment-Link mit Konto-Zuordnung und vorausgefüllter E-Mail) und „Ich habe unterstützt – prüfen“. Unterstützer erhalten im Konto ein Abzeichen.

## Betrieb

- **F-50** Lokale Entwicklung mit `npm run dev`, erreichbar im LAN (Handy) inkl. Login.
- **F-51** CI prüft Typen, Tests und Build; Deploy nur vom Hauptzweig.
