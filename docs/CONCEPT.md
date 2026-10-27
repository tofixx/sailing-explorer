# Konzept: Sichtbarkeit, Links, Fotos, Kommentare und Kontingente

Stand: Oktober 2026. Grundlage: `docs/PRINCIPLES.md`, `docs/REQUIREMENTS.md`,
`docs/PLATFORM.md`, `migrations/0001`–`0004`, `worker/validate.ts`,
`worker/shares.ts`, `worker/boats.ts`, `worker/profiles.ts`,
`worker/supporter.ts`, `src/domain/support.ts`.

Ziel: ein **einheitliches Sichtbarkeitsmodell** für Törns, Boote, Profile,
Fotos und Kommentare, dazu **änderbare Teilen-Links**, **Fotos auf der Karte**,
**Kommentare** und **feste Obergrenzen auch für Unterstützer**, alles im
Cloudflare-Free-Tier. Neue Anforderungen haben IDs ab **F-80** (Abschnitt 8);
sie werden erst bei der Umsetzung nach `REQUIREMENTS.md` übernommen.

## Entscheidungen des Betreibers (Oktober 2026)

Diese Entscheidungen gehen allen Vorschlägen unten vor; betroffene Stellen sind angepasst.

| # | Entscheidung | Folge |
|---|---|---|
| E1 | **Kostenlos ist immer öffentlich.** „Nur mit Link“ und „Nur ich“ gibt es nur mit laufendem Unterstützer-Status. | Gilt für Törns, Boote und Profile. Der Server prüft das (402 `supporter_required`), die Oberfläche zeigt die beiden Stufen gesperrt mit Hinweis. |
| E2 | **Öffentlich heißt öffentlich.** | Öffentliche Törns, Boote und Profile sind gelistet und indexierbar, ohne 24-h-Verzögerung (offene Fragen 1 und 2 erledigt). |
| E3 | **Fotos nur für Unterstützer**, Speicher für Unterstützer **200 MB** (Tracks, Übersichtsbilder und Fotos zusammen). | Kostenlos: keine Fotos (offene Frage 5 erledigt). Kostenlose Konten: Speicher wie bisher nur über 3 Törns begrenzt. |
| E4 | **Ende der Unterstützung macht nichts öffentlich.** | Nicht öffentliche Objekte bleiben, wie sie sind, bis sie ablaufen (Unterstützungsende + 3 Monate). Neu „Nur mit Link“/„Nur ich“ setzen oder Fotos hinzufügen geht nicht mehr; auf „Öffentlich“ schalten oder löschen geht immer. Eine stille Hochstufung würde private Positionsdaten veröffentlichen. |
| E5 | **Altbestand** wird nicht hochgestuft. | Heute private oder nicht gelistete Törns, Boote und Profile kostenloser Konten bleiben, wie sie sind (F-86); nur Neues folgt E1. |

## 0. Ausgangslage

| Objekt | Heute | Lücke |
|---|---|---|
| Törn (`shares`) | `visibility` ∈ `unlisted`/`private` (SQL-`CHECK`!), dazu `listed` = „auf Profil/Boot gelistet“. Standard: `unlisted`, nicht gelistet. Link `/s/<id>`, die ID (18 Zeichen, ca. 104 Bit) ist zugleich das Geheimnis | Drei Zustände sind auf zwei Spalten verteilt; `public` ist wegen des `CHECK` nicht speicherbar; ein Link lässt sich nicht zurückziehen, ohne den Törn zu löschen |
| Boot | `public`/`private`, Standard `private`, Adresse `/b/<id>` | kein „nur mit Link“, kein sprechender Name in der URL |
| Profil | `public`/`private`, Standard `private`, Adresse `/u/<handle>` | Handle-Wechsel bricht alte Links ohne Weiterleitung |
| Fotos, Kommentare | – | fehlen |
| Kontingent | 3 kostenlose Törns, 100 pro Konto, 200 MB pro Konto (nur Track-Daten), 50 Boote | Vorschaubilder und künftige Fotos zählen nicht; keine Staffel kostenlos/Unterstützer außer der Törn-Anzahl |

## 1. Sichtbarkeitsmodell

### 1.1 Drei Zustände für alle Objekte

| Wert | UI-Text | Wer sieht es | Gelistet (Profil, Boot, /entdecken, Startseite) | Suchmaschinen | Link-Vorschau |
|---|---|---|---|---|---|
| `public` | **Öffentlich** | jeder | ja | siehe 1.4 | voll (Titel, Text, Bild) |
| `unlisted` | **Nur mit Link** | wer den geheimen Link hat (Abschnitt 2) | nie | nie | voll, aber nur über den geheimen Link |
| `private` | **Nur ich** | Eigentümer (bei Booten: Eigner + Admins) | nie | nie | neutral (App-Name) |

Die Werte sind geordnet: `private` (0) < `unlisted` (1) < `public` (2). Sie
stehen in `src/domain/visibility.ts` (rein, von Worker und Oberfläche genutzt,
wie heute `support.ts`) und werden in `worker/validate.ts` geprüft, **nie per
SQL-`CHECK`** (Prinzip Architektur 7).

**Standard für neue Objekte: `public`; für kostenlose Konten die einzige Wahl (E1).** Das gilt für Törns, Boote, Profile und
Fotos. Der Teilen-Dialog wählt „Öffentlich“ vor und sagt in einem Satz, was
dann sichtbar ist („Track mit Positionen und Zeiten, Titel, Fotos – auf deinem
Profil und unter Entdecken“). Prinzip Security 1 bleibt: Hochgeladen wird nur
nach ausdrücklichem Klick.

### 1.2 Vererbung

Grundregel: **Ein Kind ist nie sichtbarer als sein Elternobjekt.**
`effective(kind) = min(kind.visibility, effective(eltern))`.

| Objekt | Eltern | Regel |
|---|---|---|
| Foto | Törn | Eigene Stufe nur `public` („wie der Törn“, Standard) oder `private` („nur ich“). Effektiv = min(Foto, Törn). |
| Kommentar | Törn | keine eigene Stufe, folgt dem Törn; zusätzlich Moderationsstatus (`visible`/`hidden`) |
| Törn | – | **unabhängig** von Boot und Profil. Boot und Profil steuern nur, *wo* er gelistet wird und ob Boot/Autor *genannt* werden |
| Boot, Profil | – | unabhängig |

Kombinationen, die oft vorkommen:

| Fall | Ergebnis |
|---|---|
| Öffentlicher Törn auf privatem Boot | Törn sichtbar und unter /entdecken gelistet; das Boot wird nicht genannt (wie heute `shareShape`), die Bootsseite ist 404 |
| Öffentlicher Törn, Profil privat | Törn sichtbar und gelistet, Autor erscheint als „Segler:in“ ohne Link. Wer nicht gefunden werden will, ist nicht auffindbar; wer den Törn zeigen will, kann das |
| Öffentlicher Törn, Profil `unlisted` | wie privat: Autor ohne Link (der Profil-Schlüssel wird nie über einen anderen Link verraten) |
| Öffentliches Profil/Boot | listet nur **öffentliche** Törns (effektiv), Kennzahlen (sm, Anzahl) zählen ebenfalls nur diese |
| Törn `unlisted`, Foto `public` | Foto effektiv `unlisted`: nur mit dem Törn-Schlüssel abrufbar |
| Törn wird `private` | alle Fotos und Kommentare sofort für andere 404; Kommentieren durch andere ist gesperrt |

**Ein Schlüssel öffnet genau ein Objekt** samt dessen Kindern (Fotos,
Kommentare), nie andere Objekte. Der Link zu einem Boot öffnet also keine
`unlisted`-Törns dieses Bootes.

### 1.3 Listen: /entdecken und Startseite

`/entdecken` (neue Seite, braucht den Router aus PLATFORM Phase 1) und die
Startseite zeigen ausschließlich Törns mit `visibility = 'public'`, sortiert nach
`COALESCE(started_at, created_at)`, Cursor-Paginierung (20 pro Seite, Startseite
6 Kacheln mit Übersichtsbild). Zusätzlich:

- Ausgeblendet werden Törns, die per Meldung automatisch verborgen sind
  (Abschnitt 4.4).
- **Keine Verzögerung (E2):** Ein öffentlicher Törn erscheint sofort in Listen.
  Wer nicht in Echtzeit zeigen will, dass er unterwegs ist, teilt nach dem Törn
  oder nutzt als Unterstützer „Nur mit Link“.
- Boote und Profile kommen in eine zweite Liste („Boote“, „Segler:innen“) nur,
  wenn sie öffentlich sind und mindestens einen öffentlichen Törn haben – gegen
  leere Spam-Seiten.

Index: `CREATE INDEX shares_public ON shares(visibility, started_at DESC)`.

### 1.4 Suchmaschinen und Vorschau

| Seite | `robots` | og:title/description | og:image |
|---|---|---|---|
| `/u/<handle>`, `/b/<slug>` öffentlich | `index` | ja | Bootsfoto/Avatar, falls vorhanden |
| `/entdecken` | `index` | App-Text | – |
| `/s/<id>` öffentlich | `index` (E2) | ja | Übersichtsbild |
| `/s/<id>/<key>` mit gültigem Schlüssel | `noindex` | ja | Bild-URL mit Schlüssel |
| alles Private, falscher/fehlender Schlüssel, Unbekanntes | `noindex` | neutral (`fallback` in `pageMeta`) | – |
| `/api/*` (inkl. Fotos) | `X-Robots-Tag: noindex` | – | – |

Kommentare erscheinen nie in Vorschauen. Fotos nur als og:image, wenn der
Eigentümer ein Foto ausdrücklich als Titelbild wählt (sonst Übersichtsbild).

## 2. Teilen-Links

### 2.1 Adressen

| Objekt | Öffentlich | Nur mit Link | Tiefe Links |
|---|---|---|---|
| Törn | `/s/<id>` | `/s/<id>/<key>` | `?foto=<photoId>`, `?kommentar=<commentId>`; Ansicht weiter `?m=…&l=…` |
| Boot | `/b/<slug>` (neu), `/b/<id>` bleibt gültig | `/b/<id>/<key>` | – |
| Profil | `/u/<handle>` | `/u/<handle>/<key>` | – |
| Foto | über den Törn (`?foto=`) | dto. mit Schlüssel | – |

- **`id` ist stabil und ändert sich nie** (R2-Keys, Fotos, Kommentare hängen
  daran). Geändert wird der **Schlüssel** (`share_key`) bzw. bei Boot/Profil der
  **Slug/Handle**.
- Schlüssel als **Pfadsegment** statt `?k=`: überlebt „URL-Säuberer“ in
  Messengern, kollidiert nicht mit dem Ansichtszustand in der Query.
- API-Aufrufe für `unlisted`-Objekte tragen den Schlüssel als Header
  `X-Share-Key`; `<img>`-Quellen (Fotos, Vorschaubild) als `?k=<key>`, weil
  Bilder keine Header setzen können.
- Öffentliche Objekte akzeptieren auch einen (gültigen oder veralteten)
  Schlüssel im Link, damit geteilte Schlüssel-Links nach „Öffentlich“ weiter
  funktionieren.

### 2.2 Zustandswechsel

| Wechsel | Wirkung auf Links |
|---|---|
| neu `unlisted` | Schlüssel wird erzeugt |
| `private` → `unlisted` | vorhandener Schlüssel wird wiederverwendet, sonst neu erzeugt. Option „Neuen Link erzeugen“ |
| `unlisted` → `public` | `/s/<id>` funktioniert für alle; alte Schlüssel-Links funktionieren weiter |
| `public` → `unlisted` | `/s/<id>` ohne Schlüssel → 404. Schlüssel-Links funktionieren weiter. Checkbox „Bisherige Links ungültig machen“ rotiert zusätzlich |
| `*` → `private` | alles 404 für andere; Schlüssel bleibt gespeichert (für späteres Zurückschalten), Checkbox „Beim Wiederfreigeben neuen Link erzeugen“ ist Standard **an** |
| „Link erneuern“ (jederzeit) | neuer Schlüssel, alte Schlüssel-Links sofort 404 |

Ein öffentliches Objekt kann man nicht „zurückrufen“, indem man nur den Link
ändert – es ist ja gelistet. Wer Empfänger ausschließen will, schaltet auf
„Nur mit Link“ und erneuert den Link. Das erklärt der Dialog in einem Satz.

**Altbestand:** Bestehende `unlisted`-Törns haben `share_key = NULL`. Für sie
gilt die bisherige Regel weiter: `/s/<id>` genügt (die ID hat 104 Bit). Erst mit
„Link erneuern“ oder einem Wechsel bekommen sie einen Schlüssel; ab dann ist
`/s/<id>` allein 404. So bricht kein heute geteilter Link (F-91).

### 2.3 Slugs, Handles, Weiterleitungen

- Boote bekommen einen optionalen, eindeutigen **`slug`** (gleiche Regeln wie
  `normalizeHandle`, gemeinsamer Namensraum mit reservierten Wörtern, z. B.
  `/b/hanse-315-luna`).
- Bei Änderung von Slug oder Handle wandert der alte Wert in `redirects`
  (90 Tage): öffentliche Objekte antworten mit **301** auf die neue Adresse;
  ist das Ziel nicht öffentlich, kommt 404 (eine Weiterleitung darf keine
  Existenz verraten). Der alte Name bleibt 90 Tage für andere gesperrt (gegen
  Identitätsübernahme). Option „Keine Weiterleitung“ für Leute, die bewusst
  nicht mehr gefunden werden wollen – der Name bleibt trotzdem gesperrt.
- Schlüssel-Links werden nie weitergeleitet: erneuert = tot.

### 2.4 Sicherheit

| Punkt | Entscheidung |
|---|---|
| Schlüssellänge | `randomId(22)` aus dem 56-Zeichen-Alphabet = ca. **128 Bit** (Vorgabe ≥ 96 Bit) |
| Speicherung | **im Klartext** in D1. Begründung: Der Eigentümer muss den Link jederzeit erneut kopieren können (F-36), ein Hash würde jedes Kopieren zur Rotation machen. Der Schlüssel schützt nur Daten, die in derselben D1/R2 liegen – wer D1 liest, hat die Daten ohnehin. Session- und Login-Tokens bleiben gehasht, weil sie ein **Konto** übernehmen, nicht ein Objekt. (Alternative ohne Speicherung: HMAC(Secret, id‖Version); verworfen, weil ein verlorenes oder rotiertes Secret alle Links auf einmal tötet.) |
| Vergleich | Zeile per `id` laden, dann `timingSafeEqual(key, row.share_key)` |
| Unberechtigt | immer **404** mit identischem Body wie „gibt es nicht“ – für fremde, private, falscher Schlüssel, fehlender Schlüssel, unbekannte ID. Gleich viele D1-Abfragen in allen Fällen |
| Aufzählung | `unlisted`/`private` erscheinen in keiner Liste, keiner API-Antwort für Fremde, keiner Sitemap. Die Handle-Verfügbarkeitsprüfung (409 `handle_taken`) ist der einzige Existenz-Hinweis und wird rate-limitiert |
| Rate-Limit | neuer Binding `LINK_LIMITER` (30/60 s pro IP), nur auf dem Fehlerpfad (404 bei Schlüssel-Routen) aufgerufen – kostet bei normalen Aufrufen nichts |
| Leaks | Seiten senden `strict-origin-when-cross-origin` (Kachel-Server sehen nur die Origin), API `no-referrer`. Links in Kommentaren bekommen `rel="nofollow ugc noopener noreferrer"` |
| Verwaltung | Schlüssel und Slug sieht und ändert nur der Eigentümer (Boot: Eigner und Admins). `shareShape` liefert `shareKey` nur bei `isOwner` |

## 3. Fotos

### 3.1 Upload im Browser

Der Worker dekodiert keine Bilder (10 ms CPU). Alles passiert im Client:

1. Dateiauswahl/Drag & Drop am geteilten Törn (nur Eigentümer). JPEG, PNG,
   WebP; HEIC nur, wo der Browser es dekodiert (Safari), sonst klare Meldung.
2. **Metadaten lesen** mit eigenem kleinem Parser `src/domain/exif.ts` (rein,
   getestet, keine Abhängigkeit): `GPSLatitude/Longitude`, `DateTimeOriginal`,
   `OffsetTimeOriginal`, `SubSecTimeOriginal`, `Orientation`.
3. **Neu kodieren** (`createImageBitmap` mit `imageOrientation: 'from-image'`,
   `OffscreenCanvas` in einem Web Worker): Vollbild max. **2048 px** lange
   Kante, WebP q≈0,8 (Fallback JPEG q 0,85, wenn der Browser kein WebP
   kodiert); Vorschaubild **400 px**, WebP q 0,7. Durch das Neukodieren ist die
   Datei **frei von EXIF, GPS, Kameradaten und XMP**. Die Position steht nur in
   D1 (Abschnitt 3.2), nie in der Datei.
4. Grenzen im Client vorab prüfen (Anzahl, Größe, Kontingent), dann Upload
   einzeln mit Fortschritt.

Der Worker prüft: Magic Bytes (`RIFF….WEBP` bzw. `FF D8 FF`), Größe, und
**fail closed** auf Metadaten: WebP mit `EXIF`/`XMP `-Chunk bzw. JPEG mit
APP1-Segment werden mit 400 abgelehnt (Chunk-/Segment-Header lesen, < 1 ms).
Breite/Höhe kommen aus dem VP8/VP8L/VP8X- bzw. SOF-Header.

### 3.2 Platzierung auf der Karte

Reihenfolge, Ergebnis in `placement`:

| Stufe | Bedingung | `placement` |
|---|---|---|
| 1. GPS aus EXIF | Koordinate vorhanden **und** ≤ 2 km vom nächsten Trackpunkt | `gps` |
| 2. Zeitabgleich | `DateTimeOriginal` liegt (nach Zeitversatz) zwischen Trackstart − 10 min und Trackende + 10 min | `time`: Position linear zwischen den beiden Nachbarpunkten interpoliert |
| 3. Manuell | Eigentümer setzt das Foto per Klick auf den Track (rastet auf den nächsten Punkt ein) | `manual` |
| 4. Ohne Ort | nichts davon | `none`: nur in der Galerie, nicht auf der Karte |

**GPS fern vom Track** (z. B. Foto zu Hause, im Hafen-Café weit weg) wird
**nicht** übernommen; der Dialog zeigt „Ort verworfen – zu weit vom Track“ und
fällt auf den Zeitabgleich zurück. So landet keine Wohnadresse auf der Karte.

**Zeitversatz** (`src/domain/photo-place.ts`, rein, getestet):

- `DateTimeOriginal` ist Ortszeit ohne Zone. Hat das Foto
  `OffsetTimeOriginal`, wird es genutzt.
- Sonst: Kandidaten von −12 h bis +14 h in 15-min-Schritten; gewählt wird der
  Versatz, bei dem die meisten Fotos des Stapels in die Trackzeit fallen; bei
  Gleichstand der, der dem Browser-Offset zum Trackdatum am nächsten liegt.
- **Kalibrierung:** Haben einige Fotos GPS (Handy) und andere nicht (Kamera),
  wird der Versatz der Kamera aus den GPS-Fotos bestimmt (Zeit am GPS-Ort
  gegen Aufnahmezeit).
- Ein Regler „Zeitversatz der Kamera“ (±15 min fein, ganze Stunden grob)
  verschiebt alle Fotos des Stapels gemeinsam, mit Live-Vorschau auf der Karte.

### 3.3 Darstellung

- **Karte:** eigene Ebene „Fotos“ in `src/map/photo-layer.ts` (von
  `map-view.ts` verwaltet, Komponenten kennen Leaflet nicht). Marker =
  Kamera-Glyphe in `--c-photo` (neues Token, hell/dunkel); einfache
  Raster-Clusterung in Pixeln je Zoomstufe (≤ 100 Fotos pro Törn – keine
  Bibliothek nötig). Klick öffnet die Lightbox, Hover zeigt das Vorschaubild.
- **Verknüpft (Prinzip Design 5):** Fotos mit Zeit erscheinen als Ticks im
  Zeit-Diagramm (`sx-time-chart`); Hover auf ein Foto markiert den Zeitpunkt
  überall, Hover auf den Track zeigt das nächstgelegene Foto an.
- **Galerie:** Leiste `sx-photo-strip` im Panel (chronologisch, unplatzierte
  am Ende), **Lightbox** `sx-photo-lightbox` mit Tastatur (←/→/Esc), Fokusfalle,
  Bildunterschrift, Zeit, „Auf Karte zeigen“, Kommentaranzahl.
- Vorschaubilder `loading="lazy"`; Vollbild erst in der Lightbox.

### 3.4 Datenschutz

| Risiko | Maßnahme |
|---|---|
| Wohnort über Foto-GPS | Datei ohne EXIF; GPS > 2 km vom Track wird verworfen; Position nur in D1, nur so sichtbar wie das Foto |
| Personen auf Fotos (KUG § 22, DSGVO) | Hinweis im Upload-Dialog („Frag die Abgebildeten“); Foto einzeln auf „Nur ich“; Meldegrund „Ich bin auf diesem Foto und möchte das nicht“ (Abschnitt 4.4). Keine automatische Gesichtserkennung |
| Kinder | Hinweis wie oben; Meldungen dieses Grundes blenden sofort aus |
| Aufnahmezeit | `taken_at` wird angezeigt (Teil des Törns); wer das nicht will, stellt das Foto auf „Nur ich“ |

### 3.5 Speicherung

R2 (Bucket `TRACKS`, wie bisher ein Bucket):

```
photos/<shareId>/<photoId>.webp      Vollbild (bzw. .jpg)
photos/<shareId>/<photoId>_t.webp    Vorschaubild
```

`customMetadata: { owner }` wie bei Track-Daten. Gelöscht wird über die
D1-Liste der Foto-IDs (kein R2-`list` nötig).

Ausgeliefert über `GET /api/photos/<id>?s=t|f[&k=<key>]` mit derselben
Prüfung wie der Törn. Cache: effektiv öffentlich `public, max-age=300` +
ETag (Statuswechsel greift binnen 5 min, wie heute beim Vorschaubild),
sonst `private, no-cache`; `Cross-Origin-Resource-Policy: same-origin` (außer
gewähltem Titelbild), `X-Robots-Tag: noindex`.

## 4. Kommentare

### 4.1 Regeln

| Punkt | Entscheidung |
|---|---|
| Woran | Törns. Ein Kommentar kann optional ein **Foto referenzieren** (`photo_id`); die Lightbox zeigt die Kommentare zu diesem Foto, der Törn alle. Ein Thread, flach, keine Antworten-Hierarchie |
| Wer | angemeldet **und mit Profil** (Anzeigename nötig; die E-Mail erscheint nie). Name verlinkt nur bei öffentlichem Profil. Konten jünger als 24 h: max. 3 Kommentare |
| Sichtbarkeit | folgt dem Törn (effektiv). `unlisted`: wer den Schlüssel hat und angemeldet ist, darf kommentieren. `private`: nur der Eigentümer sieht den Törn, Kommentieren durch andere ist zu |
| Format | reiner Text, max. **1000 Zeichen**, `cleanText` ohne Zeilenumbruch-Zusammenfassung (max. 3 Leerzeilen). Kein HTML, kein Markdown. Auto-Links nur für `https?://…`, max. 2 Links pro Kommentar (sonst 400). Darstellung über Lit-Templates (escaped), Links als `<a>` aus dem geparsten Text, nie `innerHTML` |
| Bearbeiten | nein (Phase 1); eigene Kommentare löschen jederzeit |
| Moderation durch Eigentümer | jeden Kommentar auf seinem Törn löschen; `comments_mode` am Törn: `on` (Standard), `off` (Formular weg, Bestehendes bleibt sichtbar), `hidden` (alles ausgeblendet) |
| Mail-Benachrichtigung | **opt-in** pro Konto: `aus` (Standard) / `täglich` (eine Sammelmail pro Tag, nur wenn neue Kommentare) – schont Resend Free (100/Tag). Globales Tageslimit im Cron, Rest am Folgetag |
| Kontolöschung | Kommentare des Kontos werden gelöscht (`ON DELETE CASCADE`), ebenso alle Kommentare auf seinen Törns |

### 4.2 Spam und Limits

- Pro Konto: **10 Kommentare/h, 50/Tag, Abstand ≥ 20 s** (gezählt in D1 über
  `comments(user_id, created_at)`; die Rate-Limit-Bindings kennen nur 10/60 s).
- Pro Törn: max. 500 Kommentare.
- Doppelter Text innerhalb 24 h desselben Kontos → 409.
- Gleiche Limits für alle Stufen: Unterstützen kauft Speicher und Aufbewahrung,
  nicht mehr Reichweite.

### 4.3 Darstellung

`sx-comments` unter den Kennzahlen im Panel (mobil im Bottom-Sheet als eigener
Abschnitt): Liste, Formular, Zeichenzähler, „Melden“, für Eigentümer „Löschen“
und der Schalter Kommentare an/aus. Anzahl als Badge in der Lightbox.

### 4.4 Melden (DSA)

Öffentliche Kommentare und Fotos machen die Plattform zum Hosting-Dienst
(PLATFORM Abschnitt 3). Daher:

- **Melden** für Törns, Fotos, Kommentare, Profile, Boote: angemeldet per
  Knopf (Grund: Spam, beleidigend, rechtswidrig, „Ich bin abgebildet“,
  Sonstiges + Freitext 500 Zeichen); ohne Konto über die Kontaktadresse im
  Impressum (Art. 16 DSA verlangt einen Weg für jeden).
- **Automatisch ausblenden** bei 3 Meldungen verschiedener Konten oder sofort
  bei „Ich bin abgebildet“ – bis zur Prüfung.
- **Admin:** Konten in `ADMIN_USER_IDS` (Worker-Variable) sehen
  `/api/admin/reports` und können ausblenden, löschen, Konto sperren
  (`users.suspended_at`). Gesperrte Konten können nicht mehr hochladen,
  kommentieren oder melden; ihre öffentlichen Inhalte verschwinden aus Listen.
- Meldende bekommen keine Rückmeldung per Mail (Mail-Budget), aber den Status
  in der App.

## 5. Kontingente und Stufen

### 5.1 Werte

| Grenze | Kostenlos | Unterstützer | heute |
|---|---|---|---|
| Törns pro Konto | **3** | **100** (harte Grenze) | 3 / 100 |
| Speicher gesamt (Tracks + Übersichtsbilder + Fotos) | ergibt sich aus 3 Törns (≤ 3 × 12 MB) | **200 MB** (E3) | 200 MB nur Tracks |
| Upload pro Törn (Track, komprimiert) | 12 MB | 12 MB | 12 MB |
| Fotos pro Törn | **keine** (E3) | **100** | – |
| Fotos pro Konto | **keine** | durch 200 MB begrenzt (≈ 450) | – |
| Foto-Datei | Vollbild ≤ 2048 px und ≤ 1 MB, Vorschau ≤ 400 px und ≤ 80 KB | gleich | – |
| Boote (als Eigner) | **3** | **20** | 50 |
| Kommentare | 10/h, 50/Tag | gleich | – |
| Meldungen | 20/Tag | gleich | – |
| Sichtbarkeit | nur „Öffentlich“ (E1) | alle drei Stufen | – |
| Aufbewahrung Törn | 3 Monate ab Upload | bis Ende Unterstützung + 3 Monate | gleich |
| Fotos, Kommentare | folgen ihrem Törn | folgen ihrem Törn | – |

Regeln wie F-60: **Bestehendes bleibt**, nur Neues wird blockiert (402
`supporter_required` bzw. 409 `quota`). Wer nach Ende der Unterstützung über
den kostenlosen Grenzen liegt, behält alles bis zum Ablauf, kann aber nichts
hinzufügen. Speicher wird **vor** dem Einlesen geprüft (wie heute in
`createShare`), Fotos genauso.

Die Werte wandern aus `LIMITS` in `src/domain/limits.ts`:
`limitsFor(tier: 'free' | 'supporter')`, genutzt von Worker und UI (Anzeige
„12 von 20 Fotos“). `GET /api/me/support` liefert zusätzlich `photosUsed`,
`photosMax`, `bytesUsed`, `bytesMax`, `boatsUsed`, `boatsMax`.

### 5.2 Globale Notbremse

Zusätzlich zur Grenze pro Konto: `storage_total` (Summe aus D1, im Cron
nachgerechnet, bei Upload/Löschen inkrementell gepflegt).

| Füllstand R2 | Wirkung |
|---|---|
| < 8 GB | normal |
| 8–9,5 GB | **Foto-Uploads für kostenlose Konten pausiert** („Speicher gerade knapp“), Unterstützer weiter |
| ≥ 9,5 GB | alle Foto-Uploads pausiert; Track-Uploads (klein) laufen weiter |

Fail closed: Fehlt der Wert, gilt „pausiert“. Die Schwellen sind
Worker-Variablen; nach einem bewussten Wechsel auf bezahltes R2 (siehe 5.4)
werden sie angehoben.

### 5.3 Abgleich mit dem Free Tier

| Ressource | Free Tier | Verbrauch | Engpass |
|---|---|---|---|
| R2 Speicher | 10 GB | Track ≈ 0,3 MB, Foto ≈ 0,4 MB (Voll + Vorschau) | **der Engpass** (siehe Rechnung) |
| R2 Class A (Schreiben) | 1 Mio./Monat | 2 Puts pro Foto | ca. 500.000 Fotos/Monat – kein Thema |
| R2 Class B (Lesen) | 10 Mio./Monat | 1 Get pro Bildaufruf | über Worker-Requests gedeckelt |
| D1 Größe | 5 GB | Foto-Zeile ≈ 300 B, Kommentar ≈ 1,2 KB | > 1 Mio. Kommentare passen – kein Thema |
| D1 Reads | 5 Mio. Zeilen/Tag | alle Listen per Index, `LIMIT` | ok mit den Indizes aus 6.1 |
| D1 Writes | 100.000/Tag | Kommentar 1–2, Foto 2 | ok |
| Worker-Requests | 100.000/Tag | Törn-Aufruf ≈ 6 + sichtbare Vorschaubilder (lazy, ≈ 10) | ca. **6.000 Törn-Aufrufe/Tag** |
| Worker-CPU | 10 ms | Bild nur Header-Prüfung (< 1 ms), keine Dekodierung | ok |
| Mail (Resend Free) | 100/Tag | Login, Ablauf-Warnung, Kommentar-Digest | Digest opt-in und gedeckelt |

**Kapazität R2** (aktive Konten = Törns in den letzten 3 Monaten bzw.
Unterstützer):

| Annahme | kostenlos (Ø) | Unterstützer (Ø) |
|---|---|---|
| Törns | 2 × 0,3 MB | 20 × 0,4 MB |
| Fotos | 15 × 0,4 MB | 150 × 0,4 MB |
| Summe | **≈ 6,6 MB** | **≈ 68 MB** |

*(Rechnung vor E3; mit „Fotos nur für Unterstützer“ und 200 MB liegt die Kapazität deutlich höher, grob 1.500–2.000 aktive Konten bei 10 % Unterstützern.)*

Bei 10 % Unterstützern: Ø 0,9 × 6,6 + 0,1 × 68 ≈ **12,7 MB pro Konto** →
8 GB / 12,7 MB ≈ **600–650 aktive Konten mit Fotos**. Ohne Fotos (nur Tracks)
wären es ≈ 6.000. Schlimmster Fall, alle schöpfen voll aus: 160 kostenlose
Konten oder 16 Unterstützer – genau dafür gibt es die Notbremse.

### 5.4 Fairness und Kosten

- **Harte Grenze auch für Unterstützer:** Ein Konto darf höchstens 2 % des
  Free Tiers belegen (200 MB von 10 GB). Ein einzelnes Konto kann so nie die
  Plattform für alle anderen voll machen; ohne Grenze wären 20 eifrige
  Fotografen das Ende des Free Tiers.
- Unterstützung kauft **Platz und Zeit** (mehr Törns, Fotos, Aufbewahrung),
  nicht Sichtbarkeit oder Lautstärke (gleiche Kommentar-Limits, gleiche
  Listen-Regeln).
- Rechnung, falls R2 über 10 GB wächst: ca. 0,015 $/GB-Monat. 100 GB kosten
  ≈ 1,35 $/Monat – ein „Kaffee“ (3 €) deckt rund 200 GB-Monate. Wechsel auf
  bezahltes R2 ist ohne Workers Paid möglich (offene Frage 6).

## 6. Datenmodell, API, Oberfläche

### 6.1 Migrationen

**Reihenfolge:** Erst Code ausrollen, der beide Darstellungen versteht
(`listed`+`unlisted` **und** `public`), dann `0005` anwenden. `listed` bleibt
eine Version lang als Spalte stehen und wird erst in `0007` entfernt.

```sql
-- 0005_visibility.sql: shares ohne CHECK neu bauen, Sichtbarkeit vereinheitlichen.
-- Nichts referenziert shares per Fremdschlüssel – Neubau jetzt, bevor photos/comments dazukommen.
-- D1 erzwingt Fremdschlüssel; für den Neubau innerhalb der Migration aufschieben.
PRAGMA defer_foreign_keys = true;
CREATE TABLE shares_new (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  visibility       TEXT NOT NULL DEFAULT 'public',  -- public|unlisted|private (worker/validate.ts)
  share_key        TEXT,                             -- NULL: Altbestand, /s/<id> genügt
  view             TEXT NOT NULL DEFAULT '',
  size_bytes       INTEGER NOT NULL,
  track_count      INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  boat_id          TEXT REFERENCES boats(id) ON DELETE SET NULL,
  listed           INTEGER NOT NULL DEFAULT 0,       -- veraltet, entfällt in 0007
  dist_nm          REAL NOT NULL DEFAULT 0,
  started_at       INTEGER,
  ended_at         INTEGER,                          -- für die 24-h-Verzögerung in Listen
  has_image        INTEGER NOT NULL DEFAULT 0,
  image_bytes      INTEGER NOT NULL DEFAULT 0,       -- Übersichtsbild zählt zum Speicher
  cover_photo_id   TEXT,                             -- optionales Titelbild (og:image)
  comments_mode    TEXT NOT NULL DEFAULT 'on',       -- on|off|hidden
  hidden_at        INTEGER,                          -- per Meldung/Admin ausgeblendet
  expiry_warned_at INTEGER
);
INSERT INTO shares_new (id, user_id, title, summary, visibility, view, size_bytes, track_count,
  created_at, updated_at, boat_id, listed, dist_nm, started_at, has_image, expiry_warned_at)
SELECT id, user_id, title, summary,
  CASE WHEN visibility = 'private' THEN 'private'
       WHEN listed = 1 THEN 'public'      -- war schon „Öffentlich“ (F-44)
       ELSE 'unlisted' END,
  view, size_bytes, track_count, created_at, updated_at, boat_id, listed, dist_nm, started_at, has_image, expiry_warned_at
FROM shares;
DROP TABLE shares;
ALTER TABLE shares_new RENAME TO shares;
CREATE INDEX shares_user    ON shares(user_id, created_at DESC);
CREATE INDEX shares_boat    ON shares(boat_id, started_at DESC);
CREATE INDEX shares_created ON shares(created_at);
CREATE INDEX shares_public  ON shares(visibility, started_at DESC);

-- Boote und Profile: dritter Zustand und Schlüssel; Bestehende behalten ihre Sichtbarkeit.
ALTER TABLE boats    ADD COLUMN share_key TEXT;
ALTER TABLE boats    ADD COLUMN slug TEXT;            -- optional, eindeutig (Index unten)
ALTER TABLE boats    ADD COLUMN hidden_at INTEGER;
CREATE UNIQUE INDEX boats_slug ON boats(slug COLLATE NOCASE) WHERE slug IS NOT NULL;
ALTER TABLE profiles ADD COLUMN share_key TEXT;
ALTER TABLE profiles ADD COLUMN hidden_at INTEGER;

-- Alte Slugs/Handles: 90 Tage Weiterleitung bzw. Sperre.
CREATE TABLE redirects (
  kind       TEXT NOT NULL,              -- boat|profile
  old_slug   TEXT NOT NULL COLLATE NOCASE,
  target_id  TEXT NOT NULL,              -- boats.id bzw. profiles.user_id
  follow     INTEGER NOT NULL DEFAULT 1, -- 0 = nur sperren, nicht weiterleiten
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, old_slug)
);

ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN notify_comments TEXT NOT NULL DEFAULT 'off';  -- off|daily
```

**Bestehende Daten:** `unlisted`+`listed` → `public` (die UI nannte es schon
„Öffentlich“); `unlisted` → `unlisted` mit `share_key = NULL` (Links bleiben
gültig); `private` bleibt. Boote und Profile bleiben, wie sie sind – **keine
stille Hochstufung** auf öffentlich; der neue Standard gilt nur für neu
Angelegtes. Einmaliger Hinweis im Konto: „Neu: Öffentliche Törns erscheinen
auch unter Entdecken.“

```sql
-- 0006_photos_comments.sql
CREATE TABLE photos (
  id          TEXT PRIMARY KEY,
  share_id    TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visibility  TEXT NOT NULL DEFAULT 'public',   -- public (= wie Törn) | private
  caption     TEXT NOT NULL DEFAULT '',         -- max. 200 Zeichen
  taken_at    INTEGER,                          -- UTC ms nach Zeitversatz
  lat         REAL, lon REAL,                   -- auf 5 Nachkommastellen gerundet
  placement   TEXT NOT NULL DEFAULT 'none',     -- gps|time|manual|none
  width       INTEGER NOT NULL, height INTEGER NOT NULL,
  format      TEXT NOT NULL DEFAULT 'webp',     -- webp|jpeg
  bytes       INTEGER NOT NULL,                 -- Voll + Vorschau
  hidden_at   INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX photos_share ON photos(share_id, taken_at);
CREATE INDEX photos_user  ON photos(user_id);

CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  share_id   TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  photo_id   TEXT REFERENCES photos(id) ON DELETE SET NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'visible',   -- visible|hidden
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_share ON comments(share_id, created_at);
CREATE INDEX comments_user  ON comments(user_id, created_at);
-- Für den Tages-Digest: „seit letzter Mail“
ALTER TABLE users ADD COLUMN comments_mailed_at INTEGER;

CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,                    -- share|photo|comment|profile|boat
  target_id   TEXT NOT NULL,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,                    -- spam|abuse|illegal|depicted|other
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution  TEXT,                             -- kept|hidden|deleted
  UNIQUE (target_kind, target_id, reporter_id)
);
CREATE INDEX reports_open ON reports(resolved_at, created_at);

-- Globaler Speicherzähler für die Notbremse (eine Zeile).
CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO counters VALUES ('storage_bytes', 0);
```

`0007_drop_listed.sql`: Tabelle erneut ohne `listed` umkopieren (oder
`ALTER TABLE shares DROP COLUMN listed`, das D1/SQLite ≥ 3.35 kann).

**Aufräumen anpassen:** `retention.ts` (`deleteExpired`) und `purgeUser`
löschen zusätzlich `photos/<shareId>/<photoId>{,_t}.<ext>` anhand der
`photos`-Zeilen; D1-Zeilen fallen per `ON DELETE CASCADE` (D1 erzwingt
Fremdschlüssel). `supportStatus` summiert
`shares.size_bytes + shares.image_bytes + photos.bytes`.

### 6.2 R2

| Key | Inhalt |
|---|---|
| `shares/<id>` | Track-Payload (gzip), unverändert |
| `previews/<id>.jpg` | Übersichtsbild, unverändert |
| `photos/<shareId>/<photoId>.webp` | Vollbild |
| `photos/<shareId>/<photoId>_t.webp` | Vorschaubild |
| `media/boats/<boatId>.webp`, `media/avatars/<userId>.webp` | spätere Boots-/Profilbilder (PLATFORM Phase 2), gleiche Pipeline |

### 6.3 API

Alle Mutationen same-origin, alle fremden/unsichtbaren Objekte 404.
`X-Share-Key` (bzw. `?k=` bei Bildern) wo „Schlüssel“ steht.

| Methode | Pfad | Wer | Zweck |
|---|---|---|---|
| GET | `/api/shares/:id`, `/data`, `/image` | sichtbar (+Schlüssel) | wie heute, mit 3-Stufen-Prüfung |
| PATCH | `/api/shares/:id` | Eigentümer | zusätzlich `visibility: public`, `commentsMode`, `coverPhotoId`, `rotateKey: true` |
| GET | `/api/explore?cursor=` | alle | öffentliche Törns (+ Boote/Profile mit `?kind=`) |
| GET | `/api/shares/:id/photos` | sichtbar (+Schlüssel) | Foto-Metadaten (effektiv sichtbare; Eigentümer alle) |
| POST | `/api/shares/:id/photos` | Eigentümer | Body = Vorschau ‖ Vollbild, Header `X-Photo-Thumb-Length`, `X-Photo-Meta` (JSON: caption, takenAt, lat, lon, placement, w, h); Kontingent vorab |
| PATCH | `/api/photos/:id` | Eigentümer | Bildunterschrift, Position/Platzierung, Sichtbarkeit |
| DELETE | `/api/photos/:id` | Eigentümer | löscht R2 + D1 |
| GET | `/api/photos/:id?s=t\|f[&k=]` | sichtbar | Bilddaten |
| GET | `/api/shares/:id/comments` | sichtbar (+Schlüssel) | Liste (max. 500) |
| POST | `/api/shares/:id/comments` | angemeldet mit Profil, Törn sichtbar, `comments_mode = on` | `{ body, photoId? }` |
| DELETE | `/api/comments/:id` | Autor oder Törn-Eigentümer | löschen |
| POST | `/api/reports` | angemeldet | `{ kind, id, reason, note }` |
| GET/POST | `/api/admin/reports`, `/api/admin/reports/:id` | `ADMIN_USER_IDS` | sichten, entscheiden |
| PATCH | `/api/boats/:id` | Eigner/Admins | zusätzlich `slug`, `visibility: unlisted`, `rotateKey`, `redirect: bool` |
| PUT | `/api/me/profile` | selbst | zusätzlich `unlisted`, `rotateKey`, `redirect: bool` |
| PATCH | `/api/me/settings` | selbst | `notifyComments` |

Seitenrouten im Worker (`metaPage`): `/s/:id(/:key)?`, `/b/:idOrSlug(/:key)?`,
`/u/:handle(/:key)?`, `/entdecken`; Redirect-Auflösung vor dem 404.

Neue Worker-Module: `worker/access.ts` (reine Funktionen `canView(viewer,
obj, key)`, `effective()`, getestet – ersetzt `visibleShare`/`ownedShare`
und die Prüfungen in `boats.ts`/`profiles.ts`), `worker/links.ts`
(Schlüssel, Slugs, Redirects), `worker/photos.ts`, `worker/comments.ts`,
`worker/reports.ts`, `worker/explore.ts`.

### 6.4 Oberfläche

| Stelle | Änderung |
|---|---|
| `src/domain/visibility.ts`, `limits.ts`, `exif.ts`, `photo-place.ts`, `comment-text.ts` (Auto-Link-Parser) | neu, rein, mit Tests |
| `src/services/photo-process.ts` (+ Web Worker) | Dekodieren, Skalieren, Kodieren |
| `src/services/api.ts` | neue Endpunkte, `X-Share-Key` |
| `sx-visibility-picker` (neu, geteilt) | drei Optionen mit je einem Erklärsatz; genutzt in Teilen-Dialog, Boot, Profil, Foto (nur 2 Optionen) |
| `sx-share-dialog` | Standard „Öffentlich“, Link je nach Stufe, „Link erneuern“, Kontingent-Anzeige inkl. Fotos |
| `sx-account-dialog` / „Meine Törns“ | Sichtbarkeit (3), Link kopieren/erneuern, Kommentare an/aus, Speicheranzeige, Mail-Einstellung |
| `sx-profile-page` | Handle/Slug ändern mit Weiterleitungs-Option, Boots-Sichtbarkeit (3), Schlüssel-Link |
| `sx-photo-upload` (neu) | Auswahl, Platzierungs-Status je Foto, Zeitversatz-Regler, Fortschritt |
| `sx-photo-strip`, `sx-photo-lightbox` (neu) | Galerie und Großansicht |
| `src/map/photo-layer.ts` | Marker, Clusterung, manuelles Platzieren |
| `sx-time-chart` | Foto-Ticks |
| `sx-comments`, `sx-report-dialog` (neu) | Kommentare und Melden |
| `sx-explore-page` (neu) + Startseite (`sx-empty-state`) | Kacheln öffentlicher Törns |
| `tokens.css` | `--c-photo` (hell/dunkel) |

## 7. Stufenplan

| Phase | Inhalt | Warum zuerst |
|---|---|---|
| **A – Sichtbarkeit & Links** | `visibility.ts`, `access.ts`, Code für beide Darstellungen, `0005`, Schlüssel + „Link erneuern“, Standard `public`, Teilen-Dialog, `/entdecken` (einfach) | Alles Weitere erbt davon; der Tabellenneubau muss vor den ersten Fremdschlüsseln auf `shares` passieren |
| **B – Kontingente** | `limits.ts`, Speicher inkl. Bilder, Boote-Grenze, globaler Zähler + Notbremse, Anzeige im Konto | Muss stehen, bevor Fotos Speicher verbrauchen |
| **C – Fotos** | `0006` (photos), EXIF, Pipeline, Upload, Platzierung (GPS → Zeit → manuell), Karte, Galerie, Lightbox, Aufräumen | größter Nutzerwert |
| **D – Kommentare & Melden** | comments, reports, Admin-Liste, Sperren, Tages-Digest | erst mit Melde-Weg online (DSA) |
| **E – Feinschliff** | Boots-Slugs, Redirects, Titelbild als og:image, Foto-Ticks im Diagramm, `0007` | unabhängig, kann parallel laufen |

## 8. Anforderungen (neu)

### Sichtbarkeit

- **F-80** Törns, Boote und Profile haben die Sichtbarkeit „Öffentlich“, „Nur mit Link“ oder „Nur ich“ (die letzten beiden nur für Unterstützer, F-124); neue Objekte sind standardmäßig öffentlich, der Dialog erklärt die Folgen vor dem Speichern.
- **F-81** Fotos haben „Wie der Törn“ (Standard) oder „Nur ich“; Kommentare folgen dem Törn. Ein Kind ist nie sichtbarer als sein Törn.
- **F-82** Ein Törn ist unabhängig von Boot und Profil sichtbar; ist das Boot nicht öffentlich, wird es nicht genannt; ist das Profil nicht öffentlich, erscheint der Autor ohne Namen-Link.
- **F-83** Profil- und Bootsseiten, `/entdecken` und die Startseite listen nur öffentliche Objekte; Kennzahlen zählen nur öffentliche Törns. Öffentliche Törns erscheinen sofort.
- **F-84** Indexierbar sind öffentliche Törns, Profile, Boote und `/entdecken`; Schlüssel-Links, Privates und `/api/*` tragen `noindex`.
- **F-85** Link-Vorschau mit Titel, Text und Bild für öffentliche Objekte und für „Nur mit Link“ über den gültigen Schlüssel-Link; sonst neutral.
- **F-86** Bestehende Freigaben werden übernommen: gelistet → öffentlich, nicht gelistet → nur mit Link, privat → privat. Boote und Profile behalten ihre Sichtbarkeit.

### Links

- **F-90** „Nur mit Link“ ist über `/<art>/<id oder name>/<schlüssel>` erreichbar; der Schlüssel hat ≥ 96 Bit (umgesetzt: 128), nur der Eigentümer sieht und erneuert ihn.
- **F-91** Bestehende Links `/s/<id>` funktionieren weiter, bis der Eigentümer den Link erneuert oder die Sichtbarkeit ändert.
- **F-92** „Link erneuern“ macht alle bisherigen Schlüssel-Links sofort ungültig; beim Wechsel auf „Nur ich“ ist das für die nächste Freigabe vorausgewählt.
- **F-93** Falscher, fehlender oder veralteter Schlüssel, private und unbekannte Objekte antworten gleich (404); Fehlversuche sind pro IP begrenzt.
- **F-94** Boote können einen sprechenden Namen (`/b/<slug>`) haben. Geänderte Namen und Handles leiten 90 Tage weiter (abschaltbar) und bleiben so lange für andere gesperrt; Weiterleitungen auf nicht öffentliche Ziele antworten 404.

### Fotos

- **F-100** Eigentümer laden Fotos zu einem geteilten Törn hoch (JPEG, PNG, WebP; HEIC, wo der Browser es kann). Der Browser verkleinert auf ≤ 2048 px und erzeugt ein Vorschaubild ≤ 400 px.
- **F-101** Gespeicherte Bilder enthalten keine Metadaten (EXIF, GPS, XMP); der Server lehnt Bilder mit Metadaten ab.
- **F-102** Platzierung: GPS aus dem Foto, wenn ≤ 2 km vom Track; sonst Abgleich der Aufnahmezeit mit dem Track (Zeitzone aus dem Foto, sonst geschätzt, per Regler korrigierbar); sonst manuell oder ohne Ort in der Galerie.
- **F-103** Fotos erscheinen als geclusterte Marker auf der Karte, als Ticks im Zeit-Diagramm und in einer Galerie mit Lightbox (Tastatur, Fokus); Hover verknüpft Foto, Karte und Diagramm.
- **F-104** Fotos werden mit ihrem Törn gelöscht (Löschen, Ablauf, Kontolöschung) und zählen zum Speicherkontingent.

### Kommentare

- **F-110** Angemeldete mit Profil kommentieren sichtbare Törns (optional mit Bezug auf ein Foto); reiner Text ≤ 1000 Zeichen, Links werden klickbar (`nofollow ugc noopener noreferrer`), max. 2 pro Kommentar.
- **F-111** Der Törn-Eigentümer löscht Kommentare auf seinem Törn und schaltet Kommentare an, aus oder ausgeblendet; Autoren löschen eigene Kommentare.
- **F-112** Limits: 10/h, 50/Tag, ≥ 20 s Abstand pro Konto, neue Konten (< 24 h) max. 3; doppelte Texte werden abgelehnt.
- **F-113** Benachrichtigung über neue Kommentare nur auf Wunsch als tägliche Sammelmail.
- **F-114** Törns, Fotos, Kommentare, Profile und Boote lassen sich melden; 3 Meldungen bzw. „Ich bin abgebildet“ blenden bis zur Prüfung aus; Admins entscheiden und können Konten sperren.

### Kontingente

- **F-120** Grenzen pro Konto wie in Abschnitt 5.1 (kostenlos / Unterstützer); bestehende Inhalte bleiben bei Überschreitung erhalten, nur Neues wird abgelehnt.
- **F-121** Auch Unterstützer haben harte Obergrenzen (100 Törns, 200 MB inkl. Fotos, 100 Fotos pro Törn, 20 Boote).
- **F-124** Kostenlose Konten speichern nur Öffentliches und keine Fotos; „Nur mit Link“, „Nur ich“ und Fotos verlangen laufenden Unterstützer-Status (sonst 402). Endet die Unterstützung, bleiben bestehende nicht öffentliche Objekte unverändert bis zu ihrem Ablauf.
- **F-122** Ab 8 GB Gesamtspeicher pausieren Foto-Uploads kostenloser Konten, ab 9,5 GB alle Foto-Uploads; fehlt der Zähler, gilt „pausiert“.
- **F-123** Konto und Teilen-Dialog zeigen Törns, Fotos und Speicher als „x von y“.

## 9. Offene Fragen an den Betreiber

*Erledigt durch E1–E5: Fragen 1, 2 und 5.*

1. ~~**Öffentliche Törns indexieren?**~~ → ja (E2). Vorschlag: nein (`noindex`), nur Profile,
   Boote und /entdecken. Törns enthalten Positionen und Zeiten.
2. ~~**24-h-Verzögerung in Listen**~~ → nein (E2). (Abwesenheit von zu Hause) – ja? Auch für
   Unterstützer, oder einstellbar?
3. **Privatzonen vor „öffentlich als Standard“?** Start/Ziel liegen oft am
   Liegeplatz. Vorschlag: mindestens „Start und Ziel um 500 m kürzen“ als
   Option im Teilen-Dialog in Phase A (PLATFORM `privacy.ts`).
4. **Kommentare an Fotos:** ein Thread pro Törn mit Foto-Bezug (Vorschlag)
   oder eigene Threads pro Foto?
5. ~~**Fotos auch kostenlos?**~~ → nein (E3). Vorschlag ja (20 pro Törn, 60 gesamt) – Fotos
   sind der stärkste Grund zu unterstützen, wenn man sie erst einmal nutzt.
6. **Über 10 GB R2 bezahlen** (≈ 0,015 $/GB, aus Unterstützungen gedeckt) oder
   harte Notbremse dauerhaft?
7. **Wer moderiert?** Admin-Konten, Kontaktadresse für Meldungen ohne Konto,
   Reaktionszeit – nötig, bevor Kommentare live gehen (DSA, Impressum).
8. **Boote-Grenze kostenlos von 50 auf 3 senken?** Öffentliche, indexierbare
   Bootsseiten sind ein Spam-Ziel; Bestehendes bliebe.
9. **Kommentieren nur mit Profil?** Vorschlag ja (Anzeigename nötig, Profil
   darf privat sein).
10. **Altbestand-Links ohne Schlüssel** dauerhaft gültig lassen (Vorschlag)
    oder nach einer Frist auf Schlüssel umstellen?
11. **Gast-Fotos lokal** (ohne Konto, IndexedDB) wie die Tracks – lohnt sich
    das, oder sind Fotos ein reines Teilen-Feature?

## 10. Einladungen

Stand: Oktober 2026. Zwei Fälle: **Boots-Admins** (Eigner lädt per E-Mail oder
Profilname zum Mitverwalten ein) und **Crew auf einem Törn** (Eigentümer trägt
Mitsegler ein, per Einladungslink, E-Mail oder Profilname). Per E-Mail kommen
**neue** Leute ins System; **bestehende** Konten erreicht man per E-Mail genauso
oder gezielt über ihren registrierten Profilnamen. Anforderungen: **F-130 ff.**
(`REQUIREMENTS.md`). Umsetzung: `migrations/0007_invites.sql`,
`worker/invites.ts`, `src/components/sx-crew.ts`, `sx-invite-dialog.ts`,
Admin-Bereich im Boote-Reiter von `sx-account-dialog`.

### 10.1 Datenmodell (`0007_invites.sql`)

```sql
CREATE TABLE invites (
  id          TEXT PRIMARY KEY,          -- randomId(), zum Zurückziehen; nie das Geheimnis
  token_hash  TEXT NOT NULL UNIQUE,      -- SHA-256 des Tokens (wie login_tokens)
  kind        TEXT NOT NULL,             -- boat_admin | crew (worker/validate.ts, kein CHECK)
  boat_id     TEXT REFERENCES boats(id)  ON DELETE CASCADE,   -- genau eins von boat_id/share_id
  share_id    TEXT REFERENCES shares(id) ON DELETE CASCADE,
  inviter_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT,                      -- gebunden an diese Adresse; NULL = Einladungslink (nur Crew)
  max_uses    INTEGER NOT NULL DEFAULT 1,
  uses        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE share_crew (                -- Mitsegler eines Törns
  share_id   TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, user_id)
);
```

`0008_invite_invitee.sql` ergänzt `invitee_id TEXT REFERENCES users(id) ON DELETE
CASCADE`: Einladungen über den Profilnamen sind an dieses **Konto** gebunden statt
an eine Adresse; die Mail geht an die Adresse des Kontos, die nur der Server kennt.

`boat_admins` (0002) bleibt unverändert. Zwei Fremdschlüssel statt einer
generischen `target_id`, damit Löschen von Boot, Törn oder Konto die
Einladungen per `ON DELETE CASCADE` mitnimmt (D1 erzwingt Fremdschlüssel;
`purgeUser` und `deleteBoat` löschen zusätzlich explizit).

| Einladung | Bindung | Gültig | Nutzungen |
|---|---|---|---|
| Boots-Admin | per E-Mail (an die Adresse gebunden) oder Profilname (an das Konto gebunden) | 7 Tage | 1 |
| Crew per E-Mail oder Profilname | an die Adresse bzw. das Konto gebunden | 14 Tage | 1 |
| Crew per Link | ohne Adresse, wer den Link hat | 14 Tage | bis 30 (= Crew-Obergrenze) |

Token: `randomToken()` (256 Bit, base64url), gespeichert nur als Hash. Der
Klartext steht **nur** im Link der Mail bzw. in der Antwort beim Erzeugen eines
Einladungslinks – später lässt er sich nicht erneut anzeigen; wer ihn verliert,
erzeugt einen neuen und zieht den alten zurück.

### 10.2 Ablauf

1. Link `https://…/einladung#token=<token>`: Token im **Fragment** (landet in
   keinem Server-Log, keinem Referrer), die App löst per POST ein – Mail-Scanner,
   die nur GET machen, verbrauchen nichts (wie der Magic Link).
2. `POST /api/invites/peek` zeigt, wozu eingeladen wird (Boot bzw. Törn, wer
   einlädt, ob die Einladung an eine Adresse gebunden ist und ob sie zum
   angemeldeten Konto passt – die Adresse selbst nie) – ohne einzulösen.
3. Nicht angemeldet → Anmeldedialog (Magic Link); nach der Anmeldung (auch aus
   einem anderen Tab) erscheint die Einladung wieder.
4. **Ausdrückliche Bestätigung** „Annehmen“ (`POST /api/invites/accept`), nie
   automatisch – gleicher Schutz wie „Als … anmelden?“.
5. Prüfungen beim Annehmen: gültig, nicht abgelaufen, Nutzungen frei;
   gebundene Einladung nur für das Konto mit genau dieser Adresse (sonst 403
   `invite_wrong_account`, ohne die Adresse zu nennen); Crew braucht kein Profil
   (ohne eigenen Namen gilt der Spaßname, 10.6);
   Eigentümer bzw. Eigner (409 `own_object`) und bestehende Mitglieder werden
   nicht doppelt eingetragen (ohne eine Nutzung zu verbrauchen); Obergrenzen
   (10.5). Die Nutzung wird atomar gezählt
   (`UPDATE … SET uses = uses + 1 WHERE uses < max_uses … RETURNING`).

### 10.3 API

Alle Mutationen same-origin, angemeldet; fremde Objekte 404.

| Methode | Pfad | Wer | Zweck |
|---|---|---|---|
| GET | `/api/boats/:id/admins` | Eigner, Admins | Admins mit Anzeigenamen (nie E-Mail) und offene Einladungen (nur Eigner) |
| POST | `/api/boats/:id/invites` | Eigner | `{ email }` oder `{ handle }` – Einladung per Mail |
| DELETE | `/api/boats/:id/admins/:userId` | Eigner (jeden), Admin (nur sich: „Boot verlassen“) | entfernen |
| GET | `/api/shares/:id/crew` | wer den Törn sehen darf | Crew (Regeln 10.6); Eigentümer zusätzlich IDs und offene Einladungen |
| POST | `/api/shares/:id/invites` | Eigentümer | `{ email }` oder `{ handle }` per Mail, `{}` → Einladungslink (Token einmalig in der Antwort) |
| GET | `/api/me/invites` | angemeldet | Posteingang: offene Einladungen an mein Konto bzw. meine Adresse |
| POST | `/api/me/invites/:id/accept` | Empfänger | aus dem Posteingang annehmen (gleiche Prüfungen wie per Link) |
| DELETE | `/api/me/invites/:id` | Empfänger | ablehnen (verschwindet auch beim Einladenden) |
| DELETE | `/api/shares/:id/crew/:userId` | Eigentümer (jeden), Crew (nur sich) | entfernen |
| DELETE | `/api/invites/:id` | Eigentümer des Ziels | Einladung zurückziehen (Zeile wird gelöscht) |
| POST | `/api/invites/peek` | alle | `{ token }` → Art, Ziel, Einladender, gebunden ja/nein, Ablauf |
| POST | `/api/invites/accept` | angemeldet | `{ token }` → Mitgliedschaft |
| GET | `/api/profiles/:handle` | wie bisher | zusätzlich `crewVoyages`: öffentliche Törns, auf denen die Person Crew ist |

Die Antwort auf das Erzeugen einer Mail-Einladung ist gleich, ob es zur Adresse
schon ein Konto gibt oder nicht, und auch, ob die Person schon Admin bzw. Crew
ist (keine Konto-Enumeration, kein Ausprobieren fremder Adressen) – ein
bestehendes Mitglied verbraucht beim Annehmen einfach nichts. Dass es trotzdem
**für bestehende Konten funktioniert**, sieht der Einladende am Hinweis im
Formular und am Ergebnis (die Person erscheint nach dem Annehmen mit Namen in
der Liste); die eingeladene Person findet die Einladung zusätzlich zur Mail in
ihrem Konto unter „Einladungen an dich“.

**Profilname (`{ handle }`, auch mit „@“):** nur öffentliche Profile; private,
„Nur mit Link“ und unbekannte Namen antworten gleich (404 `profile_not_found`).
Da der Name öffentlich ist, darf hier „schon dabei“ (409 `already_member`)
gemeldet werden. Die offene Einladung zeigt dem Einladenden den Namen, nie die
Adresse. Lokal im Log-Modus
liefert der Server wie beim Login einen `devLink`. „Mich selbst“ heißt im Pfad
`me` (`/api/boats/:id/admins/me`, `/api/shares/:id/crew/me`).

### 10.4 Mails

Eine neue Vorlage `inviteMail` in `worker/mail.ts`, Text und HTML, deutsch:
„<Name> lädt dich ein, das Boot „<Boot>“ bei Sail Explorer mitzuverwalten“
bzw. „… in die Crew des Törns „<Titel>““. Der Name ist der Anzeigename des
Profils, sonst der Spaßname des Kontos (10.6) – nie die E-Mail-Adresse, Boots- und Törnnamen sind
Nutzertext und werden **escaped** und gekürzt. Hinweis auf Gültigkeit und
„Wenn du niemanden kennst, ignoriere die Mail“. Kein Tracking, keine Bilder.

### 10.5 Missbrauchsgrenzen

| Grenze | Wert |
|---|---|
| Einladungen pro Konto | 20 in 24 h (Mail und Link zusammen, gezählt in D1) |
| Schnelle Folge | `AUTH_LIMITER` pro Konto (5 pro 60 s) beim Erzeugen |
| Boots-Admins | höchstens 10 je Boot, offene Einladungen mitgezählt |
| Crew | höchstens 30 je Törn; höchstens 10 offene Einladungen je Törn |
| Doppelt | offene Einladung für dieselbe Adresse und dasselbe Ziel → 409 `already_invited` (zurückziehen und neu einladen); geprüft wird nur gegen eigene offene Einladungen, nie gegen Adressen von Konten |
| Mail-Budget | höchstens 50 Einladungsmails in 24 h für den ganzen Server (Resend Free: 100/Tag, der Rest bleibt für Anmeldungen) → 429 mit Hinweis auf den Einladungslink |
| Fehlversuche | ungültige Tokens bei peek/accept zählen gegen `LINK_LIMITER` (pro IP) |
| Aufräumen | der nächtliche Cron löscht abgelaufene und aufgebrauchte Einladungen |

Gleiche Grenzen für kostenlos und Unterstützer (Unterstützen kauft Platz, nicht
Reichweite, 5.4). Einladen braucht keinen Unterstützer-Status.

### 10.6 Datenschutz

- **Crew erscheint nur auf öffentlichen Törns** – auf der Törn-Ansicht und auf
  dem eigenen Profil („Mitgesegelt“). Für „Nur mit Link“ und „Nur ich“ sehen
  Besucher keine Crew; der Eigentümer sieht sie immer.
- Namentlich (mit Link zum Profil) nur Mitglieder mit **öffentlichem Profil**;
  alle anderen zählen nur als „+ n weitere“ (wie der Autor in F-82).
- **Crew-Sein öffnet nichts**: Mitgliedschaft gibt keinen Zugriff auf nicht
  öffentliche Törns (ein Schlüssel öffnet genau ein Objekt, 1.2). Admin-Sein
  gibt die Verwalter-Rechte aus `canManageBoat` (bearbeiten, Törns zuordnen,
  „Nur mit Link“-Seite sehen) – nicht löschen, nicht weitere Admins einladen.
- **E-Mail-Adressen erreichen nie die Öffentlichkeit oder andere Konten** –
  auch nicht Eigner, Admins oder Törn-Eigentümer, auch nicht maskiert. Einzige
  Anzeige: die Adresse, die der Einladende selbst für eine **offene** Einladung
  eingegeben hat (in seiner eigenen Liste, bis sie angenommen, abgelaufen oder
  zurückgezogen ist).
- **Namen statt Adressen:** Jedes Konto hat einen Anzeigenamen – den selbst
  gewählten aus dem Profil, sonst einen **Spaßnamen** wie „Verwegener
  Klabautermann“ (`src/domain/names.ts`, stabil aus der Konto-ID abgeleitet,
  nichts aus der Adresse). Neue Profile bekommen ihn als Vorschlag.
- Der Törn-Eigentümer und der Eigner sehen die Anzeigenamen ihrer Crew bzw.
  Admins auch bei nicht öffentlichem Profil – sie haben die Einladung
  angenommen.
- Jeder kann sich selbst entfernen (Crew: „Mich entfernen“, Admin: „Boot
  verlassen“); der Eigentümer kann jederzeit entfernen. Konto löschen entfernt
  alle Mitgliedschaften und Einladungen.

### 10.7 Oberfläche

| Stelle | Inhalt |
|---|---|
| `sx-account-dialog`, Reiter Boote | Knopf „Admins“ je Boot: Liste, entfernen, offene Einladungen zurückziehen, Feld „E-Mail oder Profilname“ (nur Eigner); als Admin „Boot verlassen“ mit Bestätigung |
| `sx-account-dialog`, oben | „Einladungen an dich“: Einladender, Ziel, Annehmen/Ablehnen |
| `sx-crew` (neu, Panel „Crew“ in der Törn-Ansicht) | Besucher: Namen mit Profil-Link, „+ n weitere“; Eigentümer: entfernen, „Einladungslink erzeugen“ (einmal anzeigen, kopieren), per E-Mail oder Profilname einladen, offene Einladungen; Crew: „Mich entfernen“ |
| `sx-invite-dialog` (neu) | Einladung zeigen, anmelden, annehmen, Ergebnis |
| `sx-profile-page` | Abschnitt „Mitgesegelt“ (öffentliche Törns, auf denen die Person Crew ist) |
| `SessionController` | alle Aufrufe; Komponenten melden nur Absichten (Events) |

### 10.8 Offene Fragen an den Betreiber

1. Sollen Crew-Mitglieder nicht öffentliche Törns sehen dürfen, auf denen sie
   eingetragen sind? (Umgesetzt: nein – Mitgliedschaft öffnet nichts.)
2. Admins auf der öffentlichen Bootsseite nennen? (Umgesetzt: nein.)
3. Eigner-Übertragung an einen Admin? (Modell erlaubt es, API fehlt.)
4. Sollen Crew-Törns in die Kennzahlen (Seemeilen) des Profils zählen?
   (Umgesetzt: nein, nur eigener Abschnitt „Mitgesegelt“.)
5. Passen die Grenzen (20/Tag, 10 Admins, 30 Crew, 50 Mails/Tag)?
6. Einladungslinks auch für Boots-Admins? (Umgesetzt: nein, Admins nur
   gebunden per Mail oder Profilname – mehr Rechte, strengere Bindung.)

Entschieden (Oktober 2026): Personen ohne öffentliches Profil bleiben öffentlich
„Segler:in“ bzw. „+ n weitere“; der Spaßname erscheint nur dort, wo ein Name
für Beteiligte nötig ist (Listen der Eigentümer, Mails, Posteingang).
