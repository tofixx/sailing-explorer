# Navigation, Klickstrecken und Seitenköpfe – Bestandsaufnahme und Vorschläge

Stand: `origin/main` (Produktion) vom 2. 11. 2026, dazu der laufende Phase-2-Bau (`feature/beitraege-phase2`,
Worktree `sailing-explorer-posts`, noch nicht committet) nur lesend. Grundlage ist der Code; die Live-Seite wurde nicht
angesehen. Zeilenangaben beziehen sich auf `origin/main`.

**Leitlinie des Betreibers:** „Weniger ist mehr – und für den Anfang ein Weg nach Rom.“ Je Aufgabe genau **ein**
offensichtlicher Einstieg. Doppelte Knöpfe, Menüs und Einstiege werden lieber **gestrichen** als vereinheitlicht;
Seitenköpfe tragen so wenige Aktionen wie möglich, der Rest liegt im Zahnrad-Menü. In den Befunden ist das mit
**[streichen]** bzw. **[zusammenlegen]** markiert.

---

## 1. Seitenkarte

Routen aus `src/services/url-state.ts` (`parseRoute`), Verdrahtung in `src/app.ts` (`start`, `openPage`). Alle Seiten
liegen in einer einzigen HTML-Seite; „Seiten“ sind ein/ausgeblendete Komponenten, Dialoge liegen global in `index.html`.

| Seite / Route | Komponente | Wer sieht sie | Einstiege (heute) | Verlinkt weiter zu |
|---|---|---|---|---|
| **Community** `/` bzw. `/?community` (Startseite mit Stream) | `sx-empty-state` + `sx-home-feed`, `sx-discover` (Leiste), `sx-guest-slider` (nur Gäste, F-431; ersetzt das entfernte `sx-join-card`) | alle; Modi „Umgebung · Alles“ (Gast), dazu „Mitgliedschaften“ (angemeldet) | Logo, Reiter „Community“, Fehlerseiten („Zur Karte“) | Törn, Profil, Boot, Gruppe, Hafen, `/g/neu`, `/entdecken#vereine`, Konto-Dialog (Reiter Profil/Boote/Freigaben) |
| **Gast ohne Backend / ohne Tracks** `/` | `sx-empty-state` große Karte | Gast, kein Stream | Logo | GPX laden, Beispiele, Fahrtenbuch-Formular |
| **Törn-Ansicht (lokal)** `/` mit Tracks im Browser | Karte + Seitenleiste (`index.html` Z. 35–71) | jeder (nur dieses Gerät) | Reiter „Törn“, Datei laden, Drag & Drop | Teilen-Dialog, Speichern, Konto |
| **Törn-Ansicht (geteilt)** `/s/<id>[/<key>]` | wie oben + `sx-voyage-byline`, Fahrtenbuch, Crew, Fotos, Reaktionen, Kommentare | je Sichtbarkeit; Eigentümer:in mit Werkzeugen | Stream, Entdecken, Profil/Boot/Hafen-Karten, Glocke, Konto → Freigaben (Knopf, kein Link), „Mein Verlauf“ | Profil (Byline, Crew, Kommentare, Reaktionen), Gruppe (Byline), Hafen (Fahrtenbuch von/nach) – **kein Boot** |
| **Profil** `/u/<handle>[/<key>]` | `sx-profile-page` (kind `profile`) | je Stufe; eigene Seite mit „Mein Verlauf“ | Namen in Stream/Kommentaren/Crew/Reaktionen/Mitgliedern, Entdecken, Boots-Eigner, **eigene Seite nur Konto → Profil → „Ansehen“** | Boot, Gruppe (Verein), Hafen, Törns, Fotos |
| **Boot** `/b/<id>[/<key>]` | `sx-profile-page` (kind `boat`) | je Stufe; Boots-Admins | Stream, Entdecken, Profil, Hafen, Gruppe, Konto → Boote (Icon) | Hafen, Verein, Eigner, Törns |
| **Hafen** `/h/<slug>` | `sx-profile-page` (kind `harbor`), Karte als Hintergrund | alle | Stream, Entdecken, Boot/Gruppe/Profil-Fakten, Fahrtenbuch-Panel, Startseite „Heimathafen“ | Gruppen, Boote, Törns |
| **Gruppe (Verein/Team)** `/g/<slug>[/<key>]` | `sx-group-page` | je Stufe; Mitglied/Admin/Eigentümer | Stream, Entdecken, Byline, Startseite (Chips, Heimat, Willkommen), Konto → Gruppen, Boot/Profil-Fakten | Hafen, Eltern-Verein, Teams, Mitglieder, Boote, RSS |
| **Gruppe anlegen** `/g/neu` | `sx-group-page` (mode `create`) | angemeldet | Startseite Kopf („Gruppe gründen“), Willkommens-Karte, Entdecken-Fuß – **3 Einstiege** | – |
| **Entdecken** `/entdecken[#vereine]` | `sx-discover` (variant `page`) | alle | Reiter „Entdecken“, Leiste „Alle entdecken“, mehrere „Alle Vereine“-Links | alles |
| **Impressum / Datenschutz** | `sx-legal-page` | alle | Fuß der Startseite, Fuß des Konto-Dialogs | gegenseitig, Startseite |
| **Admin** `/admin[?tab=claims]` | `sx-admin-page` (nachgeladen) | nur Admins | Topbar-Knopf „Admin“, Glocke (Verifizierung) | Zielseiten (neuer Tab) |
| **Login** `/login#token=…` | → `/` + `sx-login-dialog` | – | Mail-Link | – |
| **Einladung** `/einladung#token=…` | → `/` + `sx-invite-dialog` | – | Mail/Link | Ziel (Törn/Boot/Gruppe) |
| Beispiel-/Alt-Links `?track=…`, `#g=…` | Törn-Ansicht (Modus `link`) | alle | externe Links | – |
| *Phase 2:* **Beitrag** `/p/<id>` | `sx-profile-page` (kind `post`) | je Sichtbarkeit | Teilen-Knopf an Beitragskarten | Heimatverlauf |

**Dialoge und Panels** (global, ohne eigene Adresse außer `?konto=…`):

| Dialog | Einstieg | Reiter / Inhalt |
|---|---|---|
| Konto & Freigaben (`sx-account-dialog`) | Avatar oben rechts, „Gespeichert“-Chip, „Bearbeiten“ auf eigener Profil-/Bootsseite, „Dein Bereich“-Karte (3 Knöpfe), Startseite „Verein/Heimathafen wählen“, Kommentare „Profil anlegen“, Teilen-Dialog, Unterstützen, `?konto=einstellungen|einladungen` | Profil · Boote · Gruppen · **Freigaben (Standard)** · Einstellungen · (Meldungen) + Einladungen an dich, Abmelden, Konto löschen |
| Teilen (`sx-share-dialog`) | „Teilen“ in der Topbar (Törn) | Stufe, Boot, Gruppen, Bild |
| Anmelden (`sx-login-dialog`) | „Anmelden“, alle Gast-Aktionen | – |
| Benachrichtigungen (`sx-notifications`) | Glocke | Liste → Ziel |
| Fahrtenbuch-Formular (`sx-logbook-form`) | „Ins Fahrtenbuch eintragen“ (nur Community-Startkarte), „Bearbeiten“ im Fahrtenbuch-Panel | – |
| Melden, Foto-Lightbox, Foto-Upload, Einladung | kontextuell | – |

**Mobil (< 760 px):** Bereiche als Reiterzeile unter der Kopfzeile (Törn · Community · Entdecken); „Track anlegen“ in
der Topbar auf der Startseite ausgeblendet, stattdessen runder Plus-Knopf (FAB) und Einstiegskarte
(`sx-topbar.ts` Z. 312–317, `sx-empty-state.ts` Z. 456). Glocke und Avatar bleiben oben rechts. Seiten scrollen als
Ganzes.

---

## 2. Verknüpfungsmatrix (Objekt × Darstellungsort)

Legende: ✔ Link aufs Objekt · ◐ nur Name verlinkt, Avatar/Icon/Karte nicht · ✘ nicht klickbar · – kommt nicht vor.

| Ort (Datei:Zeile) | Person | Boot | Gruppe | Hafen | Törn | Beitrag |
|---|---|---|---|---|---|---|
| Stream-Karte (`sx-stream.ts` 187–265) | ✔ Name (kein Avatar) | ✔ | ✔ | ✔ | ✔ Titel + Bild | ✘ kein Permalink (Phase 2: Teilen-Icon) |
| Stream „Mitglied beigetreten“ ohne Profil (241) | ✘ Spaßname, Tooltip | – | ✔ | – | – | – |
| Kommentare (`sx-comments.ts` 228) | ✔ Name, ohne Profil ✘ ohne Erklärung | – | – | – | – | – |
| Reaktionen „Wer“ (`sx-reactions.ts` 176) | ✔ | – | – | – | – | – |
| Crew (`sx-crew.ts` 248–253) | ✔; ohne Profil: Besucher Info-Knopf, Eigentümer ✘ | – | – | – | – | – |
| Byline Törn (`sx-voyage-byline.ts` 53–58) | ✔ | **✘ fehlt** | ✔ (Icon `sail` auch für Verein) | – | – | – |
| Fahrtenbuch-Panel (`sx-logbook-panel.ts` 70) | – | – | – | ✔ | – | – |
| Topbar-Chip (Titel des Törns) (`sx-topbar.ts` 375) | – | – | – | – | ✘ (doppelt zum Titel in der Seitenleiste) | – |
| Topbar-Avatar (`sx-topbar.ts` 443–444) | ✘ öffnet Konto-Dialog, **Initiale aus E-Mail** | – | – | – | – | – |
| Profil-Kopf (`sx-profile-page.ts` 396–400) | Initiale ✘ | – | ✔ Verein | ✔ | – | – |
| Profil-/Boot-/Hafen-Karten (`sx-profile-page.ts` 318, 423, 609, 618) | Eigner im Hafen-Bootskärtchen ✘ (in Kartenlink) | ✔ ganze Karte | ✔ ganze Karte | – | ✔ ganze Karte; Boot im Törnkärtchen ✘ | – |
| Boot-Kopf (`sx-profile-page.ts` 449–451) | ✔ Eigner | – | ✔ | ✔ | – | – |
| Gruppe Kopf (`sx-group-page.ts` 540–541) | – | – | ✔ Eltern-Verein | ✔ | – | – |
| Gruppe Mitglieder (`sx-group-page.ts` 638–639) | ◐ Avatar ✘, Name ✔ | – | – | – | – | – |
| Gruppe Anfragen (621) | ✔ Name | – | – | – | – | – |
| Gruppe Boote/Teams (667, 699) | – | ◐ Karte ist `div`, nur Name-Link | ◐ dito | – | – | – |
| Startseite „Leute, die du kennen könntest“ (`sx-home-feed.ts` 453–454) | ◐ Avatar ✘, Name ✔ | – | – | – | – | – |
| Startseite Willkommen / Gruppen-Chips / Heimat (415–416, 472–473, 583) | – | – | ◐ / ✔ / ✔ | ✔ | – | – |
| Entdecken Törnkarte (`sx-discover.ts` 476–490) | ✔ Chip | ✔ Chip | – | – | ✔ Titel; Vorschaubild ✘ | – |
| Entdecken Boot/Person/Hafen-Karte (502–560) | ✔ ganze Karte; „Eigner“ ✘ | ✔ | – | ✔ | – | – |
| Entdecken Gruppenkarte (547) | – | – | ◐ nur Name (wegen Beitreten-Knopf); Titelbild ✘ | – | – | – |
| Entdecken-Leiste (572–574) | ✔ Chip | ✔ Chip | ✔ Chip (Icon `pennant`) | – | – | – |
| „Mein Verlauf“ (`sx-my-posts.ts` 159–161) | – | – | ✔ | – | ◐ Titel editierbar, Link heißt „Öffnen“ | ✘ |
| Profil-Beiträge (`sx-profile-posts.ts` 33) | – | – | ✔ | – | – | ✘ |
| Galerien (`sx-page-media.ts` 370) | – | – | – | – | ✔ (`?foto=`) | – |
| Konto → Freigaben (`sx-account-dialog.ts` 910) | – | – | – | – | ◐ Knopf statt Link (kein Mittelklick) | – |
| Konto → Boote (824) / Boots-Admins (750) | Admins ✘ | ✔ Icon | – | – | – | – |
| Konto-Kopf (1066) | Initiale/Name ✘ (keine eigene Seite) | – | – | – | – | – |
| Glocke (`worker/notifications.ts` 312–352) | ✔ Follower → Profil | – | ✔ Anfrage → Gruppe | ✔ | ✔ (ohne `#kommentar-`-Anker) | eigener Profil-Beitrag → `/u/…` ohne Anker; **Reaktion auf Neuigkeit → `/`** |

**Icons für Objektarten sind nicht fest:** Verein = `anchor` (Gruppenkopf, Entdecken-Karte, Start-Chips) **oder**
`pennant` (Filter, Heimatzeile, Entdecken-Leiste); Team = `sail` = Boot; Hafen = `anchor` = Verein; Byline zeigt für
jede Gruppe `sail`; Entdecken = `compass` (Reiter) bzw. `globe` (Seitenkopf).

---

## 3. Seitenkopf-Vergleich

Alle Seiten nutzen dieselbe `.hero`-Optik, aber **jede Seite baut ihre Aktionen selbst** (kein gemeinsamer Baustein).

| Seite | Titelbild | Zeichen | Fakten-Zeile | Aktionen (Reihenfolge, Stil) |
|---|---|---|---|---|
| Profil, Besucher | ✔ | Initiale | Verein, Hafen | Folgen · **Profil teilen** (primary) · Melden (ghost) |
| Profil, eigene | ✔ editierbar | Initiale | Verein, Hafen, **Stufe „Privat – nur du …“** | Profil teilen (primary) · Bearbeiten (öffnet Konto-Dialog) · **Zahnrad = „Ansehen als …“** |
| Boot | ✔ | `sail` | Typ, Länge, Hafen, Verein, Eigner, (Stufe) | Folgen · **Boot teilen** (primary) · Bearbeiten (Konto-Dialog) bzw. Melden |
| Hafen | **✘ kein Titelbild** | `anchor` | „Hafen“, Position | Folgen · **Teilen** (primary, *funktioniert nicht*, s. B1) · Bearbeiten (Inline-Formular im Kopf) · Melden · Verifizieren (`sx-claim`) – **bis zu 5 Knöpfe** |
| Gruppe | ✔ | `anchor`/`sail` | Art, Beitritt, Hafen, Verein, Stufe, „Du: …“ | Beitreten/Glocke(stumm)/Austreten · Folgen · **Teilen** (normal, nicht primary) · Bearbeiten (Inline unter dem Kopf) bzw. Melden · Verifizieren – **bis zu 5** |
| Törn | – (Karte) | – | Titel (Seitenleiste) + Byline; Titel nochmals als Chip in der Topbar | Teilen in der **Topbar**; Bearbeiten nur Fahrtenbuch-Panel; Melden versteckt im Kommentar-Panel; Löschen/Stufe nur Konto → Freigaben |
| Entdecken | – | `globe` | Lead-Text | keine; Suche + Filter-Chips (`aria-pressed`) |
| Community | – | – | Überschrift wechselt je Modus | „Gruppe gründen“ rechts; Modi als Knopfleiste + „Beitritte“-Chip |
| Rechtliches / Admin | – | – | – | eigene Muster |

**Inkonsistenzen im Kopf**

- K1 Beschriftung „Profil teilen“ / „Boot teilen“ / „Teilen“; Stil mal `primary`, mal normal (Gruppe).
- K2 „Bearbeiten“ führt dreimal woanders hin: Konto-Dialog (Profil, Boot), Inline-Formular im Kopf (Hafen), Inline-Formular unter dem Kopf (Gruppe).
- K3 Zahnrad bedeutet auf der eigenen Seite „Ansehen als …“, nicht Einstellungen.
- K4 Sichtbarkeits-Stufe steht als Text in der Fakten-Zeile (eigene Seite „Privat“), darunter heißt der Reiter in „Mein Verlauf“ ebenfalls „Privat“ – zwei Bedeutungen desselben Worts direkt übereinander.
- K5 Reiter/Filter unter dem Kopf: drei Muster – `role="tab"` (Konto-Dialog, „Mein Verlauf“), Knopfleiste `aria-pressed` (Community-Modi), Chips `aria-pressed` (Entdecken-Abschnitte, Umkreis, Filter). Auf Entdecken stehen drei Chip-Reihen übereinander.
- K6 Folgen vs. Mitglied: auf der Gruppe ersetzt die Glocke (stumm) das Folgen, sonst `sx-follow`.
- K7 Hafen hat kein Titelbild, alle anderen Objektseiten schon.
- K8 Törn-Ansicht hat gar keinen Seitenkopf; Aktionen liegen in Topbar, Seitenleiste, Panels und im Konto.

---

## 4. Klickstrecken (heute, Produktion)

Gezählt ab Startseite, angemeldet, Desktop; Abweichungen in Klammern. „+F“ = Formular ausfüllen.

| Aufgabe | Weg | Klicks | Bewertung |
|---|---|---|---|
| Track hochladen und teilen | „Track anlegen“ → Datei → „Teilen“ → Stufe +F → Speichern → Link kopieren | 5–6 (Gast: + Anmeldung, Mail, zurück) | ok; **4 gleichwertige Upload-Einstiege** (Topbar, Startkarte, FAB, Drag & Drop) |
| Fahrtenbuch-Eintrag anlegen | Startseite → Startkarte „Kein Track? Ins Fahrtenbuch eintragen“ (kleiner Textlink) +F | 1 +F | **versteckt**: nur auf der Community-Startseite, nicht in Topbar, nicht auf der eigenen Seite |
| Eigene Seite öffnen | Avatar → Reiter „Profil“ (Dialog öffnet auf „Freigaben“) → „Ansehen“ | 3 | **versteckt**; ohne Profil gar nicht |
| Eigenes Fahrtenbuch finden | wie eigene Seite → „Mein Verlauf“ scrollen (gemischt mit Beiträgen) | 3 + Scrollen | **versteckt**, kein eigener Bereich (Phase 2: Reiter) |
| Gruppe finden und beitreten | „Entdecken“ → Chip „Vereine und Teams“ / Suche → „Beitreten“ | 3 | ok; parallel Willkommens-Karte und `#vereine`-Links |
| Beitrag in Gruppe schreiben | Community → „Mitgliedschaften“ → Gruppen-Chip → Scrollen (Kopf, Kennzahlen, Anfragen, Einladen, Teams) → Composer | 3 + Scrollen | Composer zu tief; Mitglieder dürfen je nach `postBy` gar nicht – kein Hinweis |
| Hafen-/Vereinsseite öffnen | Community → „Mitgliedschaften“ → „Mein Verein“/„Heimathafen“ | 2 | nur im Modus „Mitgliedschaften“ sichtbar; sonst Entdecken (3) oder Konto → Gruppen (3) |
| Benachrichtigung → Ziel | Glocke → Eintrag | 2 | **Sackgassen**: Reaktion auf Neuigkeit → `/`; Profil-Beitrag → `/u/…` ohne Anker; Kommentar ohne Anker; Einladungen → Konto-Dialog |
| Profil einer Person aus dem Stream | Name | 1 | ok – aber kein Avatar; Mitglieder-/Vorschlagslisten: Avatar nicht klickbar |
| Konto-Einstellungen | Avatar → „Einstellungen“ | 2 | ok |
| Boot anlegen | Avatar → „Boote“ → „Boot anlegen“ +F | 3 +F | eigene Seite hat Abschnitt „Boote“ ohne Anlegen |
| Einladung versenden | Crew: eigener Törn → Crew-Panel (Seitenleiste scrollen) +F · Gruppe: Gruppe → „Leute einladen“ +F · Boots-Admin: Avatar → Boote → Admins-Icon +F · Freund: nur Willkommens-Karte | 2–4 | **4 verschiedene Einladungs-UIs**; Freunde einladen nach „Später“ bzw. sobald Gruppe+Hafen gesetzt **nicht mehr erreichbar** |
| Eigenen Törn löschen / Stufe ändern | Avatar → (Freigaben) → Zeile | 2 | auf dem Törn selbst nicht möglich; zweiter Weg über „Mein Verlauf“ (Löschen) |

Mobil zusätzlich: Reiterzeile kostet eine zweite Kopfzeile; „Track anlegen“ in der Topbar fehlt auf der Startseite
(FAB statt dessen) – dieselbe Aufgabe hat je nach Seite einen anderen Knopf.

---

## 5. Befunde nach Schwere

**Hoch**

| # | Befund | Ort | Maßnahme |
|---|---|---|---|
| B1 | „Teilen“ auf der Hafenseite tut nichts: `sharePage`/`copyPath` lassen nur `/s|b|u|g/` durch, `/h/…` (und Phase 2 `/p/…`) fällt still heraus | `src/controllers/session.ts` 898, 904; `sx-profile-page.ts` 587 | Regex um `h`, `p` erweitern, kein stilles `return` |
| B2 | Eigene Seite nur über Konto → Profil → „Ansehen“ (3 Klicks, Dialog startet auf „Freigaben“) | `sx-topbar.ts` 443; `sx-account-dialog.ts` 604, `session.ts` 938 | Konto-Menü „Meine Seite“ (Phase 2) |
| B3 | Fahrtenbuch-Eintrag nur über Textlink der Community-Startkarte | `sx-empty-state.ts` 402 | „+ Neu“ (Phase 2), Textlink **[streichen]** |
| B4 | Eigene Törns doppelt verwaltet: Konto → Freigaben **und** „Mein Verlauf“ (Löschen, Umbenennen beide Orte); auf der eigenen Seite stehen eigene Törns zusätzlich nochmals unter „Törns“ | `sx-account-dialog.ts` 868–951; `sx-profile-page.ts` 432 | Reiter „Freigaben“ **[streichen]**, Abschnitt „Törns“ auf eigener Seite **[streichen]** |
| B5 | Vier gleichwertige Upload-Einstiege (Topbar, Startkarte, FAB, D&D), mobil je Seite anders | `sx-topbar.ts` 410; `sx-empty-state.ts` 414/430/457 | ein „+ Neu“; Topbar-Knopf und FAB **[zusammenlegen]**, kompakte Startkarte **[streichen]** (große Gastkarte bleibt) |
| B6 | Kopfaktionen je Seite anders (Beschriftung, Stil, Reihenfolge, Ziel von „Bearbeiten“), Hafen/Gruppe bis 5 Knöpfe | Abschnitt 3 | gemeinsamer Seitenkopf mit fester Reihenfolge, Rest ins Zahnrad |

**Mittel**

| # | Befund | Ort | Maßnahme |
|---|---|---|---|
| B7 | Avatare/Initialen nie klickbar (Mitglieder, Vorschläge, Entdecken-Personen-Icon nur als Teil der Karte), Stream ohne Avatar | `sx-group-page.ts` 638; `sx-home-feed.ts` 453 | `sx-entity-link` mit Avatar |
| B8 | Topbar-Avatar zeigt `email[0]`, Konto-Dialog und Profil `displayName[0]` | `sx-topbar.ts` 444 vs. `sx-account-dialog.ts` 1066 | eine Avatar-Komponente |
| B9 | Zahnrad = „Ansehen als …“ | `sx-preview-menu.ts` 90 | Zahnrad = Seitenmenü (Bearbeiten, Ansehen als, Titelbild, Melden) |
| B10 | „Privat“ als Stufe im Kopf und als Reiter in „Mein Verlauf“ | `sx-profile-page.ts` 331; `sx-my-posts.ts` 190 | Reiter „Nur ich“; Stufe als Symbol im Kopf (Schloss/Globus) mit Tooltip |
| B11 | Glocke-Sackgassen: Reaktion auf Neuigkeit → `/`, Beitrag/Kommentar ohne Anker, Claim-Ergebnis nicht öffentlich → `/` | `worker/notifications.ts` 320, 325, 349, 352 | Ziel immer konkret (`/p/<id>`, `#kommentar-<id>`), sonst Eintrag nicht anzeigen |
| B12 | Byline des Törns ohne Boot; Gruppen-Icon immer `sail` | `sx-voyage-byline.ts` 53–58 | Boot ergänzen, Icon aus zentraler Tabelle |
| B13 | Objekt-Icons uneinheitlich (Verein `anchor`/`pennant`, Team = Boot = `sail`, Hafen = Verein = `anchor`, Entdecken `compass`/`globe`) | mehrere | eine Tabelle `ENTITY_ICON` |
| B14 | Freunde einladen nur in der Willkommens-Karte – nach „Später“ verschwunden | `sx-home-feed.ts` 364, 387 | Einladen zentral im Konto-Menü bzw. auf der eigenen Seite |
| B15 | Vier Einladungs-UIs (Crew, Gruppe, Boots-Admin, Freund) mit unterschiedlichem Aufbau | `sx-crew.ts` 190/333, `sx-group-page.ts` 584, `sx-account-dialog.ts` 831, `sx-home-feed.ts` 431 | ein `sx-invite-box` (Link erzeugen · per E-Mail · offene Einladungen) |
| B16 | „Gruppe gründen“ an drei Stellen (Startseiten-Kopf, Willkommen, Entdecken-Fuß) | `sx-home-feed.ts` 423/574; `sx-discover.ts` 664 | nur Entdecken → Vereine (bzw. „+ Neu“) **[streichen]** Startseiten-Kopf |
| B17 | „Dein Bereich“-Karte dupliziert das Konto (3 Knöpfe in Dialog-Reiter) | `sx-join-card.ts` 141–150 | mit Konto-Menü **[streichen]** – erledigt: Komponente entfernt, für Gäste ersetzt durch den Slider (F-431) |
| B18 | Drei Reiter-/Filtermuster (tab, Knopfleiste, Chips) | K5 | ein `sx-tabs` (Bereich) + Chips nur für Filter |
| B19 | Törn-Verwaltung nicht am Törn: Stufe, Löschen nur im Konto; Melden nur im Kommentar-Panel | `sx-comments.ts` 318 | Zahnrad-Menü im Törn-Kopf |
| B20 | Topbar-Chip wiederholt den Törn-Titel der Seitenleiste | `sx-topbar.ts` 373–379 | **[streichen]** für `share`, Chip nur für Speicherstatus |

**Niedrig**

| # | Befund | Ort |
|---|---|---|
| B21 | Gruppen-Boote/Teams als `div`-Karte mit innerem Link, sonst ganze Karte als Link | `sx-group-page.ts` 667, 699 |
| B22 | Konto → Freigaben „Öffnen“ ist Knopf (`location.assign`), kein Link – kein Mittelklick | `sx-account-dialog.ts` 910; `app.ts` 643 |
| B23 | Spaßname ohne Profil: Crew erklärt per Knopf, Kommentare/Stream nicht | `sx-crew.ts` 251; `sx-comments.ts` 228 |
| B24 | Boots-Admins im Konto nicht verlinkt | `sx-account-dialog.ts` 750 |
| B25 | „Track anlegen“ heißt anderswo „GPX-Datei wählen“ / „Weitere GPX“ / „Eigenen Törn anlegen“ | `sx-empty-state.ts` |
| B26 | Fehlerseiten „Zur Karte“, Rechtliches „Zur Startseite“ – beide meinen `/` | `sx-profile-page.ts` 633; `sx-legal-page.ts` 120 |

---

## 6. Optimierungsvorschläge (priorisiert, schnelle Gewinne zuerst)

**Sofort (klein, ohne Konzeptänderung)**

1. B1 beheben (Regex `[sbughp]`, Test je Präfix).
2. Konto-Dialog öffnet ohne Reiter-Wunsch auf „Profil“ statt „Freigaben“; Topbar-Avatar aus `displayName`.
3. Abschnitt „Törns“ auf der eigenen Seite ausblenden (steht in „Mein Verlauf“).
4. Reiter „Privat“ → „Nur ich“; Zahnrad-Icon in „Ansehen als …“ durch `eye` ersetzen, bis das Zahnrad-Menü kommt.
5. Glocke: Reaktion auf Neuigkeit zur Neuigkeit (`/p/<id>`), Kommentar mit `#kommentar-<id>`.
6. Byline: Boot verlinken. Entdecken-Seitenkopf: Icon `compass` wie der Reiter.

**Mit Phase 2 (laufend)**

7. „+ Neu“ als **einziger** Anlege-Einstieg (Törn, Fahrtenbuch, Text): Topbar „Track anlegen“, FAB, kompakte Startkarte,
   Fahrtenbuch-Textlink, Composer oben in „Mein Verlauf“ **streichen**; „Eintrag hinzufügen“ nur im Leerzustand.
   Gruppen-Composer bleibt (Kontext-Schreiben), wird aber direkt unter den Kopf gezogen.
8. Konto-Menü (Avatar): **Meine Seite · Mein Fahrtenbuch · Konto & Einstellungen · Abmelden**. „Mein Fahrtenbuch“ mit
   Adresse `/u/<handle>?bereich=fahrtenbuch` (seit Konzept 27 `/konto/fahrtenbuch`). Damit „Dein Bereich“-Karte und Reiter „Freigaben“ **streichen**.
9. Beitragskarten: Zeitangabe = Permalink `/p/<id>`; Teilen über diesen Link. Dasselbe für Törnkarten.

**Danach (Bausteine)**

10. `sx-page-header`: Titelbild, Zeichen, Titel, Fakten, Aktionen in fester Reihenfolge (Regel R4) für Profil, Boot,
    Hafen, Gruppe, Törn, `/p/`.
11. `sx-entity-link` / `sx-avatar` + zentrale `ENTITY_ICON`-Tabelle, alle Nennungen umstellen (Matrix Abschnitt 2).
12. `sx-tabs` für Bereiche unter dem Kopf; Chips nur für Filter.
13. `sx-invite-box` für alle vier Einladungsarten; „Freunde einladen“ auf der eigenen Seite (Zahnrad oder Mitmachen-Leiste).
14. Törn-Ansicht bekommt denselben Kopf (Titel, Byline, Aktionen Teilen · Zahnrad mit Stufe/Bearbeiten/Löschen/Melden).
15. Hafen bekommt Titelbild (wie Boot/Gruppe), damit alle Objektseiten gleich aussehen.

---

## 7. Navigations- und Kopfbereich-Regeln (Vorschlag)

So formuliert, dass sie in `docs/PRINCIPLES.md` übernommen werden können.

**N1 – Ein Einstieg je Aufgabe.** Jede Aufgabe hat genau einen offensichtlichen Einstieg. Ein zweiter Weg entsteht nur
als Abkürzung im Kontext (z. B. Leerzustand „Ersten Eintrag anlegen“), nie als gleichwertiger Knopf an anderer Stelle.
Bevor ein neuer Knopf/Link/Menüpunkt entsteht: Gibt es den Einstieg schon? Dann den bestehenden verbessern oder den
alten streichen.

**N2 – Globale Navigation ist fest.** Kopfzeile von links: Logo (→ `/`) · Bereiche *Community · Entdecken* (mobil
Reiterzeile; *Törn* nur bei geladenen Tracks) · rechts **„+ Neu“** (einziger Anlege-Einstieg) · Glocke · Avatar mit
Konto-Menü (*Meine Seite · Mein Fahrtenbuch · Konto & Einstellungen · Abmelden*; Admin nur für Admins). Gäste sehen statt
Glocke und Avatar „Anmelden“. Nichts sonst in der Kopfzeile.

**N3 – Jede Nennung ist ein Link, immer über einen Baustein.** Personen, Boote, Gruppen, Häfen, Törns und Beiträge
werden ausschließlich über `sx-entity-link` (Name, optional Avatar/Icon) bzw. `sx-avatar` dargestellt; Avatar und Name
führen zum selben Ziel (`/u/`, `/b/`, `/g/`, `/h/`, `/s/`, `/p/`). Ausnahme nur ohne öffentliches Ziel (Spaßname):
dann einheitlich Schloss-Symbol mit Erklärung, nie toter Text. Ganze Karten sind ein Link, außer sie enthalten einen
Knopf – dann ist der Titel der Link, und die Karte zeigt das gleich.

**N4 – Ein Icon je Objektart.** Person `user`, Boot `sail`, Verein `pennant`, Team eigenes Icon (nicht `sail`), Hafen
`anchor`, Törn `map`, Fahrtenbuch `book`, Beitrag `comment`. Die Tabelle liegt an einer Stelle (`ENTITY_ICON`), Seitenkopf,
Karten, Chips und Reiter nutzen sie.

**N5 – Ein Seitenkopf für alle Objektseiten.** `sx-page-header` mit: Titelbild · Zeichen (Avatar/Icon) · Titel
(+ Verifiziert) · eine Fakten-Zeile (Links nach N3) · Aktionen. **Höchstens zwei sichtbare Aktionen** in dieser
Reihenfolge: (1) die Beziehungs-Aktion – *Folgen* bzw. *Beitreten/Mitglied* (nie beides) – oder für Eigentümer
nichts, (2) *Teilen* (immer gleich beschriftet „Teilen“, gleicher Stil). Alles andere liegt im **Zahnrad-Menü** als
dritter, letzter Knopf.

*Bewusste Ausnahme (Konzept 24.3, F-446):* Folgende sehen zwei Beziehungs-Knöpfe – „✓ Folgst du ▾“ (mit Glockenstufe und
Entfolgen) und „Beitreten“ –, weil Folgen keine Vorstufe der Mitgliedschaft ist und beide Wege offen bleiben müssen.
Mitglieder sehen statt „Folgen“ die Glocke; „Austreten“ bleibt im Zahnrad.

**N6 – Zahnrad heißt Seiten-Menü.** Das Zahnrad rechts im Kopf enthält, je nach Rolle: *Bearbeiten · Titelbild ·
Sichtbarkeit · Ansehen als … · Stummschalten · Austreten · Verifizieren lassen · Melden · Löschen*. Kein anderes
Element trägt das Zahnrad. „Bearbeiten“ öffnet immer dasselbe Muster (Formular unter dem Kopf auf der Seite selbst,
nicht den Konto-Dialog).

**N7 – Stufe ist ein Symbol, kein Text-Bereich.** Die Sichtbarkeit einer Seite zeigt der Kopf für Berechtigte als ein
Symbol (Globus/Link/Schloss) mit Tooltip; Ändern über Zahnrad → Sichtbarkeit. Wörter der Stufen („Öffentlich“, „Nur mit
Link“, „Nur ich“) werden nirgends für etwas anderes verwendet.

**N8 – Unter dem Kopf: Reiter, darunter Filter.** Bereiche einer Seite sind Reiter (`sx-tabs`, `role="tab"`, eine Zeile,
höchstens vier, adressierbar per `?bereich=`); Eingrenzungen sind Chips (`aria-pressed`) in einer Zeile darunter.
Knopfleisten für Bereiche gibt es nicht mehr.

**N9 – Verwalten am Objekt, nicht im Konto.** Was zu einem Objekt gehört (Törn, Boot, Gruppe, Beitrag), wird auf
dessen Seite über das Zahnrad verwaltet. Der Konto-Dialog enthält nur Kontodinge (Profil-Stammdaten, Anmeldung,
Benachrichtigungen, Unterstützung, Konto löschen) und keine zweite Liste von Objekten.
*Bewusste Ausnahme (Konzept 24.6, F-449):* Die Glockenstufe wird an genau zwei Stellen bearbeitet – am Objekt (Glocke im
Seitenkopf) und in Konto → Benachrichtigungen als Überblick über alle Verläufe. Konto → Gruppen zeigt die Stufe nur
als Symbol mit Link zur Gruppe, nicht bearbeitbar.

**N10 – Jede Adresse führt zu einem konkreten Ziel.** Links aus Glocke, Mail und Teilen zeigen auf das Objekt mit
Anker (`/p/<id>`, `#kommentar-<id>`, `?foto=`, `?bereich=`); ist das Ziel nicht sichtbar, erscheint der Eintrag nicht –
nie ein Sprung auf `/`.

**N11 – Mobil gleich, nur kompakter.** Gleiche Einstiege an gleicher Stelle auf jeder Seite; Beschriftungen dürfen zu
Icons schrumpfen, Knöpfe dürfen nicht je Seite verschwinden oder woanders auftauchen. Ziele ≥ 44 px.

**N12 – Prüfung im Review.** Der Review-Agent prüft neue UI zusätzlich auf: neuer Einstieg für eine vorhandene Aufgabe
(N1), Nennung ohne `sx-entity-link` (N3), Kopfaktion außerhalb von `sx-page-header`/Zahnrad (N5/N6).

---

## 8. Törn-Seitenleiste: was sofort sichtbar ist (F-510 … F-514)

Wunsch des Betreibers: Die Törn-Seite zeigt zuerst nur Wichtiges; Verwaltung liegt im Zahnrad (N6) oder klappt auf
Klick auf. Was ins Zahnrad wandert, verschwindet aus dem Panel (N1). G = Gast/Besucher, C = Crew-Mitglied,
S = Skipper:in, E = Eigentümer:in. Gilt mobil (Bottom-Sheet, Zahnrad öffnet als Sheet) und am Desktop gleich.

| Element | Wer | Vorher | Jetzt |
|---|---|---|---|
| Titel, „von … · in …“ | alle | sichtbar | sichtbar; Umbenennen (Stift) für E bleibt am Titel (F-424) |
| Zahnrad im Törn-Kopf | alle mit Einträgen | – | **neu** (F-510): Crew bearbeiten · Crew verlassen · Kommentare an/keine neuen/ausblenden · Törn melden |
| Fahrtenbuch „Bearbeiten“ | E | sichtbar | unverändert (parallel `feature/fahrtenbuch-jahre`; später ins Zahnrad, offen) |
| Bedingungen, Einfärben, Reise, Verlauf | alle | sichtbar | unverändert (Kerninhalt) |
| Fotos „Fotos hinzufügen“ | E, C | sichtbar | unverändert (parallel `feature/galerie`) |
| Crew: Namen, Rolle, „bestätigt“ | alle | sichtbar | sichtbar |
| „Deine Rolle“ als Auswahlfeld | E, C | Auswahl immer offen | kompakte Zeile „Deine Rolle Crew ✎“, Auswahl nach Klick (F-511) |
| Rollenauswahl und × je Mitglied | E | immer | Bearbeiten-Modus über Zahnrad „Crew bearbeiten“ (F-512) |
| Bestätigen/Zurückziehen, „Alle bestätigen“, Hinweis Meilennachweis | S | immer | Bearbeiten-Modus (F-512) |
| „Einladungslink erzeugen“, „Einladen als“, E-Mail-Feld, Hinweistext, offene Einladungen | E | immer (5 Elemente) | ein Knopf „+ Einladen · n offen“, klappt auf (F-513) |
| „Mich aus der Crew entfernen“ | C | Panel | Zahnrad „Crew verlassen“ mit Rückfrage (`sx-confirm`) |
| Reaktionen | alle | sichtbar | unverändert |
| Kommentare: Liste | alle | sichtbar | sichtbar |
| Kommentar-Formular mit Zähler und Regeln | angemeldet | immer offen | Knopf „Kommentieren“, Feld nach Klick (F-514) |
| „Zum Kommentieren meldest du dich an“ + „Anmelden“ | G | Text + Knopf | derselbe Knopf „Kommentieren“ öffnet die Anmeldung |
| „Für diesen Törn: [Kommentare an]“ | E | Auswahl im Panel | Zahnrad (F-510) |
| Melden/Löschen je Kommentar | alle bzw. Autor:in, E | immer | mit Maus bei Hover/Fokus, Touch immer (F-514) |
| „Törn melden“ | G, C | unter den Kommentaren | Zahnrad (F-510) |
| Tracks: Ein-/Ausblenden, GPX laden | alle | sichtbar | unverändert; lange Namen mit Ellipse statt breiter Seitenleiste bei 375 px (F-514) |
