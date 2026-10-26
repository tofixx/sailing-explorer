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
- **F-33** Freigabe: Titel, Sichtbarkeit (F-80, Standard „Öffentlich“), optional aktuelle Ansicht (Einfärbung, Ebenen). Ergebnis: Link `/s/<id>` bzw. bei „Nur mit Link“ `/s/<id>/<schlüssel>` zum Kopieren/Teilen. Eine unbekannte Sichtbarkeit wird mit 400 abgelehnt.
- **F-34** Geteilte Links öffnen eine vollständig interaktive Ansicht (Karte, Wetter, Diagramme, Hover), ohne Anmeldung (außer „Nur ich“; „Nur mit Link“ braucht den Schlüssel, F-90). Der Ansichtszustand steht in der URL (`?m=…&l=…`).
- **F-35** Private Freigaben sind für andere nicht von gelöschten/unbekannten unterscheidbar (404).
- **F-36** „Meine Tracks“: eigene Freigaben auflisten, öffnen, Link kopieren, umbenennen, Sichtbarkeit ändern, Link erneuern (F-92), löschen (mit Bestätigung).
- **F-37** Konto: abmelden; Konto löschen entfernt Sessions, Freigaben und Dateien.
- **F-38** Fremde Freigaben lassen sich nicht ändern oder löschen.
- **F-39** Link-Vorschau (Messenger) zeigt Titel und Kurzinfo öffentlicher Freigaben (und von „Nur mit Link“ über den gültigen Schlüssel-Link, F-85), private bleiben neutral.
- **F-41** Profil: Angemeldete legen ein Profil mit Profiladresse (`/u/<name>`), Anzeigename und Bio an; standardmäßig öffentlich (F-80). Speichern ohne Sichtbarkeit lässt eine bestehende Stufe unverändert. Die E-Mail-Adresse erscheint nie öffentlich. Reservierte und vergebene Namen werden abgelehnt.
- **F-42** Boote: Angemeldete legen Boote an (Name, Typ, Länge, Segelnummer, Heimathafen optional, Beschreibung, Sichtbarkeit nach F-80, Standard „Öffentlich“). Jedes Boot hat genau einen Eigner; weitere Admins sind im Modell vorgesehen. Bearbeiten dürfen Eigner und Admins, löschen nur der Eigner – Törns bleiben dabei erhalten.
- **F-43** Jede Freigabe hat einen Eigentümer (den Hochladenden) und kann einem Boot zugeordnet werden, das man verwalten darf.
- **F-44** Sichtbarkeit einer Freigabe: „Öffentlich“ (`public`, auf Profil-, Bootsseite und unter Entdecken gelistet), „Nur mit Link“ (`unlisted`), „Nur ich“ (`private`) – siehe F-80 ff. Die frühere Spalte `listed` wird nicht mehr gelesen.
- **F-45** Profil- und Bootsseiten zeigen Kennzahlen (Seemeilen, Törns) und die öffentlichen Törns; private Seiten und „Nur mit Link“ ohne gültigen Schlüssel sind für andere 404.
- **F-46** Link-Vorschau für öffentliche Profil- und Bootsseiten; Indexierung regelt F-84 (öffentliche Törns dürfen seit E2 ebenfalls indexiert werden).
- **F-47** Übersichtsbild: Der Törn lässt sich als Bild teilen oder herunterladen – ohne Anmeldung, im Browser erzeugt. Formate Querformat (1200×630) und Quadrat (1080×1080); Inhalte wählbar (Titel, Datum, Start & Ziel, Distanz, Dauer, Fahrt, Wind, Wellen, Legende, Seekarte). Die Angaben stehen in einem eigenen Randbereich und verdecken den Track nie.
- **F-48** Beim Erstellen eines Links wird das Übersichtsbild mit gespeichert und erscheint als Link-Vorschau (og:image) – für öffentliche Törns und für „Nur mit Link“ über den Schlüssel-Link (Bild-URL mit `?k=<schlüssel>`); private bleiben ohne Bild. Nur öffentliche Bilder dürfen geteilt gecacht werden.
- **F-40** Ohne Backend (statisches Hosting) funktioniert alles außer Server-Teilen; kleine Tracks können als Link mit eingebetteten Daten geteilt werden; alte `#g=`-Links funktionieren weiter.

## Unterstützen

- **F-60** Kontingent: Ein Konto (eine E-Mail-Adresse) speichert bis zu 3 Törns kostenlos (`FREE_SHARES`). Ab dem 4. braucht es den Unterstützer-Status, sonst lehnt der Server vor dem Upload mit 402 `supporter_required` und deutscher Meldung ab. Bestehende Freigaben bleiben erhalten, Löschen schafft Platz. Auch Unterstützer haben eine feste Obergrenze (100 Törns, 200 MB, Fehler 409). `GET /api/me/support` liefert `supporter`, `supporterUntil`, `sharesUsed`, `sharesFree`, `sharesMax`, `bytesUsed`, `bytesMax`.
- **F-61** Bezahlen: Der Worker legt über `POST /api/support/checkout {amount}` (angemeldet, Same-Origin) eine Stripe-Checkout-Session an. Erlaubt sind nur die Stufen 3/5/10/20/50 €. Die Session trägt `client_reference_id` = Konto-ID und `metadata.app = sail-explorer`. Freigeschaltet wird nur durch `checkout.session.completed` (bzw. `…async_payment_succeeded`) an `POST /api/webhooks/stripe`. Die Signatur muss gültig sein (HMAC-SHA256, max. 5 min alt) und die Session `metadata.app` tragen. Doppelte Zustellung zählt einmal, unbekannte Konten und andere Ereignisse werden ignoriert. Nur diese Route ist von der Origin-Prüfung ausgenommen. Unterstützungen bleiben bei Kontolöschung ohne Bezug zum Konto erhalten.
- **F-62** Fail closed: Ohne `STRIPE_SECRET_KEY` oder `STRIPE_WEBHOOK_SECRET` liefert `/api/config` `support: null`. Checkout und Webhook antworten dann mit 503, und der 4. Törn wird mit verständlicher Meldung (älteren Törn löschen) abgelehnt. `STRIPE_API_BASE` (nur Tests) akzeptiert ausschließlich lokale Hosts. Weitergeleitet wird nur auf `checkout.stripe.com`.
- **F-63** Oberfläche: Unterstützen wird dezent angeboten (Teilen-Ergebnis, Konto). Ein Schieberegler wählt die Stufe (Kaffee, Bier, Runde, Kiste, Skipper-Dank) mit eigenem Icon und Betrag; „Jetzt unterstützen (X €)“ öffnet Stripe Checkout. Rückkehr mit `?support=success|cancel|open` zeigt Dank bzw. Hinweis oder öffnet das Angebot, dann wird der Parameter entfernt. Teilen-Dialog und Konto zeigen „2 von 3 kostenlosen Freigaben genutzt“, Unterstützer sehen „Unterstützer bis …“ und ihre Obergrenze. Ist das Kontingent ausgeschöpft, zeigt „Teilen“ statt des Formulars die Unterstützen-Karte.
- **F-64** Gültigkeit: Jede Zahlung macht das Konto 12 Monate zum Unterstützer, gerechnet ab dem späteren Zeitpunkt von Zahltag und laufendem Ende.
- **F-65** Aufbewahrung: Ein Törn wird gelöscht, wenn der spätere Zeitpunkt von Upload und Ende des Unterstützer-Status mehr als 3 Monate zurückliegt. Die Datei, das Vorschaubild und der Datensatz werden gelöscht. Eigentümer sehen das Löschdatum je Törn im Konto.
- **F-66** Erinnerung: 14 Tage vor dem Löschen kommt eine Mail pro Konto mit allen betroffenen Törns, je Törn höchstens einmal. Schlägt der Versand fehl, wird es in der nächsten Nacht erneut versucht.
- **F-67** Inaktive Konten: Konten ohne Törns und ohne laufenden Unterstützer-Status werden nach 12 Monaten ohne Anmeldung vollständig gelöscht (wie „Konto löschen“). Abgelaufene Login-Links und Sessions werden nächtlich entfernt.

## Sichtbarkeit und Teilen-Links

- **F-80** Törns, Boote und Profile haben die Sichtbarkeit „Öffentlich“ (`public`), „Nur mit Link“ (`unlisted`) oder „Nur ich“ (`private`); die letzten beiden nur für Unterstützer (F-124). Neue Objekte sind standardmäßig öffentlich; der Dialog erklärt die Folgen vor dem Speichern. Geprüft wird die Stufe in `worker/validate.ts`, nicht per SQL-`CHECK`.
- **F-82** Ein Törn ist unabhängig von Boot und Profil sichtbar: Ist das Boot nicht öffentlich, wird es nicht genannt; ist das Profil nicht öffentlich (auch „Nur mit Link“), erscheint der Autor ohne Namen und Link.
- **F-83** Profil- und Bootsseiten sowie `/entdecken` listen nur öffentliche Objekte; Kennzahlen zählen nur öffentliche Törns. Öffentliche Törns erscheinen sofort. Ein Boots- oder Profil-Schlüssel öffnet keine „Nur mit Link“-Törns.
- **F-84** Indexierbar sind öffentliche Törns, Profile, Boote und `/entdecken`. Seiten mit Schlüssel im Pfad, Privates, Unbekanntes und alle `/api/*`-Antworten (`X-Robots-Tag: noindex`) sind `noindex`.
- **F-85** Link-Vorschau mit Titel, Text und Bild für öffentliche Objekte und für „Nur mit Link“ nur über den gültigen Schlüssel-Link (`/s/<id>/<schlüssel>`, `/b/<id>/<schlüssel>`, `/u/<name>/<schlüssel>`); sonst neutral.
- **F-86** Bestehende Freigaben werden übernommen (Migration `0006`): gelistet → öffentlich, nicht gelistet → „Nur mit Link“ ohne Schlüssel, privat → privat. Boote und Profile behalten ihre Sichtbarkeit; nichts wird still hochgestuft.
- **F-90** „Nur mit Link“ ist über `/<art>/<id oder name>/<schlüssel>` erreichbar; die API erwartet den Schlüssel im Header `X-Share-Key`, Bilder als `?k=`. Der Schlüssel hat 128 Bit (22 Zeichen), liegt im Klartext in D1, wird zeitkonstant verglichen und erscheint (`shareKey`, `link`) nur für den Eigentümer bzw. Eigner und Admins. Er entsteht bei neuen „Nur mit Link“-Objekten und beim ersten Wechsel dorthin und bleibt über „Nur ich“ und „Öffentlich“ hinweg gespeichert. Öffentliche Objekte ignorieren jeden mitgeschickten Schlüssel.
- **F-91** Bestehende Links `/s/<id>` von „Nur mit Link“-Törns ohne Schlüssel (Altbestand) funktionieren weiter, bis der Eigentümer den Link erneuert oder die Sichtbarkeit wechselt.
- **F-92** „Link erneuern“ (`rotateKey: true` bei `PATCH /api/shares/:id`, `PATCH /api/boats/:id`, `PUT /api/me/profile`) erzeugt einen neuen Schlüssel; alle bisherigen Schlüssel-Links sind sofort 404.
- **F-93** Falscher, fehlender, veralteter oder kaputter Schlüssel, private und unbekannte Objekte antworten gleich (404, gleicher Body). Fehlversuche mit Schlüssel sind pro IP begrenzt (`LINK_LIMITER`, 30 pro 60 s, sonst 429); Aufrufe ohne Schlüssel und Erfolge zählen nicht.
- **F-124** Kostenlose Konten speichern nur Öffentliches: „Nur mit Link“ und „Nur ich“ verlangen beim Anlegen und beim Wechsel einen laufenden Unterstützer-Status (sonst 402 `supporter_required` mit deutscher Meldung) – für Törns, Boote (maßgeblich ist der Eigner) und Profile. Endet die Unterstützung, bleiben bestehende nicht öffentliche Objekte unverändert (auch beim Bearbeiten anderer Felder und beim Erneuern des Links); auf „Öffentlich“ schalten oder löschen geht immer.

## Community (Entdecken)

- **F-70** Entdecken: Auf der Startseite zeigt – solange keine eigenen Tracks geladen sind – neben (breite Bildschirme) bzw. unter der Einstiegskarte eine Community-Leiste „Zuletzt gesegelt“ mit neuen Booten und Seglern; ohne öffentliche Törns lädt sie zum ersten Teilen ein, nur ohne Backend bleibt sie ausgeblendet die neuesten öffentlichen Törns (Übersichtsbild oder Platzhalter, Titel, Distanz, Datum, Segler, Boot) mit Link „Alle entdecken“. Die Seite `/entdecken` zeigt drei Abschnitte: Törns, Boote, Segler, jeweils neueste zuerst. Die Leiste verdeckt die Karte nicht und ist mobil seitlich scrollbar; ohne Backend, bei Fehlern oder ohne öffentliche Törns bleibt sie unsichtbar.
- **F-71** Datenschutz Törns: Es erscheinen nur Törns mit Sichtbarkeit „Öffentlich“ (`public`), unabhängig vom Profil (F-82). „Nur mit Link“ und „Nur ich“ erscheinen nie. Der Segler wird nur bei öffentlichem Profil genannt (sonst `sailor: null`), der Boot-Name nur, wenn das Boot öffentlich ist. Änderungen der Sichtbarkeit wirken sofort (höchstens 60 s Cache).
- **F-72** Datenschutz Boote und Segler: Boote nur mit Sichtbarkeit „Öffentlich“ und öffentlichem Eigner-Profil; Segler nur mit öffentlichem Profil und mindestens einem öffentlichen Törn oder Boot – leere Profile werden nicht beworben. Kennzahlen zählen nur öffentliche Törns.
- **F-73** Die Entdecken-Daten enthalten nie E-Mail-Adressen, Nutzer-IDs oder Sichtbarkeits-Interna; der Server wählt die Felder ausdrücklich aus. Die Auswahl ist für alle gleich (unabhängig von der Anmeldung) und darf deshalb kurz öffentlich gecacht werden.
- **F-74** Grenzen: höchstens 24 Einträge je Liste (Standard 12), Sortierung Törns nach Start- bzw. Erstellzeit, Boote und Segler nach Erstellzeit. `/entdecken` hat eine eigene Link-Vorschau und darf indexiert werden.
- **F-75** Startseite und Törn-Ansicht: Mit geladenen Tracks öffnet das Logo die Startseite (Einstieg + Community), ohne die Tracks zu verwerfen; „Mein Törn“ bzw. „Zurück zu deinem Törn“ führt zurück. Ein neuer Upload wechselt in die Törn-Ansicht. Beim Einblenden der Törn-Ansicht und nach jedem Upload wird der Kartenausschnitt für die dann sichtbare Kartenfläche (ohne Seitenleiste) neu gesetzt, sodass der ganze Track sichtbar ist.

## Betrieb

- **F-50** Lokale Entwicklung mit `npm run dev`, erreichbar im LAN (Handy) inkl. Login.
- **F-51** CI prüft Typen, Tests und Build; Deploy nur vom Hauptzweig.
- **F-52** Jeder andere Branch bekommt eine eigene Vorschau unter `sailing-<branch>.wollow.ski` mit eigener Datenbank und eigenem Speicher; beim Schließen des Pull Requests wird sie entfernt.
