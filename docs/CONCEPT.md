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
| E6 | **Titelbilder für alle** (Oktober 2026, Konzept 13.2). | Ein Titelbild je Profil, Boot, Verein/Team auch für kostenlose Konten – höchstens 400 KB, nur im globalen Speicherzähler. Fotos an Törns bleiben Unterstützern vorbehalten (E3). |
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

*Umgesetzt (Phase C, `0010_photos.sql`):* ohne eigenen Web Worker – `createImageBitmap` dekodiert und dreht außerhalb des
Haupt-Threads, `OffscreenCanvas.convertToBlob` kodiert asynchron (`src/services/photo-process.ts`); die Qualität sinkt
stufenweise, bis 1 MB bzw. 80 KB passen. Fotos werden nacheinander verarbeitet (Speicher mobiler Browser), höchstens 30
pro Auswahl. Abgelehnt werden zusätzlich APP13 (IPTC) und JPEG-Kommentare sowie animierte WebP. Das Hochladen prüft:
gesperrt → Unterstützer → 100 pro Törn (im `INSERT … SELECT … WHERE COUNT < 100`, also auch bei parallelen Uploads) →
Speicher → Notbremse. Kein eigenes Rate-Limit: Unterstützer-Pflicht und Grenzen reichen.

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

*Umgesetzt:* Ohne passende Zeit und ohne GPS-Kalibrierung gilt die Zeitzone des Geräts am Trackdatum. Zwischen
Trackpunkten mit mehr als 30 min Abstand wird nicht interpoliert (der nähere Punkt). Manuell gesetzte Fotos ohne
Aufnahmezeit übernehmen die Zeit des Trackpunkts (sie erscheinen dann auch im Diagramm). Der Regler erscheint nur, wenn
ein Foto des Stapels keine eigene Zeitzone hat.

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

*Umgesetzt:* Clusterung `src/domain/cluster.ts` (44-px-Raster, nahe Zellen verschmolzen), Ebene in `src/map/photo-layer.ts`,
Ticks per `marks` in `sx-time-chart` (Klick öffnet das Foto), Verdrahtung in `src/controllers/photos.ts` und `app.ts`.
Die Lightbox nutzt den modalen `<dialog>` als Fokusfalle. Die Kommentaranzahl je Foto fehlt noch – Kommentare zu
einzelnen Fotos (`comments.photo_id`) sind nicht freigeschaltet; das Löschen eines Fotos löst bestehende Bezüge.
Nicht-Unterstützer sehen im Panel „Fotos“ einen gesperrten Hinweis, der das Unterstützen-Angebot (Konto) öffnet.

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

*Umgesetzt:* `worker/photos.ts`, `worker/photo-keys.ts` (Keys, Löschen in Portionen zu 1000). Ein Titelbild gibt es noch
nicht, daher immer `same-origin`. Gelöscht wird zentral in `removeShare` (Eigentümer und Admin), im Cron (`deleteExpired`)
und in `purgeUser`; Meldungen zu Fotos fallen mit (`deleteShareReports`, `purgeUserReports`, `deleteOrphanReports`).
Melden von Fotos: Art `photo`, Admins sehen ein Vorschaubild und löschen über `removePhotoById`.

## 4. Kommentare

*Umgesetzt (Phase D, Oktober 2026): `migrations/0009_comments.sql`, `worker/comments.ts`, `worker/reports.ts`,
`worker/moderation.ts`, `sx-comments`, `sx-report-dialog`, `sx-admin-reports`; Anforderungen F-110 … F-114.
Abweichungen vom ursprünglichen Vorschlag sind unten vermerkt („Umgesetzt:“).*

### 4.1 Regeln

| Punkt | Entscheidung |
|---|---|
| Woran | Törns. Ein Kommentar kann optional ein **Foto referenzieren** (`photo_id`); die Lightbox zeigt die Kommentare zu diesem Foto, der Törn alle. Ein Thread, flach, keine Antworten-Hierarchie |
| Wer | angemeldet **und mit Profil** (Anzeigename nötig; die E-Mail erscheint nie). Name verlinkt nur bei öffentlichem Profil. Konten jünger als 24 h: max. 3 Kommentare |
| Sichtbarkeit | folgt dem Törn (effektiv). `unlisted`: wer den Schlüssel hat und angemeldet ist, darf kommentieren. `private`: nur der Eigentümer sieht den Törn, Kommentieren durch andere ist zu |
| Format | reiner Text, max. **1000 Zeichen**, `cleanText` ohne Zeilenumbruch-Zusammenfassung (max. 3 Leerzeilen). Kein HTML, kein Markdown. Auto-Links nur für `https?://…`, max. 2 Links pro Kommentar (sonst 400). Darstellung über Lit-Templates (escaped), Links als `<a>` aus dem geparsten Text, nie `innerHTML` |
| Bearbeiten | nein (Phase 1); eigene Kommentare löschen jederzeit |
| Moderation durch Eigentümer | jeden Kommentar auf seinem Törn löschen; `comments_mode` am Törn: `on` (Standard), `off` (Formular weg, Bestehendes bleibt sichtbar), `hidden` (alles ausgeblendet) |
| Mail-Benachrichtigung | **opt-in** pro Konto: `aus` (Standard) / `täglich` (eine Sammelmail pro Tag, nur wenn neue Kommentare) – schont Resend Free (100/Tag). Globales Tageslimit im Cron, Rest am Folgetag. Umgesetzt: höchstens 25 Mails pro Lauf, Inhalt nur Törn + Anzahl (keine Kommentartexte, keine Namen), Einschalten zählt erst ab dann |
| Kontolöschung | Kommentare des Kontos werden gelöscht (`ON DELETE CASCADE`), ebenso alle Kommentare auf seinen Törns |
| Moderationsstatus | Umgesetzt als `hidden_at` (statt `status visible/hidden`), einheitlich für Törns, Kommentare, Profile und Boote. Ausgeblendete Kommentare sehen nur Autor:in (markiert) und Admins |
| Fotos | `photo_id` existiert (nullable, ohne Fremdschlüssel), bleibt bis Phase C ungenutzt; ein mitgeschicktes `photoId` wird mit 400 abgelehnt |

### 4.2 Spam und Limits

- Pro Konto: **10 Kommentare/h, 50/Tag, Abstand ≥ 20 s** (gezählt in D1 über
  `comments(user_id, created_at)`; die Rate-Limit-Bindings kennen nur 10/60 s).
- Pro Törn: max. 500 Kommentare.
- Doppelter Text innerhalb 24 h desselben Kontos → 409.
- Umgesetzt: Gezählt wird in `comment_log` (Konto, Zeitpunkt, SHA-256 des Textes, 24 h aufbewahrt) statt in
  `comments` – sonst ließen sich die Grenzen durch Löschen umgehen. Fehlercodes: 429 `comment_too_fast`,
  `comment_new_account`, `comment_quota`; 409 `duplicate_comment`, `comment_share_full`.
- Gleiche Limits für alle Stufen: Unterstützen kauft Speicher und Aufbewahrung,
  nicht mehr Reichweite.

### 4.3 Darstellung

`sx-comments` unter den Kennzahlen im Panel (mobil im Bottom-Sheet als eigener
Abschnitt): Liste, Formular, Zeichenzähler, „Melden“, für Eigentümer „Löschen“
und der Schalter Kommentare an/aus. Anzahl als Badge in der Lightbox.

Umgesetzt: Panel „Kommentare“ nach „Crew“; ohne Anmeldung, ohne Profil, gesperrt oder abgeschaltet erscheint statt
des Formulars der Grund (mit „Anmelden“ bzw. „Profil anlegen“). „Törn melden“ unter der Liste, „Melden“ auf Profil-
und Bootsseiten. Die tägliche Sammelmail schaltet man im Konto unter „Einstellungen“.

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
  in der App. *Umgesetzt: nur die Bestätigung im Dialog; eine Statusliste für Meldende fehlt noch, weil entschiedene
  Meldungen den Meldenden nicht mehr speichern.*

**Umgesetzt (Details):**

| Punkt | Umsetzung |
|---|---|
| Was | `share`, `comment`, `profile` (Ziel-ID = Konto-ID, gemeldet über den Profilnamen), `boat`; Fotos folgen mit Phase C |
| Nur Sichtbares | Gleiche Prüfung wie beim Ansehen inkl. Schlüssel – sonst 404. Eigene Inhalte: 400 `own_object`. Höchstens 20 Meldungen pro Konto und Tag; doppelte Meldung zählt einmal |
| Ausgeblendet | `hidden_at` an `shares`, `comments`, `profiles`, `boats`: wie nicht existent außer für Eigentümer bzw. Autor:in und Admins – API 404, keine Listen (Profil, Boot, Entdecken), neutrale Link-Vorschau, Autor/Boot/Crew ohne Namen-Link. Admins sehen Ausgeblendetes, aber nie fremde „Nur ich“-Objekte |
| Admins | `ADMIN_USER_IDS` (kommagetrennte Konto-IDs, Variable oder Secret). Leer = keine Admin-Oberfläche (Routen 404), Meldungen werden trotzdem gespeichert. Reiter „Meldungen“ im Konto: je Ziel Gründe, Anmerkungen (ohne Meldende), Vorschau, Link (bei „Nur mit Link“ mit Schlüssel), Eigentümer |
| Entscheiden | `POST /api/admin/reports/:id { action: keep \| hide \| delete }` gilt für alle offenen Meldungen zum Ziel. Danach ohne `reporter_id` und `note`; nach 180 Tagen gelöscht. Bei `delete` fallen Ziel und Meldungen weg (Profil: nur das Profil, Konto und Törns bleiben) |
| Sperren | `POST /api/admin/users/:id/suspend { suspended }` setzt `users.suspended_at`: keine Uploads (Törn, Übersichtsbild), Kommentare, Meldungen, Einladungen (anlegen und annehmen), Inhalte verschwinden aus /entdecken. Ansehen, Löschen, Abmelden, Einstellungen gehen weiter. Admins sind nicht sperrbar. Fail closed: ein nicht (mehr) vorhandenes Konto gilt als gesperrt |
| Kontakt ohne Konto | `REPORT_CONTACT` (Worker-Variable), angezeigt im Melden-Dialog (`GET /api/reports/info`) |
| Aufräumen | Törn löschen/ablaufen und Konto löschen entfernen Meldungen zu den betroffenen Inhalten; eigene Meldungen eines gelöschten Kontos bleiben anonym. Nächtlich: verwaiste Meldungen, entschiedene > 180 Tage, `comment_log` > 24 h |

## 5. Kontingente und Stufen

### 5.1 Werte

| Grenze | Kostenlos | Unterstützer | heute |
|---|---|---|---|
| Törns pro Konto | **3** | **100** (harte Grenze) | 3 / 100 |
| Speicher gesamt (Tracks + Übersichtsbilder + Fotos) | ergibt sich aus 3 Törns (≤ 3 × (12 MB + 1,5 MB Bild) = 40,5 MB) | **200 MB** (E3) | 200 MB nur Tracks |
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

**Umgesetzt (Phase B, `0008_limits.sql`):** Werte wie oben in `src/domain/limits.ts`;
Boote, Törns und Speicher inkl. Übersichtsbild (`shares.image_bytes`) werden geprüft; seit Phase C zählen Fotos
(`photos.bytes`) mit. Altbestand mit Bild wird auf 150 kB geschätzt.

Regeln wie F-60: **Bestehendes bleibt**, nur Neues wird blockiert (402
`supporter_required`, wenn die Unterstützer-Stufe reichen würde, sonst 409 `quota`). Wer nach Ende der Unterstützung über
den kostenlosen Grenzen liegt, behält alles bis zum Ablauf, kann aber nichts
hinzufügen. Speicher wird **vor** dem Einlesen geprüft (wie heute in
`createShare`), Fotos genauso.

Die Werte wandern aus `LIMITS` in `src/domain/limits.ts`:
`limitsFor(tier: 'free' | 'supporter')`, genutzt von Worker und UI (Anzeige
„12 von 20 Fotos“). `GET /api/me/support` liefert zusätzlich `bytesUsed`,
`bytesMax`, `boatsUsed`, `boatsMax` (aktuelle Stufe), `limits` (beide Stufen) und
`storagePaused`, seit Phase C auch `photosUsed` (im Konto) und `photosMax` (pro Törn, aktuelle Stufe).

### 5.2 Globale Notbremse

Zusätzlich zur Grenze pro Konto: `counters.storage_bytes` (Summe aus D1, im Cron
nachgerechnet, bei Upload/Bild/Löschen/Ablauf/Kontolöschung inkrementell im selben Batch gepflegt).

| Füllstand (Zähler) | Wirkung |
|---|---|
| < 8 GB | normal |
| 8–9,5 GB | **neue Uploads kostenloser Konten pausiert** („Speicher gerade knapp“, 503 `storage_paused`), Unterstützer weiter |
| ≥ 9,5 GB | alle neuen Uploads pausiert |

*Umgesetzt (Phase B/C):* Sie bremst neue Törns und neue Fotos. Übersichtsbilder, Löschen und Bearbeiten laufen
immer. GB hier dezimal (8·10⁹ Byte), also mit Reserve unter dem 10-GB-Free-Tier.

Fail closed: Fehlt der Wert, gilt „pausiert“ (der Cron legt die Zeile wieder an). Die Schwellen sind
Worker-Variablen (`STORAGE_SOFT_BYTES`, `STORAGE_HARD_BYTES`); nach einem bewussten Wechsel auf bezahltes R2 (siehe 5.4)
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

### 5.5 Saison statt Monate (Oktober 2026)

Entscheidung des Betreibers: Inhalte und Unterstützung gelten **je Saison = Kalenderjahr** – so lässt sich
kalenderjährlich planen, und die Bitte um Unterstützung kommt einmal im Jahr, freundlich, vor Weihnachten.

| Regel | Wert (`src/domain/support.ts`) |
|---|---|
| Saison eines Törns | Jahr des Uploads; ab **1. November** Hochgeladenes zählt zur nächsten Saison |
| Kostenlose Törns (samt Fotos) | gelöscht am **1. Februar** nach ihrer Saison (Januar = Schonfrist) |
| Unterstützung | gilt bis **31.12.** der Saison des Zahltags (ab November: der nächsten); jede weitere Zahlung hängt eine Saison an |
| Törns von Unterstützern | gelöscht am 1. Februar nach der letzten unterstützten Saison |
| Saison-Erinnerung | im **Dezember** einmal pro Konto und Jahr (`users.season_mail_year`): Dank, Hinweis auf das private Projekt, Bitte um eine kleine Unterstützung für die nächste Saison, Löschdatum; nur an Konten, deren Törns mit der Saison enden |
| Letzte Erinnerung | 14 Tage vor dem Löschen (Mitte Januar), je Törn einmal – wie bisher |
| Inaktive leere Konten | unverändert nach 12 Monaten ohne Anmeldung |

Die Regel steht zweimal: `shareExpiry`/`extendSupport` in TypeScript, `EXPIRES_SQL`/Webhook in SQL; ein Test
vergleicht beide an Monats- und Jahresgrenzen. Bestehende Törns werden nicht kürzer: was bisher nach 3 Monaten
gelöscht worden wäre, bleibt jetzt bis zum 1. Februar nach seiner Saison.

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

*Umgesetzt: Kommentare und Meldungen kamen vor den Fotos als `0009_comments.sql` (ohne `photos`, `counters`;
`comment_log` zusätzlich, `hidden_at` statt `status`, `comments_mode`/`hidden_at` an `shares` und `hidden_at` an
`boats`/`profiles` per `ALTER TABLE`, `users.suspended_at`/`notify_comments`/`comments_mailed_at`).*

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
- **F-122** Ab 8 GB Gesamtspeicher pausieren neue Uploads (Törns, ab Phase C auch Fotos) kostenloser Konten, ab 9,5 GB alle; fehlt der Zähler, gilt „pausiert“. *(umgesetzt in Phase B, siehe REQUIREMENTS F-120–F-123)*
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
  email       TEXT,                      -- geschickt an diese Adresse; NULL = Einladungslink (nur Crew)
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

`0012_invite_invitee.sql` ergänzt `invitee_id TEXT REFERENCES users(id) ON DELETE
CASCADE`: Einladungen über den Profilnamen gehen an dieses **Konto** statt
an eine Adresse; die Mail geht an die Adresse des Kontos, die nur der Server kennt.

`boat_admins` (0002) bleibt unverändert. Zwei Fremdschlüssel statt einer
generischen `target_id`, damit Löschen von Boot, Törn oder Konto die
Einladungen per `ON DELETE CASCADE` mitnimmt (D1 erzwingt Fremdschlüssel;
`purgeUser` und `deleteBoat` löschen zusätzlich explizit).

| Einladung | Bindung | Gültig | Nutzungen |
|---|---|---|---|
| Boots-Admin | per E-Mail oder Profilname; der Link darf weitergegeben werden (10.2) | 7 Tage | 1 |
| Crew per E-Mail oder Profilname | an die Adresse bzw. das Konto geschickt, weitergebbar (10.2) | 14 Tage | 1 |
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
   einlädt, ob die Einladung an eine Adresse bzw. ein Konto geschickt wurde und ob
   das angemeldete Konto der Empfänger ist) – ohne einzulösen. Die Adresse erscheint
   nur maskiert („a…@e….org“, `sentTo`) und nur für ein anderes angemeldetes Konto.
3. Nicht angemeldet → Anmeldedialog (Magic Link); nach der Anmeldung (auch aus
   einem anderen Tab) erscheint die Einladung wieder.
4. **Ausdrückliche Bestätigung** „Annehmen“ (`POST /api/invites/accept`), nie
   automatisch – gleicher Schutz wie „Als … anmelden?“.
5. Prüfungen beim Annehmen: gültig, nicht abgelaufen, Nutzungen frei;
   **keine Bindung an Adresse oder Konto** (Entscheidung 28.10.2026: „Einladungslinks
   sollen Einladungslinks sein und können weitergeleitet werden“) – jede verschickte
   Einladung (Boots-Admin, Crew, Gruppe, Freunde) nimmt an, wer den Link mit
   irgendeinem Konto öffnet, einmal; danach ist sie auch für den Empfänger verbraucht.
   Ist das Konto nicht der Empfänger, zeigt der Dialog vorher „Diese Einladung ging an
   a…@e….org – du nimmst sie mit deinem Konto b…@… an.“ (beide maskiert), angenommen
   wird per ausdrücklichem Klick. Mehrere Adressen je Konto sind nicht Teil davon
   (später). Crew braucht kein Profil
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
| POST | `/api/invites/peek` | alle | `{ token }` → Art, Ziel, Einladender, verschickt ja/nein, Empfänger ja/nein, Adresse maskiert (nur für andere Konten), Ablauf |
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
- Mit Link zum Profil nur Mitglieder mit **öffentlichem Profil**; alle anderen
  erscheinen unter ihrem Spaßnamen ohne Link – ein Klick zeigt, dass das Profil
  nicht öffentlich ist (Oktober 2026, vorher nur „+ n weitere“). Anzeige- und
  Profilname nicht öffentlicher Profile bleiben verborgen.
- **Crew-Sein öffnet nichts**: Mitgliedschaft gibt keinen Zugriff auf nicht
  öffentliche Törns (ein Schlüssel öffnet genau ein Objekt, 1.2). Admin-Sein
  gibt die Verwalter-Rechte aus `canManageBoat` (bearbeiten, Törns zuordnen,
  „Nur mit Link“-Seite sehen) – nicht löschen, nicht weitere Admins einladen.
- **E-Mail-Adressen erreichen nie die Öffentlichkeit oder andere Konten** –
  auch nicht Eigner, Admins oder Törn-Eigentümer, auch nicht maskiert. Ausnahmen:
  die Adresse, die der Einladende selbst für eine **offene** Einladung
  eingegeben hat (in seiner eigenen Liste, bis sie angenommen, abgelaufen oder
  zurückgezogen ist), und – seit 28.10.2026 – die **maskierte** Empfängeradresse
  für ein anderes Konto, das einen weitergegebenen Einladungslink öffnet (10.2).
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

*Stand 26.10.2026: Die umgesetzten Standards gelten als entschieden; Änderungen nur auf ausdrücklichen Wunsch.*

1. Sollen Crew-Mitglieder nicht öffentliche Törns sehen dürfen, auf denen sie
   eingetragen sind? (Umgesetzt: nein – Mitgliedschaft öffnet nichts.)
2. Admins auf der öffentlichen Bootsseite nennen? (Umgesetzt: nein.)
3. Eigner-Übertragung an einen Admin? (Modell erlaubt es, API fehlt.)
4. Sollen Crew-Törns in die Kennzahlen (Seemeilen) des Profils zählen?
   (Umgesetzt: nein, nur eigener Abschnitt „Mitgesegelt“.)
5. Passen die Grenzen (20/Tag, 10 Admins, 30 Crew, 50 Mails/Tag)?
6. Einladungslinks auch für Boots-Admins? (Umgesetzt: kein mehrfach nutzbarer
   Link, nur per Mail oder Profilname, einmal nutzbar; seit 28.10.2026 darf der
   Empfänger diesen Link aber weitergeben, 10.2.)

Entschieden (Oktober 2026): Personen ohne öffentliches Profil bleiben öffentlich
„Segler:in“ bzw. „+ n weitere“; der Spaßname erscheint nur dort, wo ein Name
für Beteiligte nötig ist (Listen der Eigentümer, Mails, Posteingang).

## 11. Vereine, Teams und Neuigkeiten

Stand: Oktober 2026. Ziel des Betreibers: Sail Explorer soll Segler zusammenbringen – wie ein soziales Netz, aber
mit den Regeln aus Abschnitt 1 (Sichtbarkeit), 4.4 (Moderation), 5 (Grenzen) und 10 (Einladungen) und im
Cloudflare-Free-Tier. Anforderungen: **F-150 ff.** (`REQUIREMENTS.md`). Umsetzung: `migrations/0011_groups.sql`,
`worker/groups.ts`, `worker/activity.ts`, `worker/stream.ts`, `worker/follows.ts`, `worker/posts.ts`,
`worker/feed.ts`, `src/domain/groups.ts`, `sx-group-page`, `sx-stream`.

### 11.1 Gruppen: Vereine und Teams

Ein Modell `groups` mit `kind` ∈ `club` (Verein) | `team` (Team, Regattacrew, Jugendgruppe). Ein Team kann zu einem
Verein gehören (`parent_id`); anlegen darf es nur, wer im Verein Eigner oder Admin ist. Wird der Verein gelöscht,
bleiben seine Teams als eigenständige Gruppen bestehen.

| Punkt | Entscheidung |
|---|---|
| Adresse | `/g/<slug>`, „Nur mit Link“ `/g/<slug>/<schlüssel>`. Slug wie Profilnamen (`normalizeHandle`: 3–30 Zeichen a–z, 0–9, Bindestrich, reservierte Wörter) plus `neu`, `feed`, `verein(e)`, `team(s)`; eigener Namensraum. Ändern möglich, ohne Weiterleitung (offene Frage 1) |
| Rollen | `owner` (genau einer, `groups.owner_id` und Zeile in `group_members`), `admin`, `member`. Eigner: alles inkl. Löschen, Sichtbarkeit, Admins ernennen. Admins: bearbeiten (ohne Sichtbarkeit), einladen, Anfragen annehmen, Mitglieder (keine Admins) entfernen, Beiträge schreiben und löschen, Boote entfernen. Mitglieder: Boote zuordnen, austreten |
| Beitreten | **nur auf Einladung** (Mechanismus aus Abschnitt 10: Link oder an eine Adresse geschickte Mail, `invites.kind = 'group'`, `group_id`) oder per **Beitrittsanfrage**, die ein Admin annimmt (`join_mode = 'request'`, Standard; `invite` = nur Einladungen). Anfragen gehen nur bei Gruppen, die man sehen darf |
| Sichtbarkeit | wie überall (Abschnitt 1): `public` gelistet und indexierbar; `unlisted` nur mit Schlüssel; `private` („geschlossen“) nur für Mitglieder. E1: kostenlos nur öffentlich, „Nur mit Link“ und „geschlossen“ verlangen laufenden Unterstützer-Status des **Eigners** (402), E4: bestehende Stufe bleibt nach Ende der Unterstützung |
| Mitgliedschaft öffnet nichts | Mitglieder sehen weiterhin nur öffentliche Törns anderer (Abschnitt 1.2, 10.6). Die Gruppe selbst sehen Mitglieder unabhängig von ihrer Stufe |
| Boote | Eigner und Admins eines Boots ordnen es Gruppen zu, in denen sie Mitglied sind (`group_boats`, ein Boot in mehreren Gruppen). Entfernen: Boot-Verwalter oder Gruppen-Admins. Die Gruppenseite nennt nur öffentliche, nicht ausgeblendete Boote |
| Gruppenseite | Kopf (Name, Art, Heimathafen, Beschreibung, Verein bzw. Teams), Kennzahlen (Mitglieder, Boote, sm und Törns – nur öffentliche, nicht ausgeblendete Törns der Mitglieder und der Gruppen-Boote; „Saison“ = Kalenderjahr), Mitglieder (namentlich nur mit öffentlichem Profil, sonst „+ n weitere“; Admins sehen alle Anzeigenamen), Boote, Neuigkeiten. Link-Vorschau wie `/u` und `/b` |
| Moderation | `hidden_at` an `groups` und `posts`; Meldearten `group` und `post`. Ausgeblendete Gruppen verhalten sich wie nicht existent außer für Eigner/Admins der Gruppe und die Moderation. Gesperrte Konten legen keine Gruppen an, laden nicht ein, fragen nicht an, schreiben keine Beiträge und folgen niemandem; Gruppen gesperrter Eigner verschwinden aus /entdecken, Aktivitäten gesperrter Konten aus den Neuigkeiten |

### 11.2 Folgen

`follows (user_id, target_kind, target_id)` mit `target_kind` ∈ `user` | `boat` | `group`. Folgen braucht keine
Zustimmung, geht aber nur bei **öffentlichen**, nicht ausgeblendeten Zielen (Profil, Boot, Gruppe) – sonst 404 wie
„gibt es nicht“. Wird ein Ziel später nicht öffentlich, bleibt die Zeile, die Neuigkeiten prüfen aber beim Lesen
(11.3) – Folgen öffnet nie etwas. Kostenlos für alle, höchstens **1000** pro Konto. Seiten zeigen
„n Follower“ (Profil zusätzlich „folgt n“), nie Listen von Personen.

### 11.3 Aktivitäts-Log statt Suche

Wenn etwas passiert, schreibt der Worker **eine** Zeile `activity` (`kind`, `actor_id`, `subject_kind`,
`subject_id`, `group_id` als Kontext, kleines JSON `data`, `bucket` zum Bündeln) und je Publikum eine Zeile
`activity_target (target_kind, target_id)` – **kein** Fan-out pro Mitglied oder Follower:

| Ereignis | `kind` | Ziele (`activity_target`) |
|---|---|---|
| Törn wird öffentlich (Anlegen oder Wechsel, einmal je Törn) | `voyage` | Segler (`user`), Boot, alle Gruppen des Boots und des Seglers |
| Fotos zu einem öffentlichen Törn (gebündelt „n neue Fotos“ pro Törn und Tag, `bucket = photos:<törn>:<tag>`) | `photos` | wie `voyage` |
| Neues Mitglied (Einladung oder Anfrage angenommen) | `member` | Gruppe |
| Boot einer Gruppe zugeordnet | `boat` | Gruppe, Boot |
| Beitrag in einer Gruppe | `post` | Gruppe; bei Vereinen zusätzlich alle seine Teams |
| Meilenstein: Saison-Seemeilen 100 / 500 / 1000 überschritten (einmal je Jahr und Schwelle) | `milestone` | Segler bzw. Boot bzw. Gruppe (jeweils als Ziel) |

Lesen ist **eine** indizierte Abfrage: „Aktivitäten, deren Ziel in meinen Gruppen, meinen Booten, bei Gefolgten oder
bei mir selbst liegt, neueste zuerst, 20, Cursor“ (`activity_target(target_kind, target_id, created_at)`). Die
Gruppenseite liest nur das Ziel `group`.

**Beim Lesen wird die Sichtbarkeit neu geprüft** – die Zeilen sind nur ein Index, nie die Quelle:

| Art | Erscheint nur, wenn … |
|---|---|
| `voyage`, `photos` | der Törn **jetzt** öffentlich und nicht ausgeblendet ist und das Konto nicht gesperrt; bei Fotos zusätzlich mindestens ein Foto „wie der Törn“, nicht ausgeblendet. Segler nur mit öffentlichem Profil genannt, Boot nur öffentlich (F-82) |
| `member`, `boat`, `post` | die Gruppe für den Lesenden sichtbar ist (öffentlich oder Mitglied) und nicht ausgeblendet; Beitrag nicht ausgeblendet, Autor nicht gesperrt; Boot öffentlich; Namen nur mit öffentlichem Profil (sonst „Ein neues Mitglied“) |
| `milestone` | Profil bzw. Boot öffentlich bzw. Gruppe sichtbar |

Ein Törn, der privat, ausgeblendet oder gelöscht wurde, verschwindet also sofort; private Törns stehen gar nicht erst
im Log (geschrieben wird nur bei „öffentlich“). Die Abfrage liest bis zu 3 × 20 Kandidaten, damit trotz Aussortieren
eine Seite voll wird; der Cursor zeigt auf den letzten **geprüften** Eintrag.

**Cache:** Öffentliche Streams (Gruppenseite öffentlicher Gruppen, RSS) sind für alle gleich und werden 60 s per
Cache API und `Cache-Control: public, max-age=60` gecacht; die Sichtbarkeit der **Gruppe** wird vor dem Cache geprüft
(nicht öffentlich → nie aus dem Cache). Einzelne Einträge können so höchstens 60 s nachlaufen (wie /entdecken, F-71).
Der persönliche Stream ist `private, no-store`.

**Kosten:** ein Törn mit Boot in 2 Gruppen = 1 + 4 Zeilen. Lesen: 1 Abfrage + 1 Prüf-Batch. Kein Backfill – der
Stream beginnt leer.

### 11.4 Beiträge (News)

`posts (id, author_id, group_id, body, link, hidden_at, created_at)` – `group_id` ist für die nächste Phase
(persönliche Beiträge) bereits optional. Schreiben dürfen Eigner und Admins der Gruppe: reiner Text ≤ **2000**
Zeichen, bereinigt wie Kommentare (`cleanComment`), Links klickbar (`linkify`, höchstens 5), optional ein Link
(http(s), ≤ 500 Zeichen). Höchstens **5 Beiträge pro Tag und Gruppe** (gezählt auch nach dem Löschen). Vereinsbeiträge
erscheinen auch in den Teams. Keine Kommentare im Stream. Löschen: Autor:in oder Gruppen-Admins. Beiträge lassen sich
melden (`post`).

**RSS/Atom:** `/g/<slug>/feed.xml` nur für öffentliche, nicht ausgeblendete Gruppen (sonst 404), Atom 1.0 mit den
letzten 20 sichtbaren Einträgen, alles Fremde XML-escaped, `Cache-Control: public, max-age=600`.

### 11.5 Wo es erscheint

| Stelle | Inhalt |
|---|---|
| Startseite, angemeldet | „Neuigkeiten“ aus Gruppen, Booten, Gefolgten und eigenen Aktivitäten („Mehr laden“ per Cursor), dazu „Leute, die du kennen könntest“ und die eigenen Gruppen. Ohne Gruppen: wie bisher die Community-Leiste plus „Tritt deinem Verein bei“ (öffentliche Vereine, „Verein gründen“) |
| Gruppenseite | Neuigkeiten der Gruppe, Beitrag schreiben (Admins), Mitglieder, Boote, Anfragen und Einladungen (Admins), RSS-Link |
| Profil, Boot, Gruppe | „Folgen“ / „Entfolgen“, Anzahl Follower |
| `/entdecken` | zusätzlicher Abschnitt „Vereine und Teams“ (öffentlich, nicht ausgeblendet, Eigner nicht gesperrt) |

### 11.6 Leute, die du kennen könntest

Günstige SQL-Abfrage, höchstens **6** Vorschläge, 5 min pro Konto gecacht (Cache API, Schlüssel = Konto-ID, nur
serverseitig): Mitglieder meiner Gruppen, Crew, mit der ich gesegelt bin (`share_crew` in beide Richtungen),
Eigner und Admins der Boote meiner Gruppen, Leute mit Booten im selben Heimathafen wie meine Boote. Nur öffentliche,
nicht ausgeblendete Profile nicht gesperrter Konten, ohne mich selbst und ohne bereits Gefolgte; sortiert nach
Anzahl der Gründe. Angezeigt wird ein Grund („Im selben Verein“, „Mit dir gesegelt“, „Boot in deinem Verein“,
„Heimathafen …“).

### 11.7 Wöchentliche Sammelmail

Opt-in (`users.notify_groups` = `off` | `weekly`, Konto → Einstellungen): „Was war los in deinem Verein“ – je Gruppe
die Anzahl neuer Törns, Fotos, Beiträge und Mitglieder der letzten 7 Tage (nur, was beim Lesen sichtbar wäre), mit
Link zur Gruppe; keine Beitragstexte, keine Namen. Der nächtliche Cron verschickt sie **ab Sonntag** an jedes Konto,
das in dieser Woche (seit Sonntag 0 Uhr UTC) noch keine bekam, höchstens **20** pro Lauf (Resend Free: 100/Tag, geteilt
mit Anmeldung, Einladungen, Erinnerungen und Kommentar-Digest), der Rest in den folgenden Nächten; `groups_mailed_at`
verhindert Doppelversand. Ohne Neues keine Mail. Einschalten zählt erst ab dann (erste Mail am nächsten Sonntag).

### 11.8 Grenzen (`src/domain/limits.ts`, `GROUP_LIMITS`)

| Grenze | Kostenlos | Unterstützer |
|---|---|---|
| Gruppen beitreten | unbegrenzt | unbegrenzt |
| Gruppen anlegen (als Eigner, Vereine und Teams zusammen) | **1**, nur öffentlich | **10**, auch „Nur mit Link“ und geschlossen |
| Mitglieder je Gruppe | 500 | 500 |
| Beiträge je Gruppe und Tag | 5 | 5 |
| Boote je Gruppe | 200 | 200 |
| Folgen je Konto | 1000 | 1000 |
| Beitrittsanfragen je Konto und Tag / offen je Gruppe | 20 / 100 | gleich |
| Einladungen | wie Abschnitt 10.5 (20/Tag, Mail-Budget 50/Tag); Einladungslink bis 100 Nutzungen, 14 Tage | gleich |

### 11.9 Aufräumen

| Anlass | Was |
|---|---|
| Konto löschen (`purgeUser`) | Mitgliedschaften, Anfragen, Folgen (eigene und auf das Konto), Beiträge, Aktivitäten des Kontos und seiner Törns. Eigene Gruppen gehen an den dienstältesten Admin über; ohne Admin an das dienstälteste Mitglied, nur ohne weitere Mitglieder gelöscht (13.4) |
| Törn löschen/ablaufen | Aktivitäten mit dem Törn als Gegenstand |
| Boot löschen | Gruppen-Zuordnungen, Folgen, Aktivitäten des Boots, Ziele `boat` |
| Gruppe löschen | Mitglieder, Anfragen, Boots-Zuordnungen, Beiträge, Einladungen, Folgen, Aktivitäten der Gruppe, Ziele `group`, Meldungen |
| Nächtlich | Aktivitäten älter als **12 Monate** (in Portionen), Ziele ohne Objekt, Aktivitäten ohne Ziel, Foto-Bündel ohne Fotos, Anfragen älter als 90 Tage, Folgen auf nicht mehr existierende Ziele, Beitrags-Zähler älter als 24 h |

### 11.10 Nächste Phase (nur vorbereitet, nicht gebaut)

Das Datenmodell trägt die nächsten Schritte ohne Tabellenneubau:

- **Reaktionen** („Gefällt mir“, „Mast- und Schotbruch“): `reactions (user_id, subject_kind, subject_id, kind,
  created_at)` mit `subject_kind` ∈ `activity` | `share` | `post` – dieselben Paare wie `activity.subject_*`. Zählen
  per Index, Sichtbarkeit wie das Ziel.
- **Persönliche Beiträge:** `posts.group_id = NULL`, Ziel `user` (Follower lesen über `activity_target`). Die
  Prüfung beim Lesen wird um „Autor-Profil öffentlich“ ergänzt.
- **Benachrichtigungs-Glocke:** umgesetzt in Abschnitt 17 (Oktober 2026).
- `activity.kind`, `subject_kind` und `activity_target.target_kind` sind Text ohne `CHECK` (Prinzip Architektur 7).

### 11.11 Offene Fragen an den Betreiber

1. Slug-Wechsel bei Gruppen mit Weiterleitung (wie Abschnitt 2.3)? Umgesetzt: ohne.
2. Sollen Gruppen-Admins die Anzeigenamen aller Mitglieder sehen (umgesetzt: ja, wie Eigner bei Crew) oder nur
   öffentliche Profile?
3. Offener Beitritt ohne Bestätigung für öffentliche Vereine?
4. Meilensteine auch für Törn-Anzahl (z. B. 10 Törns) oder längste Etappe?
5. Eigner-Übertragung ausdrücklich in der Oberfläche (heute nur automatisch bei Kontolöschung)?

## 12. Verein, Hafen, Team und Reaktionen

Stand: Oktober 2026. Modell des Betreibers: *„Personen haben einen Verein, Boote einen Hafen und ggf. Verein, Teams
aus Personen, und der Stream soll Verein, Heimathafen und die der Teammitglieder zusammenstellen. Reaktionen dazu
packen. Die Startseite so umstellen, dass Hochladen und Track anlegen in den Hintergrund kommen und der
Community-Stream hervorgehoben wird.“* Anforderungen: **F-170 ff.** (`REQUIREMENTS.md`). Umsetzung:
`migrations/0013_social.sql`, `worker/harbors.ts`, `worker/home.ts`, `worker/reactions.ts`, `worker/stream.ts`,
`src/domain/harbors.ts`, `src/domain/reactions.ts`, `src/content/legal.ts`, `sx-home-feed`, `sx-reactions`,
`sx-harbor-page`, `sx-legal-page`.

### 12.1 Mein Verein

Eine Person wählt **einen** Heimatverein („Mein Verein“) unter den Vereinen (`groups.kind = 'club'`), in denen sie
Mitglied ist. Gespeichert am Konto (`users.home_club_id`), nicht am Profil – so geht es auch ohne Profil, und das
Profil zeigt ihn nur, wenn es öffentlich ist **und** der Verein öffentlich und nicht ausgeblendet ist (sonst verriete
das Profil eine geschlossene Gruppe). Gesetzt über `PUT /api/me/home { clubId, harborId }` (Konto → Profil);
leer ist erlaubt. Wer austritt oder entfernt wird, verliert die Wahl (ausdrücklich beim Austritt, beim Löschen des
Vereins per `ON DELETE SET NULL`); beim Lesen zählt sie ohnehin nur bei bestehender Mitgliedschaft.

### 12.2 Häfen

Der freie Text `boats.home_port` wird zur Entität **`harbors`** (`id`, `slug`, `name`, `name_key`, optional
`lat`/`lon`, optional `club_id`, `created_by`, `hidden_at`). Seite `/h/<slug>`: Kopf (Name, Position, Verein des
Hafens), Kennzahlen, öffentliche Boote mit diesem Hafen, deren öffentliche Törns, Neuigkeiten des Hafens, Folgen.

| Punkt | Entscheidung |
|---|---|
| Auswahl am Boot | Autovervollständigung aus vorhandenen Häfen (`GET /api/harbors?q=`, höchstens 10, nur nicht ausgeblendete). Neuer Hafen erlaubt: `POST /api/harbors { name }` liefert bei gleichem **normalisiertem Namen** den vorhandenen (200), sonst einen neuen (201). Höchstens **10 neue Häfen pro Konto und Tag**; gesperrte Konten legen keine an |
| Normalisierung (`harborKey`) | A–Z und Ä/Ö/Ü klein, ä/ö/ü/ß → ae/oe/ue/ss, die Satzzeichen Punkt, Komma, Bindestrich, Unterstrich, Schrägstrich, Klammern, Anführungszeichen, Doppelpunkt, Semikolon, `&` und `+` → Leerzeichen, Leerzeichen zusammengefasst. „Hafen Potsdam-West“ = „hafen potsdam west“. Bewusst so gewählt, dass dieselbe Regel in SQL (Migration) möglich ist |
| Slug | neue Häfen: aus dem Namen wie Gruppen (`slugFromName`), bei Kollision mit Zufallsendung; migrierte: Schlüssel mit Bindestrichen, bei anderen Zeichen als a–z, 0–9 `hafen-<id>` |
| Daten | `boats.harbor_id` (Hafen des Boots); `boats.home_port` bleibt als Anzeige-Kopie des Hafennamens (alte Clients, Vorschau, /entdecken). Ein altes `homePort` als Text am Boot wird serverseitig in einen Hafen übersetzt |
| Bearbeiten | `PATCH /api/harbors/:id`: Name und Position die Anleger:in bzw. die Moderation; `clubId` setzen Eigner/Admins dieses Vereins (nur wenn frei oder schon ihrer), lösen dürfen sie und die Moderation |
| Sichtbarkeit | Häfen sind immer öffentlich (nur Name und Ort); gelistet werden darin nur öffentliche, nicht ausgeblendete Boote und öffentliche Törns. Melden wie Gruppen (`harbor`), ausgeblendet = wie nicht existent |
| Heimathafen einer Person | ausdrückliche Wahl (`users.home_harbor_id`), sonst der häufigste Hafen der eigenen Boote. Auf dem Profil nur die ausdrückliche Wahl oder ein Hafen eines **öffentlichen** eigenen Boots |
| Verein des Boots | bleibt `group_boats` (mehrere möglich); Bootsseite zeigt „Verein“ für öffentliche, nicht ausgeblendete Vereine |
| Migration | `0013_social.sql` legt je verschiedenem normalisiertem `home_port` einen Hafen an und ordnet die Boote zu – Regel identisch mit `harborKey` (ein Test vergleicht SQL und TypeScript). Es wird nichts vorbefüllt |

### 12.3 Teams

Teams bleiben Gruppen der Art `team` (aus Personen, optional in einem Verein, Abschnitt 11.1). Neu ist nur ihre
Rolle im Stream: Wer in einem Team ist, sieht die öffentlichen Aktivitäten **aller Teammitglieder** (12.4).

### 12.4 Stream-Zusammensetzung

Persönlicher Stream (`GET /api/stream`) = Aktivitäten mit einem dieser Ziele:

| Quelle | Ziele (`activity_target`) |
|---|---|
| ich | `user` = ich |
| meine Gruppen (inkl. Heimatverein) | `group` = jede Gruppe, in der ich Mitglied bin |
| Teams meines Heimatvereins | `group` = Teams mit `parent_id` = Heimatverein (Sichtbarkeit beim Lesen) |
| Heimathafen | `harbor` = Heimathafen (12.2) |
| Teammitglieder | `user` = alle Mitglieder meiner Teams (höchstens 500) |
| meine Boote | `boat` = Boote, die ich besitze oder verwalte |
| Gefolgtes | `user`/`boat`/`group`/`harbor` aus `follows` (Folgen geht jetzt auch für Häfen) |

**Neues Ziel `harbor`:** Törns und Fotos eines Boots mit Hafen bekommen zusätzlich das Ziel `harbor`; wird einem Boot
ein Hafen zugeordnet, entsteht einmal je Boot und Hafen die Aktivität `harbor` („Neues Boot im Hafen“, Ziele Hafen
und Boot; sichtbar nur bei öffentlichem Boot und nicht ausgeblendetem Hafen).

**Abfrage:** D1 lehnt zusammengesetzte SELECTs mit mehr als etwa fünf UNION-Gliedern ab. Darum zuerst die Ziele in
**einem Batch kleiner, indizierter Abfragen** sammeln (Mitgliedschaften, Boote, Folgen, Heimat, Teams des Vereins,
Teammitglieder), im Worker zu höchstens **1600** eindeutigen Schlüsseln zusammenfassen und dann **eine** Abfrage:
`json_each(?)` als Schlüsselliste, `JOIN activity_target` über den Index `(target_kind, target_id, created_at)`,
gruppiert nach Aktivität, neueste zuerst, Cursor, 60 Kandidaten. Danach wie bisher die Prüfung beim Lesen
(Abschnitt 11.3) – das Log bleibt nur ein Index. Kosten: 1 Batch + 1 Abfrage + 1 Prüf-Batch.

**Öffentlicher Community-Stream** (`GET /api/stream/public`, für alle, auch ohne Anmeldung): neueste Aktivitäten der
ganzen Plattform (`activity_created`-Index), geprüft **ohne Betrachter** (nur Öffentliches), optional gefiltert nach
Hafen (`?harbor=<slug>`, Ziel `harbor`) oder Verein (`?club=<slug>`, nur öffentliche Vereine, Ziel `group`).
Für alle gleich, darum 60 s gecacht (`public, max-age=60`). Die erste Seite liefert Filter-Chips mit: bis zu 8 Häfen
mit den meisten öffentlichen Booten und bis zu 8 öffentliche Vereine mit den meisten Mitgliedern.

### 12.5 Reaktionen

Kleine feste Auswahl mit eigenen Icons (`REACTIONS` in `src/domain/reactions.ts`): **„Gefällt mir“** (`like`),
**„Mast- und Schotbruch“** (`mast`), **„Starker Schlag“** (`tack`). Tabelle `reactions (subject_kind, subject_id,
user_id, kind, created_at)` mit Primärschlüssel `(subject_kind, subject_id, user_id)` – **eine Reaktion pro Person und
Gegenstand**; eine andere Art ersetzt sie, dieselbe noch einmal nimmt sie zurück (Oberfläche), `DELETE` entfernt.

| Punkt | Entscheidung |
|---|---|
| Gegenstände | `share` (Törn, auch im Stream bei `voyage`/`photos`), `post`, `photo`, `activity` (Mitglied, Boot, Hafen, Meilenstein) – dieselbe Reaktion erscheint also im Stream und auf der Törn-Seite |
| Wer | angemeldet, nicht gesperrt; nur auf Gegenstände, die die Person **jetzt sehen darf** (gleiche Prüfung wie beim Ansehen, inkl. Schlüssel; bei `activity` die Prüfung aus 11.3) – sonst 404 wie „gibt es nicht“ |
| Zählen | je Art per Index; der Stream liefert Zähler und die eigene Reaktion mit (1 zusätzliche Abfrage je Seite) |
| „Wer hat reagiert“ | `GET /api/reactions/:art/:id` nur für sichtbare Gegenstände; namentlich nur öffentliche, nicht ausgeblendete Profile nicht gesperrter Konten (höchstens 50), der Rest als „+ n weitere“. Keine Konto-IDs |
| Grenzen | **300 Reaktionen pro Konto und Tag** (Zähler `reaction_log`, zählt auch Zurücknehmen, 24 h aufbewahrt), sonst 429 |
| Aufräumen | Konto löschen: eigene Reaktionen und alle auf eigene Törns, Fotos, Beiträge und Aktivitäten; Törn, Foto, Beitrag löschen: Reaktionen darauf; nächtlich: Reaktionen ohne Gegenstand |
| Melden | nicht nötig (kein Freitext) |

**Benachrichtigungs-Glocke:** inzwischen umgesetzt (Abschnitt 17). Ursprüngliche Einschätzung: nicht gebaut – sie fällt nicht billig ab (eigene Tabelle `notifications` mit Fan-out an
genau eine Person, Lesestatus, Abfrage-Endpunkt, Badge im Kopf, Aufräumen). Vorbereitet ist sie wie in 11.10
beschrieben; Reaktionen wären neben neuen Followern, Kommentaren und Einladungen eine Quelle.

### 12.6 Startseite

**Die Startseite ist die Community-Seite** (Betreiber, Oktober 2026: „/entdecken zur Startseite, Beitreten und eigenen
Track hochladen als Seitenleiste als Pendant zum Stream“): Die Hauptspalte zeigt die Entdecken-Vorschau (zuletzt
gesegelte Törns, neue Boote, Segler, Vereine) und den Stream – Gäste zuerst Entdecken (das Schaufenster), Angemeldete
zuerst ihren persönlichen Stream (dazu passt das Badge am Reiter „Community“, 12.10). Die Seitenleiste daneben ist das
Gegenstück: „Eigenen Törn anlegen“ und „Mitmachen“ – für Gäste, wozu man sich anmeldet (Törns speichern und teilen,
Verein/Team, Heimathafen, Folgen und Reagieren, Freunde einladen, Anmeldung ohne Passwort; Unterstützer-Vorteile nur,
wenn Unterstützen eingerichtet ist – kostenlos ist Teilen öffentlich), für Angemeldete Wege zum Eigenen (Törns, Boote,
Profil; Heimathafen und Beitreten stehen schon in der Willkommens-Karte 14.3). `/entdecken` bleibt die vollständige
Liste. Unter 960 px eine Spalte: für Gäste die Seitenleiste zuerst, für Angemeldete danach; unter 760 px ist Hochladen
der runde Knopf. Mitlaufend (sticky) ist die Seitenleiste nur ab 900 px Fensterhöhe (F-260, F-261).

Der Community-Stream ist der Kern der Startseite – für alle:

| Wer | Hauptbereich |
|---|---|
| Gäste und Abgemeldete | „Neues aus der Community“: öffentlicher Stream (12.4) mit Filter-Chips nach Hafen und Verein; „Anmelden & mitmachen“ in der Seitenleiste |
| Angemeldete | „Neuigkeiten aus deinem Verein, Hafen und Team“ (persönlicher Stream), eigene Gruppen, Hinweis zum Wählen von Verein und Heimathafen, „Leute, die du kennen könntest“; ohne Gruppen zusätzlich „Tritt deinem Verein bei“ |
| ohne Backend | wie bisher nur die Einstiegskarte (groß) |

Hochladen tritt zurück: „Track anlegen“ als **zweitrangiger Knopf in der Kopfzeile**, eine **kompakte Karte** in der
Seitenleiste (mit Beispielen) und Ziehen & Ablegen auf der ganzen Seite (beim Ziehen erscheint eine Ablagefläche). Mobil
(< 760 px) ist Hochladen ein runder Knopf unten rechts (FAB, 56 px). Die
Kartenansicht eines geladenen Törns bleibt unverändert; den Wechsel Startseite ↔ Törn übernehmen die Reiter der Kopfzeile (12.10, F-75). Unten eine
kleine Fußzeile mit „Impressum“ und „Datenschutz“.

### 12.7 Impressum und Datenschutz

`/impressum` und `/datenschutz` sind SPA-Seiten aus **einem** Modul `src/content/legal.ts` (Texte als Daten,
gerendert durch `sx-legal-page`, alles über Lit escaped). Sie laufen nicht durch den Worker (`run_worker_first`
enthält sie nicht), bekommen die Header aus `public/_headers` und funktionieren ohne Backend. Betreiberangaben stehen
in genau einem Objekt `OPERATOR` mit deutlich markierten Platzhaltern (`[NAME]` …); solange einer übrig ist, zeigen
beide Seiten oben einen Warnhinweis. Verlinkt aus der Startseiten-Fußzeile, dem Konto-Dialog und jeder Mail. Die
Datenschutzerklärung beschreibt, was der Code tatsächlich tut (Cloudflare Workers/D1/R2/Turnstile/Rate-Limits/Logs,
Resend, Stripe, Open-Meteo, Kartenkacheln, IndexedDB, Session-Cookie, Öffentliches und Sichtbarkeit, Fristen,
Löschen, Rechte, Aufsicht Brandenburg, Meldekontakt). Die Texte sind eine Vorlage, keine Rechtsberatung (README).

### 12.8 Grenzen und Kosten

| Grenze | Wert |
|---|---|
| neue Häfen je Konto und Tag | 10 |
| Reaktionen je Konto und Tag | 300 |
| Ziele im persönlichen Stream | 1600 (Folgen 1000 + Gruppen + Teammitglieder 500 + Rest) |
| Hafen-Autovervollständigung | 10 Treffer, Suchtext 2–80 Zeichen |
| „Wer hat reagiert“ | 50 Namen |

Schreiben: ein Törn eines Boots mit Hafen = 1 Ziel mehr. Lesen persönlich: 1 Batch (kleine Abfragen) + 1
Stream-Abfrage + 1 Prüf-Batch (inkl. Reaktionen). Öffentlich: 60 s gecacht. Badge (12.10): wie eine persönliche Seite
ohne Reaktionen, höchstens alle 2 min je Tab.

### 12.9 Offene Fragen an den Betreiber

1. ~~Häfen zusammenführen (Dubletten trotz Normalisierung, z. B. „Potsdam“ und „Hafen Potsdam“) – reicht die Moderation
   (ausblenden/löschen) oder braucht es „zusammenführen“?~~ Zusammenführen kommt mit dem Admin-Bereich (18.7).
2. ~~Soll der Heimathafen einer Gruppe ebenfalls auf `harbors` umgestellt werden?~~ Ja – umgesetzt in 13.3.
3. Wer darf die Position eines Hafens pflegen, wenn die Anleger:in inaktiv ist – Vereins-Admins des Hafens?
   *Teilweise: Admins können die Anleger:in neu zuweisen (18.6).*
4. ~~Benachrichtigungs-Glocke (12.5) als nächster Schritt?~~ Ja – umgesetzt in Abschnitt 17.
5. Betreiberangaben für Impressum und Datenschutz (Name, Anschrift, E-Mail, ggf. Telefon) und ob
   Auftragsverarbeitungsverträge mit Cloudflare, Resend und Stripe abgeschlossen sind.

### 12.11 Umgebung: Stream nach Nähe (Entscheidung 28.10.2026)

Betreiber: „Gäste sollen in der Community alles sehen, angemeldet auch, aber eingrenzbar“ und „den Stream auf
Mitgliedschaften oder in der Nähe des eigenen Hafens mit Radius einstellen und zeige auch meine Umgebung aktivieren –
als Standard“. Umgesetzt (F-340 … F-343) als Weiterentwicklung von `konzept-lokalitaet.md` Phase 2, aber **ohne
Zellen-Spalten**: Häfen haben schon `lat/lon`, Vereine und Teams ihren Ort über den Heimathafen.

- **Modi:** „Umgebung“ (Standard), „Alles“ (öffentlicher Stream mit Filtern, 12.6) und „Mitgliedschaften“ (persönlicher
  Stream, nur angemeldet). Die Wahl gilt pro Gerät.
- **Umgebung lesen:** Häfen im Rechteck um den Mittelpunkt (einfacher Vergleich auf `lat/lon`, Häfen sind wenige),
  genau gefiltert per Haversine, nächste zuerst, höchstens 150; dazu öffentliche Gruppen mit diesen Heimathäfen. Ihre
  Aktivitäts-Ziele (`harbor`, `group`) gehen als Schlüsselliste in dieselbe Abfrage wie der persönliche Stream
  (`PERSONAL_SQL`), geprüft ohne Betrachter wie „Alles“. Kein neues Schreiben, keine Migration.
- **Mittelpunkt:** grober Standort dieses Geräts, sonst Heimathafen (12.2). Häfen ohne Position zählen nicht – die
  Anleger:in bzw. die Moderation trägt die Position auf der Hafenseite ein.
- **Datenschutz:** Standort nur auf Klick, im Browser auf 0,1° gerundet, nur im localStorage; die Anfrage enthält nur
  die gerundeten Werte, der Server speichert sie nicht, der Cache-Schlüssel enthält nur Mittelpunkt, Umkreis, Cursor.
- **Gelesen:** Das Community-Badge zählt den persönlichen Stream; als gelesen gilt er nur, wenn „Mitgliedschaften“
  angezeigt wird.

### 12.12 Mitglied, Folgen, Stumm, Austreten (Entscheidung 28.10.2026)

Betreiber: Mitglieder brauchen kein „Folgen“ – stattdessen eine Glocke zum Stummschalten und „Verlassen“. Umgesetzt
(F-346 … F-348): **Mitglied** = Teil der Gruppe (Mitgliederliste, geschlossene Inhalte, Boote zuordnen, Beiträge je
Rolle), bekommt die Neuigkeiten im Stream; **stumm** (`group_members.muted_at`) nimmt die Gruppe aus Stream und
Wochenmail, die Mitgliedschaft bleibt – beim Heimatverein samt seiner Teams, bei einem Team samt den Törns der
Teamkollegen. **Folgen** ist nur für Nicht-Mitglieder (Neuigkeiten öffentlicher Gruppen ohne
Mitgliedschaft). **Austreten** auf der Gruppenseite und im Konto unter „Gruppen“; der Eigner übergibt vorher an einen
Admin. Die Spalte verschwindet mit der Mitgliedschaft (Austreten, Entfernen, Gruppe oder Konto löschen).

### 12.10 Kopfzeile: Bereiche und Community-Badge

Anlass (Betreiber, Oktober 2026): Der Wechsel Törn ↔ Community über das Logo war zu implizit, „Entdecken“ kaum zu
finden. Die Kopfzeile zeigt deshalb drei **Reiter**: „Törn“ (nur mit geladenen Tracks), „Community“ (Startseite mit
Stream) und „Entdecken“; der aktive ist markiert. Das Logo führt weiter zur Startseite, ist aber nicht mehr der einzige
Weg. Mobil ist in einer Zeile kein Platz: Die Reiter bilden dort eine eigene, volle Zeile unter der Kopfzeile (Icon +
Kurztext, aktiver Reiter unterstrichen) – eine Leiste unten hätte mit dem runden Hochladen-Knopf, der Seitenleiste als
Bodenblatt und Hinweisen kollidiert. Speicherstatus, „Teilen“ und Konto bleiben, wo sie sind (F-76).

Von Seiten (Profil, Gruppe, Entdecken) führt „Community“ nach `/?community`: Die Seite lädt neu, stellt gespeicherte
Tracks wieder her, zeigt aber die Startseite statt der Törn-Ansicht.

**Badge „neu“.** Angemeldete sehen an „Community“, wie viele Einträge ihres persönlichen Streams (12.4) seit dem
letzten Lesen dazugekommen sind:

| Frage | Entscheidung |
|---|---|
| Was ist „gelesen“? | Ein Zeitpunkt je Konto, `users.stream_seen_at` (ms) – serverseitig, damit es auf allen Geräten stimmt. Keine Markierung je Eintrag. |
| Wann wird er gesetzt? | Wenn die Community wirklich angezeigt wird und der persönliche Stream geladen ist: auf den Ladezeitpunkt dieser Stream-Antwort (`at`), nicht „jetzt“ – was danach dazukommt, bleibt ungelesen (auch Einträge, die erst auf einer weiteren Seite stünden, gelten damit als gelesen). Im Hintergrund-Tab erst, wenn er sichtbar wird. Klick auf den aktiven Reiter mit Badge lädt den Stream neu. Nur vorwärts (`MAX` in SQL), nie in der Zukunft. Mit Ungelesenem lädt „Community“ den Stream vorher neu. |
| Was zählt? | Kandidaten aus `activity_target` für dieselbe Zielliste wie der Stream mit `created_at` > Gelesen-Zeitpunkt (höchstens 150), dann dieselbe Prüfung beim Lesen (`shapeItem`). Eigene Aktivitäten zählen nicht. Anzeige höchstens „99+“. |
| Erstes Mal? | `NULL` → beim ersten Zählen auf „jetzt“; kein Rückstau-Badge nach dem Deploy. |
| Gäste | kein Badge, keine Abfrage. |
| Migration | `0024_stream_seen.sql` (0019–0022 belegen andere Branches). |
| Kosten | eine Zählung = Ziel-Batch + eine Index-Abfrage + ein Prüf-Batch (wie eine Stream-Seite ohne Reaktionen). Gezählt beim Start/Anmelden, beim Zurückkehren in den Tab (≥ 2 min Abstand) und alle 10 min bei sichtbarem Tab – kein Polling im Hintergrund-Tab. |
| Löschen | Der Wert liegt in der Konto-Zeile und verschwindet mit ihr (Konto löschen, inaktive Konten); er sagt nur, wann der Stream zuletzt angesehen wurde, und wird sonst nirgends gespeichert oder protokolliert. |

## 13. Fotos an Person, Boot und Gruppe, Titelbilder, Häfen für Gruppen

Anlass (Betreiber, Oktober 2026): Fotos waren in der App kaum zu finden – sie hängen nur am Törn, und ohne
eingerichtetes Stripe konnte niemand Unterstützer werden. Gewünscht: Fotos beim Törn hinzufügen, die dann auch bei
Boot, Team, Person usw. erscheinen; Titelbilder für Personen, Boote und Vereine; Häfen nur mit Stream; Häfen per
Autovervollständigung, damit „Potsdam“ und „potsdam“ ein Hafen bleiben.

### 13.1 Fotos hängen am Törn – Galerien zeigen sie überall

Ein Foto gehört genau einem Törn (Sichtbarkeit, Platzierung, Löschen bleiben wie in Abschnitt 3). Person, Boot und
Verein/Team zeigen **keine Kopien**, sondern eine Abfrage: die 12 neuesten Fotos ihrer Törns
(`worker/gallery.ts`, Feld `photos` der Seiten-Antworten).

| Seite | Törns |
|---|---|
| Person | eigene und solche, auf denen die Person Crew ist |
| Boot | Törns mit diesem Boot |
| Verein/Team | Törns der zugeordneten Boote und der Mitglieder |

Nur **effektiv öffentliche** Fotos: Foto „wie der Törn“, Törn öffentlich, beides nicht ausgeblendet, Konto nicht
gesperrt. Ein Klick öffnet den Törn mit dem Foto in der Lightbox (`/s/<id>?foto=<photoId>`). Die Galerie macht nichts
sichtbarer, als es am Törn schon ist; „Nur mit Link“-Törns erscheinen nie. Neue Fotos laufen wie bisher als
Neuigkeit in die Streams (11.3).

Damit der Betreiber Fotos ohne Stripe nutzen kann, lässt sich ein Konto direkt freischalten: eine Zeile in
`supports` mit `provider = 'grant'` (README). Aufbewahrung und Kontingente behandeln sie wie eine Zahlung.

### 13.2 Titelbilder (E6)

| | |
|---|---|
| Wofür | Profil (`u`, öffentliche ID = Profiladresse), Boot (`b`), Verein/Team (`g`). Häfen bekommen keins – ihre Seite lebt vom Stream. |
| Wer | Profil: die Person; Boot: Eigner und Boots-Admins; Gruppe: Eigner und Admins. Alle Konten (E6), gesperrte nicht. |
| Format | Im Browser auf ein Seitenverhältnis zwischen 3:1 und 3:2 gebracht (`coverCrop`: breitere Bilder mittig links/rechts, höhere mittig oben/unten beschnitten), höchstens 1500 × 1000 px, WebP (sonst JPEG), höchstens 400 KB, neu kodiert ohne Metadaten (`processCover`). Der Worker prüft wie bei Fotos nur Kopfdaten (`inspectImage`). |
| Ausschnitt | Das Banner bleibt 3:1; den sichtbaren Streifen wählt `covers.focus_y` (0 = oben … 100 = unten, Standard 50; reine Regeln in `src/domain/cover.ts`), angezeigt per `object-fit: cover; object-position: 50% <focus_y>%`. Justieren ändert nur diese Zahl (`PATCH`), kein neuer Upload, keine neue Adresse. Waagerecht wird nicht verschoben – das Banner ist breiter als jedes gespeicherte Bild. |
| Speicher | Tabelle `covers` (eine Zeile je Objekt, `ver` wechselt bei jedem Austausch), R2 `covers/<art>/<id>/<ver>.<format>`. Zählt im globalen Zähler (Notbremse), nicht im Kontingent des Kontos. |
| Sichtbar | wie das Objekt: öffentlich für alle (1 Tag cachebar, die Version steckt in der Adresse), „Nur mit Link“ mit Schlüssel – die Seite liefert die Adresse schon mit `?k=` –, privat nur Verwalter. |
| API | `PUT/PATCH/DELETE /api/covers/:art/:id` (PATCH `{ focusY }`), `GET /api/covers/:art/:id/:ver`; Seiten-Antworten tragen `cover` (Adresse oder null) und `coverY`. |
| Löschen | Objekt gelöscht (auch per Kaskade beim Konto-Löschen) → der nächtliche Cron entfernt Datei, Zeile und Zähleranteil (`sweepOrphanCovers`). |

Oberfläche: Banner über dem Kopf der Seite (`sx-cover`); Verwalter sehen ohne Bild einen schmalen Platzhalter
„Titelbild hinzufügen“, mit Bild „Ausschnitt“ (nur wenn das Bild höher als 3:1 ist), „Ändern“ und „Entfernen“. Im
Ausschnitt-Modus zieht man das Bild mit Maus oder Finger hoch/runter (Pointer-Events, `touch-action: none`) oder nutzt
den Schieberegler darunter (Tastatur, Screenreader); „Speichern“/„Abbrechen“, Escape bricht ab. Nach einem Upload
öffnet sich der Modus von selbst, sobald das neue Bild geladen ist.

**Titelbilder in Listen** (Neuigkeiten, Entdecken): Ein Eintrag zeigt das Titelbild dessen, um den es geht, als
3:1-Streifen mit demselben Ausschnitt – „Neues Boot“ und „Neues Boot im Hafen“ das des Boots, „ist beigetreten“ das
der Person, Meilensteine das von Person, Boot oder Gruppe. Törns behalten ihr Übersichtsbild (jetzt unbeschnitten,
1200 : 630), Beiträge zeigen keins (sonst stünde dasselbe Gruppenbild über jedem Beitrag). Auf /entdecken tragen
die Karten von Booten, Seglern sowie Vereinen und Teams ihr Titelbild oben – ebenfalls als breiter 3:1-Streifen mit
Ausschnitt, nicht hochkant (Betreiber, 28.10.: die Bilder sind breit angelegt und in der Höhe justiert, F-330). Dazu
hat /entdecken eine serverseitige Suche, einen Abschnitt Häfen und Beitreten-Knöpfe je Beitrittsstufe (F-331 … F-333;
für Häfen kein Folgen-Knopf in der Liste – der eigene Folgen-Stand ist dort nicht bekannt, Folgen bleibt auf der
Hafenseite). Nur Titelbilder **öffentlicher**
Objekte erscheinen (die Adresse kommt ohne Schlüssel aus; ein Mitglied einer geschlossenen Gruppe sieht den Eintrag,
aber ohne Bild). Gelesen wird beim Ausliefern per JOIN auf `covers` (`coverRef` in `src/domain/cover.ts`) – nichts
wird in die Aktivität kopiert: Ein gelöschtes Titelbild verschwindet sofort überall, ein ausgetauschtes erscheint mit
neuer Adresse (die alte liefert 404, ihre Datei ist gelöscht).

Wo es keinen Ausschnitt gibt (Oktober 2026 geprüft):

- **Galerie-Kacheln** (`sx-gallery`, quadratisch) und **Foto-Vorschaubilder im Törn** (`sx-photo-strip`), **Stream-Fotos**
  (`sx-stream`, 72-px-Kacheln): Das sind Törn-Fotos mit eigenem Eigentümer, die automatisch an Person, Boot und Gruppe
  erscheinen. Ein Fokus je Foto wäre eine weitere Einstellung pro Foto für winzige Kacheln; ein Klick zeigt ohnehin das
  ganze Bild (Lightbox). Mittig beschnitten bleibt.
- **Törn-Übersichtsbild** (`sx-stream` `.cover`, Entdecken-Kacheln): das generierte Track-Vorschaubild mit Karte und
  Kennzahlen, kein hochgeladenes Foto – im Stream wird es seit F-213 ganz gezeigt statt auf 180 px Höhe beschnitten.
- **Link-Vorschau (og:image)** für Profil, Boot und Gruppe: gibt es heute nicht (nur Törns haben ein Vorschaubild).
  Würde man das Titelbild nehmen, schnitte jede Plattform es selbst auf ca. 1,91:1 zu – `focus_y` ließe sich nicht
  mitgeben, und der Worker dekodiert keine Bilder. Das wäre eine eigene Funktion (Browser rendert beim Speichern des
  Ausschnitts eine 1200 × 630-Fassung mit).

### 13.3 Heimathafen für Vereine und Teams

`groups.harbor_id` wie bei Booten (`home_port` bleibt Anzeige-Kopie). Das Formular nutzt dieselbe
Autovervollständigung (`sx-harbor-picker`); ein getippter Name findet über den normalisierten Schlüssel (`harborKey`)
den vorhandenen Hafen – „POTSDAM“, „potsdam“ und „Potsdam“ sind einer – oder legt ihn an. Migration 0014 übernimmt
vorhandene Freitexte mit derselben Regel. Die Hafenseite listet öffentliche Vereine und Teams mit diesem Heimathafen;
Umbenennen eines Hafens führt die Kopie bei Gruppen nach, Löschen löst die Zuordnung.

### 13.4 Bilder: Verkleinerung, Fristen, Aufräumen – Vereine und Häfen bleiben

Alle Bilder werden **im Browser verkleinert und neu kodiert** (WebP, sonst JPEG), dadurch frei von EXIF/GPS/XMP; der
Worker lehnt Bilder mit Metadaten oder Übergröße ab.

| Bild | Größe | Lebt so lange wie | Aufräumen |
|---|---|---|---|
| Foto am Törn | lange Kante 2048 px, ≤ 1 MB; Vorschau 400 px, ≤ 80 KB | der Törn (gelöscht am 1. Februar nach seiner bzw. der letzten unterstützten Saison, 5.5) | mit dem Törn (Ablauf, Löschen, Konto löschen, inaktive Konten) im selben Lauf |
| Übersichtsbild des Törns | ≤ 1,5 MB JPEG | der Törn | wie oben |
| Titelbild Profil | bis 1500 × 1000 px, ≤ 400 KB | das Profil (Konto löschen; leere Konten nach 12 Monaten ohne Anmeldung) | nächtlich `sweepOrphanCovers` |
| Titelbild Boot | wie oben | das Boot (Boot oder Konto des Eigners löschen) | nächtlich |
| Titelbild Verein/Team | wie oben | die Gruppe | nächtlich |

**Vereine und Teams bleiben, solange sie Mitglieder haben:** Löscht der Eigner sein Konto (oder wird es als inaktiv
entfernt), geht die Gruppe an den dienstältesten Admin, ohne Admin an das dienstälteste Mitglied – samt Titelbild,
Beiträgen anderer, Booten und Neuigkeiten. Nur eine Gruppe ohne weitere Mitglieder wird gelöscht. **Häfen bleiben
immer** (auch ohne Boote, Anleger:in oder Verein); löschen kann sie nur die Moderation. Leere Häfen tauchen in der
Autovervollständigung weiter auf (sonst entstünden Dubletten), rutschen dort aber nach hinten (Sortierung nach Booten).

### 13.5 Eigner frei wählbar

Das Konto, das ein Boot angelegt hat, bleibt technisch der Eigner (Kontingent, Löschen, E1). Angezeigt wird
„Eigner“ aber frei: Eigner **und Boots-Admins** können einen Text setzen (`boats.owner_label`, bis 80 Zeichen,
öffentlich), z. B. „Familie Schmidt“, „Charter Müller“ oder „SC Möwe e. V.“. Leer zeigt wieder das Profil des
Kontos (nur wenn öffentlich).

## 14. Beitreten und Einladen

### 14.1 Drei Beitrittsstufen, wer bestätigt

| Stufe (`join_mode`) | Wer kommt rein | Einladung eines einfachen Mitglieds |
|---|---|---|
| Offen (`open`) | jede:r angemeldete Person sofort (nur öffentliche Gruppen) | nimmt direkt auf |
| Auf Anfrage (`request`, Standard) | Anfrage, bestätigt von den Bestätigenden | wird beim Annehmen zur Anfrage („Eingeladen von …“) |
| Nur auf Einladung (`invite`) | nur mit Einladung | wird beim Annehmen zur Anfrage |

**Beitrittsstufe und wer bestätigt** (`approve_by`, Migration 0015) legt **der Eigner** fest (Admins könnten sonst „Nur der Eigner“ per „Offen“ umgehen). „Offen“ wirkt nur bei öffentlichen, nicht ausgeblendeten Gruppen (`effectiveJoinMode`), sonst wie „Auf Anfrage“. Anfragen aus angenommenen Einladungen unterliegen denselben Grenzen wie direkt gestellte. Wer bestätigt: alle Mitglieder, Eigner und Admins
(Standard) oder nur der Eigner. Wer bestätigen darf, sieht die Anfragen und nimmt mit eigenen Einladungen direkt auf.
**Einladen dürfen alle Mitglieder** (Link, E-Mail, Profilname). Die Sichtbarkeit der Gruppe (Öffentlich, Nur mit
Link, Geschlossen; E1) bleibt davon getrennt. Wer eine Gruppe gründet, ist ihr Eigner.

### 14.2 Freunde einladen

Einladung ohne Boot, Törn oder Gruppe (`kind = 'friend'`, `POST /api/invites`): per E-Mail, Profilname oder als
Link (bis 20 Personen, 14 Tage). Wer annimmt, folgt der einladenden Person und umgekehrt – so landen die beiden
sofort in den Neuigkeiten des anderen. Grenzen wie bei allen Einladungen (20 pro Konto und Tag, Mail-Budget); das gegenseitige Folgen beachtet die Folge-Grenze (wer am Limit ist, folgt nicht zusätzlich). Zurückziehen kann die einladende Person per API; eine eigene Liste gibt es (noch) nicht – Links werden nur einmal angezeigt.

### 14.3 Willkommens-Karte nach der Anmeldung

Auf der Startseite sehen Angemeldete ohne Gruppe oder ohne Heimathafen „Willkommen an Bord!“ mit drei Schritten:
Heimathafen wählen (Autovervollständigung), Verein oder Team beitreten (öffentliche Gruppen mit „Beitreten“,
„Anfragen“ bzw. „Ansehen“ je nach Stufe, dazu „gründen“) und Freunde einladen (E-Mail oder Link). Erledigte
Schritte verschwinden; „Später“ blendet die Karte auf dem Gerät aus.

### 14.5 App auf dem Home-Bildschirm

Web-App-Manifest (`id` und `start_url` „/“, eigenständige Anzeige, Icons 192/512 je „any“ und „maskable“) und
iOS-Icon; auf Touch-Geräten außerhalb der installierten App und außerhalb von Einbettungen erscheint nach einigen
Sekunden `sx-install-hint` – Android/Chrome mit „Installieren“, iOS-Safari mit der Anleitung über „Teilen“. Er liegt
über Karte und Startseite, oberhalb des runden „Track anlegen“-Knopfs; „Nicht jetzt“ gilt dauerhaft pro Gerät.

**Bekannte Grenze iOS:** Apps auf dem Home-Bildschirm haben unter iOS eigene Cookies und eigenen Speicher. Der
Anmeldelink aus der Mail öffnet Safari – die Anmeldung landet dort, nicht in der App. Abhilfe wäre eine Anmeldung per
Code zum Eintippen (offene Frage an den Betreiber). Android ist nicht betroffen.

### 14.6 Anmeldung per Code

Jede Anmeldemail enthält neben dem Link einen **6-stelligen Code** (nicht im Betreff – sonst stünde er auf dem
Sperrbildschirm). Den tippt man im Anmeldedialog ein – für die Home-Bildschirm-App auf dem iPhone (14.5) oder wenn die Mail auf
einem anderen Gerät ankommt. Link und Code gehören zusammen: gleiche Gültigkeit (15 min), einmalig, das eine
verbraucht das andere. Gespeichert wird nur `sha256(token_hash:code)` (Migration 0016). Schutz gegen Durchprobieren:
höchstens 10 Code-Versuche pro Adresse und 24 h, **vor** dem Vergleich atomar reserviert (parallele Anfragen überholen
die Grenze nicht); bei Erreichen werden die offenen Codes der Adresse verworfen (`code_locked`, nur noch der Link).
Abgelaufene Anmeldelinks löscht der Cron erst 24 h nach Ablauf, damit ihre Fehlversuche so lange zählen. Dazu das
IP-Limit der Anmeldung; gleiche Antwort für unbekannte Adresse und falschen Code.

Bekannte Grenzen: Jemand kann mit absichtlich falschen Codes die Code-Anmeldung einer fremden Adresse für 24 h sperren
(der Link funktioniert weiter – in der iPhone-App aber nur über Safari). Bei einem Datenbank-Leck wären die Codes
offener Links (15 min) schnell zu erraten; ein HMAC mit Worker-Secret wäre die Verbesserung, falls nötig.

**Passwörter, Passkeys, 2FA (Oktober 2026):** Passwörter bewusst nicht – Hashing kostet im Free-Tier zu viel CPU,
„Passwort vergessen“ bräuchte wieder Mails, und Wiederverwendung/Phishing sind das größere Risiko. Als nächster
Schritt sind **Passkeys** vorgesehen (Anmeldung per Fingerabdruck/Face ID ohne Mail; die Mail bleibt für das erste
Gerät und als Rückfallweg). Eine zusätzliche 2FA ist mit Passkeys nicht nötig.

### 14.7 Passkeys

Anmelden per Fingerabdruck, Face ID oder Geräte-PIN, ohne Mail und ohne Passwort (WebAuthn, discoverable
credentials). Angelegt wird ein Passkey angemeldet im Konto („Einstellungen“ → „Passkey für dieses Gerät anlegen“);
der Anmeldedialog bietet „Mit Passkey anmelden“, wenn der Browser es kann – die Mail bleibt für das erste Gerät und als
Rückfallweg. Wer sich per Link oder Code angemeldet hat, bekommt im selben Dialog gleich das Angebot „Passkey für
dieses Gerät anlegen“ (Später / Nicht mehr fragen – gemerkt im Browser); erst danach geht es mit dem Vorhaben weiter. Die WebAuthn-Prüfung (CBOR, COSE, Signaturen) übernimmt die Bibliothek `@simplewebauthn/server`
(Wiederverwendung statt Eigenbau); gespeichert werden Credential-ID, öffentlicher Schlüssel, Zähler, Transportwege und
ein Gerätename (Migration 0017), nie Biometrie oder private Schlüssel. Challenges sind einmalig und 5 Minuten gültig (atomar eingelöst), die
Registrierungs-Challenge gehört zum angemeldeten Konto. Nutzerprüfung (Fingerabdruck, Face ID, PIN) ist Pflicht.
Relying Party ist die Hauptdomain (`CANONICAL_HOST`), die Herkunft wird exakt verglichen; der Worker hat keine
workers.dev-Adresse. Jeder neue Passkey löst eine Hinweis-Mail aus – so fällt auf, wenn jemand mit einer fremden
Sitzung einen dauerhaften Zugang hinterlegt. Höchstens 10 Passkeys pro Konto (atomar geprüft); Konto löschen entfernt
sie ausdrücklich, abgelaufene Challenges räumt der Cron weg. Anmelden unterliegt dem IP-Limit der Anmeldung und geht
auch für gesperrte Konten (wie Link und Code), Anlegen nicht. Bibliothek und Optionen werden beim Öffnen des Dialogs
vorgeladen, weil Safari den WebAuthn-Aufruf direkt aus dem Klick verlangt; in Einbettungen gibt es keinen Passkey-Knopf.

### 14.8 Löschkonzept – Prüfung Oktober 2026

Ein eigener Prüflauf (Prüfpunkt 6 in `CLAUDE.md`) hat alle gespeicherten Daten gegen ihre Löschwege abgeglichen.
Daraus: Titelbilder verschwinden sofort mit Profil (auch per Moderation), Boot, Gruppe und Konto (`removeCoverOf`),
der nächtliche Sweep bleibt als Netz; paralleles Ersetzen hinterlässt keine verwaiste Datei, der Zähler zieht nur ab,
was die Zeile belegt. Boote und Kommentare haben je einen Löschpfad (`removeBoat`, `removeComment`), den auch die
Moderation nutzt; R2-Schlüssel für Törns stehen nur in `photo-keys.ts`. Scheitert D1 nach einem Upload (Törn, Foto,
Übersichtsbild), wird die Datei wieder entfernt. Der nächtliche Lauf führt jeden Schritt einzeln aus (ein Fehler hält
die übrigen nicht auf); die Neuberechnung des Speicherzählers läuft immer. Fristen: offene Meldungen nach 180 Tagen ohne
Meldende und Anmerkung (sie zählen dann nicht mehr fürs automatische Ausblenden, dieselbe Person kann neu melden), Zahlungen 10 Jahre nach Ablauf der Unterstützung. Austritt bzw. Entfernen eines Boots aus einer
Gruppe nimmt die zugehörige Neuigkeit mit. `covers.user_id` wird beim Konto-Löschen geleert.

### 14.9 Törn-Ansicht: Speichern, Hervorheben, Herkunft (Oktober 2026)

Speichern und Teilen sind getrennt (F-225): erst im Konto speichern, danach teilen – derselbe Dialog, im Speichern-Modus
ohne Reiter. Bei mehreren Tracks hebt Hovern den betroffenen Track hervor, egal ob über Verlauf, Karte oder Trackliste
(F-224, F-226); jeder Track lässt sich als Original-GPX herunterladen (F-227). Der geteilte Törn nennt Eigentümer und
Gruppen nur, soweit der Betrachter sie ohnehin sehen dürfte (F-228) – Grundlage ist das Publikum der Törn-Aktivität,
also nur öffentliche Törns; die Prüfung passiert beim Lesen.

## 18. Admin-Bereich

Plattform-Admins (`ADMIN_USER_IDS`, `isAdmin`) bekommen eine eigene Seite `/admin` mit Übersicht über alle Konten,
Boote, Gruppen, Häfen und Törns – auch nicht öffentliche – und Werkzeugen für Sperren, Umbenennen, Eigner-Wechsel,
Zusammenführen und endgültiges Löschen. Jede Admin-Aktion und jeder Einblick steht im Admin-Protokoll.
Anforderungen F-230 … F-243, F-294 … F-296.

### 18.1 Zugang

| Punkt | Entscheidung |
|---|---|
| Wer | nur Konten in `ADMIN_USER_IDS`; leer = niemand (fail closed) |
| Kopfzeile | `GET /api/auth/me` liefert `admin: true` nur für Admins; nur dann zeigt `sx-topbar` den Eintrag „Admin“ (Link auf `/admin`) |
| Server | jede Route unter `/api/admin/` prüft `requireAdmin` und antwortet Nicht-Admins **und Gästen** mit 404 (die Route verrät sich nicht). Die Seite `/admin` liefert Nicht-Admins 404 |
| Code | Die Admin-Oberfläche wird erst bei `/admin` nachgeladen (eigener Chunk) – andere laden keinen Admin-Code |

### 18.2 Drei Stufen: ausgeblendet, suspendiert, gesperrt

Bisher gab es zwei Werkzeuge; „gesperrt“ kommt als stärkste Stufe dazu und **baut auf beiden auf**, statt sie zu
ersetzen:

| Stufe | Gespeichert | Wer sieht es noch | Wirkung | Fristen |
|---|---|---|---|---|
| **ausgeblendet** (Meldung, Moderation) | `hidden_at` am Objekt | Verwalter (Eigner, Boots-/Gruppen-Admins, Autor:in) und Admins | wie nicht existent für alle anderen, keine Listen | normale Löschfristen |
| **suspendiert** (Konto) | `users.suspended_at` | – | kein Hochladen, Kommentieren, Melden, Einladen; Inhalte aus Listen und Stream | normale Löschfristen |
| **gesperrt** (Admin) | Zeile in `locks` + `locked_at` an `users`, `shares`, `boats`, `groups` | **nur Admins** | Aufruf für alle verboten (404), auch für Eigner und Verwalter; nichts lässt sich ändern oder löschen; Konto: keine Anmeldung, alle Sitzungen beendet | **eigene Frist** statt der normalen (18.4) |

Umsetzung der Sperre: Sie setzt zusätzlich `hidden_at` (alle bestehenden Listen- und Leseprüfungen greifen damit
ohne Änderung), bei Konten zusätzlich `suspended_at` (alle Konto-Wirkungen der Suspendierung). Die vorherigen Werte
merkt sich `locks.prev_at`; Entsperren stellt sie genau wieder her (ein vorher ausgeblendetes Objekt bleibt
ausgeblendet). Die Verwalter-Ausnahme heben drei Stellen auf: `canView` (Törns: `locked_at` → nur Admins),
`roleFor` (Boote: ein gesperrtes Boot hat keine Verwalter) und `roleIn` (Gruppen: in einer gesperrten Gruppe hat
niemand eine Rolle). Häfen und Profile haben keine Verwalter-Sicht auf Ausgeblendetes – dort genügt `hidden_at`. Einladungen in gesperrte Boote, Törns und Gruppen und Einladungen gesperrter Konten gelten als ungültig. Was am
gesperrten Objekt hängt, ist mit eingefroren: Fotos, Kommentare und Crew eines gesperrten Törns, Beiträge einer gesperrten
Gruppe lassen sich nicht mehr ändern oder löschen (außer durch Admins). Ein einzeln gesperrter Törn oder ein Boot eines
gesperrten Kontos lässt sich nicht einzeln entsperren (409 `owner_locked`) – sonst wäre es als einziges sichtbar.

Solange ein Objekt gesperrt ist, lehnen Meldungs-Entscheidungen und Suspendieren/Entsperren eines gesperrten Kontos
mit 409 `locked` ab – sonst würde der gesicherte Zustand unbemerkt aufgehoben.

**Konto sperren** sperrt mit: das Profil (ausgeblendet), alle eigenen Törns und eigenen Boote (Zeilen in `locks`
mit `via_user`); Kommentare des Kontos verschwinden beim Lesen. Anmeldung per Link, Code und Passkey endet mit 403
`account_locked`, bestehende Sitzungen werden gelöscht. **Gruppen** des Kontos werden nicht mitgesperrt – sie gehören
der Gemeinschaft (andere Mitglieder) und lassen sich einzeln sperren. Entsperren des Kontos entsperrt nur, was über
das Konto mitgesperrt wurde; einzeln gesperrte Objekte bleiben gesperrt. Admin-Konten lassen sich nicht sperren.

### 18.3 Beweissicherung statt Löschfristen

Gesperrte Objekte bleiben vollständig gespeichert (D1-Zeilen, Track-Dateien, Fotos, Titelbilder) und sind von allen
normalen Löschwegen ausgenommen:

| Löschweg | gesperrt |
|---|---|
| Saison-Ablauf von Törns (5.5) und Ablauf-Erinnerung | übersprungen (`locked_at IS NULL`) |
| inaktive leere Konten (12 Monate) | übersprungen (Konto gesperrt oder besitzt Gesperrtes) |
| Konto selbst löschen | 409 `locked_content`, solange das Konto gesperrte Törns, Boote oder Gruppen besitzt (Art. 17 Abs. 3 lit. e DSGVO: Verteidigung von Rechtsansprüchen) – ein gesperrtes Konto kann sich ohnehin nicht anmelden |
| Eigner löscht Törn, Boot, Gruppe, Fotos, Kommentare, Crew, Beiträge | unmöglich (für ihn 404) |
| offene Meldungen nach 180 Tagen anonymisieren | übersprungen, solange das Ziel gesperrt ist (Anmerkungen bleiben als Beleg) |

Gesichert wird das gesperrte Objekt samt dem, was daran hängt. Beiträge **Dritter** (z. B. der Kommentar einer anderen
Person auf einem gesperrten Törn) folgen weiter dem Konto ihrer Autor:innen: Löscht diese Person ihr Konto, geht ihr
Beitrag mit – ihr Recht auf Löschung wiegt hier schwerer; wer ihn als Beleg braucht, sperrt das Konto der Person.

### 18.4 Löschkonzept der Sperre: wie lange, wer löscht

- **Frist:** Eine Sperre gilt **180 Tage** (`locks.until`). Ein Admin kann sie mit Begründung um jeweils 180 Tage ab
  heute verlängern (z. B. auf Anfrage einer Behörde), beliebig oft; jede Verlängerung steht im Protokoll.
- **Ende durch Admin:** entsperren (alles wie vorher, normale Fristen laufen weiter – ein inzwischen abgelaufener
  Törn wird in der nächsten Nacht gelöscht) oder **endgültig löschen** (der normale Löschpfad des Objekts:
  `removeShare`, `removeBoat`, `removeGroup`, `removeHarbor`, `purgeUser` – samt Dateien, Zähler, Meldungen).
- **Ende durch Frist:** Läuft die Sperre ab, löscht der **nächtliche Lauf** das Objekt endgültig über denselben
  Löschpfad (höchstens 20 pro Nacht) und schreibt einen System-Eintrag ins Protokoll. Mitgesperrtes (`via_user`)
  folgt dem Konto. Die Admin-Seite zeigt das Ablaufdatum; was in 14 Tagen abläuft, ist hervorgehoben.
- **Erinnerung (F-294):** Was in 14 Tagen abläuft, meldet der nächtliche Lauf den Admins in **einer** Sammelmail (an
  die Adressen der Konten in `ADMIN_USER_IDS`, Link auf `/admin`) – einmal je Sperrfrist (`locks.reminded_at`; eine
  Verlängerung setzt es zurück). Mitgesperrtes erscheint nicht einzeln, es folgt dem Konto.
- **Begründung an Betroffene (F-296, DSA Art. 17):** Beim Sperren (nicht beim Verlängern) bekommt das gesperrte Konto
  bzw. Eigner:in des Objekts (Anleger:in beim Hafen) eine Mail: was gesperrt ist, die Begründung, dass es nach Ablauf
  der Frist endgültig gelöscht wird (Datum), wenn es nicht entsperrt wird, und dass man per Antwort (bzw. an
  `REPORT_CONTACT`) widersprechen kann. Ohne Konto oder Mail-Adresse keine Mail; ein gescheiterter Versand hält die
  Sperre nicht auf. Der Versand steht im Protokoll (`lock_notice`, ohne Adresse).
- **Aufräumen:** `locks`-Zeilen, deren Ziel es nicht mehr gibt, löscht der nächtliche Lauf; jeder Admin-Löschweg
  entfernt die Zeile seines Objekts.

### 18.5 Übersicht und Einblick

`GET /api/admin/list/:art?q=&filter=&page=` mit `art` ∈ `users`, `boats`, `groups`, `harbors`, `shares`; 50 je Seite,
neueste zuerst; `q` sucht in Namen, Profilnamen, Slugs, IDs und (nur bei Konten) E-Mail-Adressen.

| Filter | Bedeutung |
|---|---|
| `locked` | gesperrt |
| `hidden` | ausgeblendet (Meldung), nicht gesperrt |
| `suspended` | (Konten) suspendiert, nicht gesperrt |
| `private` | nicht öffentlich („Nur mit Link“ oder „Nur ich“) |
| `ownerless` | ohne Eigner: Häfen ohne (noch vorhandene) Anleger:in, Gruppen ohne Eigner-Mitgliedschaft oder mit gesperrtem Eigner-Konto, Boote mit gesperrtem Eigner-Konto |

Admins sehen alle Objekte, auch „Nur ich“ – aber nur **Metadaten** (Name, Eigner, Sichtbarkeit, Zahlen, Zeiten,
Sperr-/Ausblend-Status) und Links; die Inhalte selbst (Track, private Fotos) öffnet die Admin-Seite nicht. Jeder
Abruf einer Liste und jeder Detail-Abruf (`GET /api/admin/:art/:id`) wird protokolliert (`list`, `view`).

**Einblick in Gesperrtes (F-295):** Zur Prüfung dürfen Admins **gesperrte** Objekte auch inhaltlich öffnen – Törn
(Metadaten, Track, Vorschaubild), **alle** Fotos eines gesperrten Törns (auch „Nur ich“ und ausgeblendete), gesperrte
Boote und Gruppen – über die normalen Leserouten, nur lesend (Eigner-Pfade bleiben 404). Die vorhandenen
Sichtbarkeitsprüfungen (`visibleShare`, `visiblePhoto`, `getBoat`, `visibleGroup`) schreiben bei Gesperrtem **vor**
der Antwort einen Eintrag `view_content` (Ziel, Pfad) – scheitert er, gibt es keinen Inhalt (fail closed). Nicht
gesperrte private Inhalte („Nur ich“) bleiben auch für Admins verschlossen.

### 18.6 Umbenennen und Eigner neu zuweisen

| Objekt | Umbenennen (`PATCH /api/admin/:art/:id`) | Eigner (`POST /api/admin/:art/:id/owner { userId }`) |
|---|---|---|
| Konto/Profil | Anzeigename und Profilname (Adresse); gleiche Regeln wie beim Profil, 409 bei vergebenem Namen | – |
| Boot | Name | ja: neues Konto wird Eigner, das alte bleibt Boots-Admin (nichts geht verloren); Kontingent gilt nicht (Admin) |
| Gruppe | Name und Adresse (Slug) | ja: neues Konto wird Eigner (wird Mitglied, falls nicht), das alte wird Admin der Gruppe |
| Hafen | Name (Anzeige-Kopie an Booten und Gruppen folgt); gleicher normalisierter Name wie ein anderer Hafen → 409 `harbor_exists` (dann zusammenführen) | ja: Anleger:in (darf Name und Position pflegen) – löst auch 12.9 Frage 3 |
| Törn | – | **nein**: Ein Törn sind Positionsdaten der Person, die ihn aufgezeichnet hat; ein anderes Konto als Urheber würde fremde Bewegungsdaten unter falschem Namen zeigen, Speicher- und Ablaufregeln hängen am Konto. Törns wechseln das Konto nur beim Verbinden zweier Konten derselben Person (18.8) |

Gesperrte Objekte lassen sich nicht umbenennen oder übertragen (409 `locked`). Ausnahme: Ein Boot, das nur mit dem
gesperrten Konto seines Eigners mitgesperrt ist (Filter „ohne Eigner“), darf an ein anderes Konto gehen – die Mitsperre
endet dann. Neue Eigner müssen ein nicht gesperrtes Konto sein. Ändert die Moderation über die normale Hafenseite einen
fremden Hafen, steht das ebenfalls im Protokoll (`harbor_edit`).

### 18.7 Häfen zusammenführen

`POST /api/admin/harbors/:id/merge { into }` führt den Hafen `:id` (Dublette) in `into` über, in **einem** D1-Batch:

- Boote, Gruppen (`harbor_id` und Anzeige-Kopie `home_port`), Heimathafen der Personen (`users.home_harbor_id`)
- Folgen (wer beiden folgt, folgt danach einmal), Ziele der Neuigkeiten (`activity_target`), Aktivitäten
  „Neues Boot im Hafen“ (`data.harbor`)
- Verein des Hafens, wenn das Ziel keinen hat; Meldungen zur Dublette fallen weg
- alte Adresse: `harbor_redirects (old_slug → harbor_id)`; Weiterleitungen, die auf die Dublette zeigten, zeigen
  danach aufs Ziel. `/h/<alt>` antwortet mit **301** auf `/h/<neu>`, `GET /api/harbors/slug/<alt>` liefert den
  Zielhafen. Neue Häfen bekommen keinen Slug, der als Weiterleitung belegt ist. Weiterleitungen enthalten keine
  Personendaten und leben so lange wie ihr Zielhafen.
- danach wird die Dublette gelöscht. Gesperrte Häfen (Quelle oder Ziel) → 409 `locked`; gleicher Hafen → 400.

### 18.8 Konten verbinden

Zwei Konten derselben Person (z. B. zwei Mail-Adressen): `GET /api/admin/users/:id/merge?into=` zeigt eine Vorschau
(Zahlen und Konflikte), `POST /api/admin/users/:id/merge { into, confirm }` führt aus – `confirm` muss die ID des
**aufgelösten** Kontos `:id` sein (Tippbestätigung im Dialog). Das Zielkonto `into` behält Mail-Adresse, Sitzungen,
Einstellungen. Alles Umhängen in einem D1-Batch, danach entfernt `purgeUser` das leere Quellkonto (gleicher Löschpfad
wie immer, Reste fallen mit).

| Daten | Regel bzw. Konflikt |
|---|---|
| Törns, Fotos, Kommentare, Beiträge, Aktivitäten | gehen ans Ziel; Kontingente gelten danach für das Ziel, Überschreitung ist erlaubt (wie Altbestand: nichts wird gelöscht, nur Neues gesperrt) |
| Boote | Eigner wird das Ziel; Boots-Admin-Einträge der Quelle gehen ans Ziel, außer das Ziel ist dort schon Eigner/Admin |
| Gruppen | Eigner-Gruppen gehen ans Ziel; Mitgliedschaft: in beiden Mitglied → die höhere Rolle (Eigner > Admin > Mitglied); Anfragen nur, wenn das Ziel noch kein Mitglied ist |
| Crew auf Törns | geht ans Ziel; auf eigenen Törns des Ziels entfällt sie |
| Folgen | in beide Richtungen ans Ziel; doppelte zählen einmal; Folgen auf sich selbst entfallen |
| Reaktionen | die des Ziels gewinnen bei demselben Gegenstand |
| Passkeys | gehen ans Ziel (die Grenze von 10 gilt nur beim Anlegen); offene Challenges der Quelle entfallen |
| Unterstützungen | gehen ans Ziel (Status und Ablauf der Törns rechnen mit dem spätesten) |
| Einladungen, eigene Meldungen | gehen ans Ziel (doppelte Meldungen entfallen) |
| Profil | das des Ziels bleibt; hat das Ziel keins, übernimmt es das der Quelle (Name, Adresse, Text, Sichtbarkeit) – das Titelbild der Quelle entfällt in jedem Fall |
| Heimatverein, Heimathafen | die Wahl des Ziels; fehlt sie, die der Quelle |
| Suspendierung | ist eins der Konten suspendiert, ist es danach das Ziel (fail closed) |
| nicht möglich | gleiche Konten (400), Admin-Konto als Quelle (400), gesperrte Konten (409 `locked`) |

### 18.9 Endgültig löschen

`DELETE /api/admin/:art/:id { confirm }` (`confirm` = ID) löscht über den Löschpfad des Objekts; Konten über
`purgeUser` (nicht für Admin-Konten). Eine bestehende Sperre endet damit. Besitzt ein Konto noch einzeln gesperrte
Törns, Boote oder Gruppen, lehnt das Löschen des Kontos ab (409 `locked_content`) – diese Belege werden einzeln
entschieden. Der Protokolleintrag wird vor dem Löschen geschrieben.

### 18.9a Unterstützer-Gutschein

Admins können einem Konto Unterstützer-Status schenken (z. B. für Vereinsvorstände, Tester, Ersatz bei Problemen):
`POST /api/admin/users/:id/support { seasons, note }` mit 1 – 3 Saisons. Er wirkt genau wie eine Zahlung (Fotos,
„Nur mit Link“/„Nur ich“, höhere Kontingente, späterer Ablauf der Törns) und wird wie eine Zahlung an eine laufende
Unterstützung angehängt (`extendSupport`). Gespeichert als Zeile in `supports` mit `provider = 'admin'`, Betrag 0 –
so bleibt der Status weiter aus den Zeilen abgeleitet (Konzept 5) und nachvollziehbar, woher er kommt.
`DELETE /api/admin/users/:id/support` entzieht alle Gutscheine des Kontos; bezahlte Unterstützung bleibt. Beides steht
im Protokoll (`grant_support`, `revoke_support`). Frist: Gutscheine sind keine Buchungen (keine steuerliche
Aufbewahrung) und werden **2 Jahre nach ihrem Ablauf** gelöscht; Konto löschen löst den Bezug wie bei Zahlungen.

### 18.10 Admin-Protokoll

Tabelle `admin_log (id, admin_id, action, target_kind, target_id, detail, created_at)`; `admin_id` NULL = nächtlicher
Lauf. Aktionen: `list`, `view`, `lock`, `extend`, `unlock`, `lock_expired`, `rename`, `owner`, `merge_harbor`,
`merge_user`, `delete`, `grant_support`, `revoke_support`, `delete_comment`, `harbor_edit`, `lock_notice`,
`view_content` (Einblick in Gesperrtes, 18.5), dazu die Meldungs-Entscheidungen (`report_keep`, `report_hide`, `report_delete`) und
`suspend`/`unsuspend`. `detail` ist ein kurzer Text (höchstens 500 Zeichen: Begründung, alter → neuer Name,
Zahlen) – **keine Mail-Adressen**. Lesen: `GET /api/admin/log?q=&page=` (Suche nach Ziel-ID, Admin oder Aktion).

Fristen: Einblicke (`list`, `view`) **180 Tage**, alle übrigen Einträge **2 Jahre** (auch `view_content`: Zugriff auf
private Inhalte soll so lange nachweisbar sein wie die Aktionen) (Nachweis gegenüber Betroffenen
und Behörden, DSA, berechtigtes Interesse); Einträge zu einem noch gesperrten Ziel bleiben, bis die Sperre endet.
Gelöscht nachts. Konto löschen lässt Einträge über das Konto bestehen (nur IDs und Namen, keine Inhalte).

### 18.11 Datenmodell (`0023_admin.sql`)

- `users.locked_at`, `shares.locked_at`, `boats.locked_at`, `groups.locked_at`
- `locks (target_kind, target_id, locked_at, until, locked_by, reason, via_user, prev_at, reminded_at)`, Primärschlüssel
  `(target_kind, target_id)`; `target_kind` ∈ `user`, `share`, `boat`, `group`, `harbor`
- `admin_log` wie 18.10, `harbor_redirects (old_slug PRIMARY KEY, harbor_id → harbors ON DELETE CASCADE, created_at)`

Module: `src/domain/admin.ts` (Arten, Filter, Fristen – rein), `src/controllers/admin.ts` (lädt und handelt; die
Seite meldet nur Absichten), `worker/locks.ts` (Sperren und
Sperr-Fristen), `worker/admin.ts` (Listen, Details, Umbenennen, Eigner, Löschen, Protokoll),
`worker/admin-merge.ts` (Häfen und Konten zusammenführen), Routen in `worker/admin-routes.ts`.

### 18.12 Oberfläche

`/admin` (`sx-admin-page`, nachgeladen): Reiter Konten, Boote, Gruppen, Häfen, Törns, Protokoll. Je Reiter Suche,
Filter-Chips, seitenweise blättern; je Zeile Status-Abzeichen (gesperrt bis …, ausgeblendet, suspendiert, privat) und
Aktionen: Details, Umbenennen, Eigner, Sperren/Verlängern/Entsperren, Zusammenführen (Häfen, Konten), Endgültig
löschen. Zerstörerische Aktionen fragen nach (Löschen und Konten verbinden mit Eingabe der ID). Meldungen bleiben im
Konto-Dialog (Reiter „Meldungen“).

### 18.13 Fragen an den Betreiber – entschieden (28.10.2026)

1. Sperrfrist: bleibt bei **180 Tagen** mit automatischem endgültigen Löschen danach, dazu **14 Tage vorher eine
   Erinnerung** an die Admins (18.4, F-294).
2. Inhalte gesperrter Objekte: Admins dürfen sie zur Prüfung **lesend** öffnen, **jeder** Einblick steht im
   Protokoll (18.5, F-295).
3. Betroffene bekommen beim Sperren eine **Mail mit Begründung** (DSA Art. 17) und dem Hinweis auf Widerspruch
   (18.4, F-296).

## 16. Kartenstil (Farbverlauf, Wind- und Wellen-Symbole)

Nutzer passen die Kartenansicht über feste **Sets** an statt über einzelne Regler – das hält die Bedienung klein,
die Legende ehrlich (jedes Set ist ein durchgehender, getesteter Verlauf) und die Einstellung als einen einzigen Wert
speicherbar. Reine Regeln in `src/domain/map-style.ts`; Karte, Legende und Teilen-Bild lesen den geltenden Stil aus
dem Store (`mapStyle`).

| Set | Verlauf (Track, Legende, Teilen-Bild) | Wind-/Wellen-Symbole | Linie |
|---|---|---|---|
| Klassisch (Standard) | kühl → warm, wie bisher | Stärkefarbe aus dem Verlauf | 4 px |
| Kontrast | kräftig, großer Helligkeitsabstand | Stärkefarbe, 125 % groß | 5 px |
| Farbenblind-freundlich | Viridis (Violett → Gelb, stetig heller) | Stärkefarbe | 4 px |
| Dezent | Hellgrau → Rostrot (stetig dunkler) | feste Bedeutungsfarbe (`--c-wind`, `--c-wave`), Zahl trägt die Stärke | 4 px |

Bewusst nicht: andere Symbolformen (Windfiedern o. Ä.) – Badge mit Knotenzahl und Wellen-Chevron bleiben, damit jede
Zahl eine Einheit behält; eigene Farben je Nutzer; Verläufe je Hell/Dunkel (die Halos unter Linie und Symbolen tragen
den Kontrast auf beiden Grundkarten). Die Verlaufsfarben sind Daten des Sets (wie bisher `RAMP`), keine Tokens.
Diagramme und die Bedeutungsfarben (`--c-speed` usw.) ändern sich nicht.

**Bedienung (Entscheidung des Betreibers):** ein Zahnrad („Ansicht konfigurieren“) unten rechts über der Karte (nur in
der Törn-Ansicht, nicht in Einbettungen) öffnet ein kleines Menü mit den Stilen (Name, Farbverlauf, Haken am geltenden).
Ein Klick wendet den Stil sofort an – kein „Übernehmen“, kein „Nur jetzt“. Angemeldet stehen darunter „… als Standard
setzen“ (für den geltenden Stil) und „Standard entfernen“. Mobil kommt das Menü als Sheet vom unteren Rand.

**Speicherung und Vorrang:** Die Auswahl gilt sofort und bis die Seite neu geladen bzw. neu geöffnet wird (auch über
Törn-Wechsel hinweg); sie liegt nur im Speicher der Seite. Der Profil-Standard liegt in `users.map_style` (Migration 0019, NULL = keiner) und
kommt über `GET /api/me/settings` nach jeder Anmeldung – so gilt er auf allen Geräten. Vorrang: Auswahl → Profil →
„Klassisch“. „Standard entfernen“ setzt NULL, die Ansicht bleibt. Im Browser wird nichts gespeichert.
Gültige Werte prüft der Worker mit derselben Domain-Regel (kein SQL-`CHECK`); ein unbekannter Wert in der Datenbank
gilt als „kein Standard“. Löschen: die Spalte liegt in der Konto-Zeile und verschwindet mit dem Konto (alle Löschpfade
des Kontos), sonst wird nichts gespeichert.

**Beschriftung auf Deutsch (F-293):** Die App ist durchgehend deutsch, Mehrsprachigkeit ist vorerst nicht geplant.
Rasterkacheln bringen ihre Beschriftung fertig mit – Esri beschriftet englisch („Baltic Sea“), OpenStreetMap mit dem
Ortsnamen („Östersjön“). Deshalb wählt eine einzige Einstellung `MAP_LANG = 'de'` (`src/domain/basemaps.ts`) die
Standard-Grundkarte: tagsüber OSM Deutschland (`name:de`, sonst `name`), nachts Esri Dark Gray ohne Beschriftung; das
Teilen-Bild nimmt dieselbe Tageskarte. Die ruhigere Esri-Seekarte bleibt als „Seekarte (Esri, englisch)“ wählbar. Ein
späterer Sprachwechsel ändert nur `MAP_LANG` (dann ggf. weitere Kachelquellen). Echte Sprachwahl je Beschriftung ginge
nur mit Vektorkacheln (MapLibre) – bewusst nicht jetzt.

## 17. Benachrichtigungen (Glocke)

*Umgesetzt (Oktober 2026): `migrations/0021_notifications.sql`, `worker/notifications.ts`,
`worker/notification-cleanup.ts`, `src/domain/notifications.ts`, `src/controllers/notifications.ts`, `sx-notifications`,
Glocke in `sx-topbar`; Anforderungen F-250 … F-255. Beantwortet die offene Frage 12.9.4 und ersetzt die Vorbereitung
aus 11.10 und 12.5.*

Anlass: „Wir brauchen Benachrichtigungen sichtbar auf der Seite zu neuen Nachrichten.“ Direktnachrichten gibt es
nicht; „Nachrichten“ sind das, was eine Person persönlich betrifft und heute teils per Mail kommt – Kommentare,
Reaktionen, neue Follower, Einladungen und Beitrittsanfragen. Was die Community insgesamt bewegt (Törns, Fotos,
Beiträge der Gruppen), bleibt der Stream (12.4); ein Ungelesen-Badge dafür ist ein eigenes Vorhaben (12.10, Branch
`feature/kopfzeile-community`).

### 17.1 Was benachrichtigt

| Art (`kind`) | Anlass | Empfänger | Gegenstand (`subject_kind`) |
|---|---|---|---|
| `comment` | Kommentar auf einem Törn | Eigentümer:in des Törns und alle, die dort schon kommentiert haben (nur öffentliche Törns, ohne ausgeblendete Kommentare und gesperrte Konten; höchstens 50, Eigentümer:in zuerst, dann die zuletzt Aktiven – 17.9.1) | `share` |
| `reaction` | Reaktion auf Törn, Foto, Beitrag, Neuigkeit | Eigentümer:in bzw. Autor:in bzw. handelnde Person der Neuigkeit | `share` (auch bei Fotos), `post`, `activity` |
| `follow` | jemand folgt dem Profil | die Person | `user` (sie selbst) |
| `invite` | Einladung per Profilname oder an die Adresse eines bestehenden Kontos | eingeladenes Konto | `invite` |
| `request` | Beitrittsanfrage (auch aus angenommener Einladung) | Eigner und Admins, bei „Nur der Eigner“ nur er; höchstens 20 | `group` |

Nie an sich selbst. Boote, Gruppen und Häfen folgen benachrichtigt niemanden (zu viele Empfänger, wenig Wert).

### 17.2 Datenmodell und Bündeln

`notifications (id, user_id, kind, subject_kind, subject_id, actor_id, count, created_at, updated_at, read_at)` – hier
ist Fan-out richtig, weil genau eine Person adressiert ist. Ein eindeutiger Teilindex auf `(user_id, kind,
subject_kind, subject_id) WHERE read_at IS NULL` bündelt: solange ungelesen, zählt ein neues Ereignis nur `count`
hoch und ersetzt `actor_id` („Anna und 2 weitere …“). Nach dem Lesen beginnt eine neue Zeile. Geschrieben wird mit
einem einzigen `INSERT … SELECT … ON CONFLICT` an denselben Stellen, die heute `activity` oder Mails auslösen
(Kommentar, Reaktion, Folgen, Einladung, Anfrage); ein Fehler dabei lässt die Aktion nie scheitern. Eine Reaktion
benachrichtigt nur, wenn sie neu ist (Art wechseln nicht); bei Reaktionen und Follower:innen zählt dieselbe Person
direkt hintereinander nur einmal. Arten und
Gegenstände ohne SQL-`CHECK` (Prinzip Architektur 7). Konflikt-Hinweis: Führt ein anderer Branch eine Kontosperre
(`locked_at`) ein, gehört sie in die Prüf-Joins aus 17.3 (Handelnde, Einladende).

### 17.3 Lesen, Sichtbarkeit, Kosten

`GET /api/notifications` liest die neuesten 30 Einträge mit **einer** Abfrage samt Prüf-Joins: Törns und Beiträge nur
eigene (Kommentare auf mitkommentierten Törns nur, solange der Törn öffentlich, nicht ausgeblendet oder gesperrt ist
und Kommentare zeigt – Ziel ohne Schlüssel), Anfragen nur solange man bestätigen darf (`canApprove`), Einladungen nur gültig und an mich. Handelnde nur
mit öffentlichem, nicht ausgeblendetem Profil eines nicht gesperrten Kontos, sonst „Jemand“ – Namen nicht öffentlicher
Profile werden so nie verraten. Keine Konto-IDs, keine E-Mail-Adressen. Was nicht mehr gilt, erscheint nicht und wird
als gelesen markiert, damit der Zähler stimmt. `GET /api/notifications/count` zählt nur (Index, höchstens 100).

**Kein Polling-Sturm:** Der Zähler lädt beim Start bzw. nach der Anmeldung und beim Zurückkehren in den Tab
(frühestens alle 2 min); Seitenwechsel sind ohnehin Neuladen. Neues kommt live (17.8). Die Liste lädt erst beim Öffnen
der Glocke.
**D1-Writes:** eine Zeile je Ereignis und Empfänger, beim Bündeln ein Update; Lesen markieren nur, wenn es
Ungelesenes gibt (UPDATE ohne Treffer schreibt nichts).

### 17.4 Gelesen – auch beim Lesen und über Mail-Links

Eine Benachrichtigung gilt als gelesen,

- beim Anklicken in der Liste (dann öffnet sich das Ziel) oder mit „Alle als gelesen“,
- **nur zur Kenntnis** (Reaktionen, Follower): sobald die Liste sie gezeigt hat,
- beim **Öffnen des Gegenstands** – egal ob über die Glocke, einen Link aus einer Mail oder direkt: Törn geöffnet →
  Kommentare und Reaktionen dazu; Gruppenseite → Anfragen; Konto mit „Einladungen an dich“ → Einladungen; Einladung
  über den Mail-Link angesehen (`peek`, als eingeladenes Konto) → diese Einladung. Kommt der Zähler erst nach dem
  Öffnen an, wird es nachgeholt.

**Mail und Glocke gehören zusammen:** Die tägliche Sammelmail (17.6, opt-in je Art; früher nur Kommentare, 4.1) nennt
nur, was in der Glocke noch ungelesen ist – was auf der Seite gelesen wurde, kommt nicht noch einmal per Mail.
Ihre Links führen zum Törn, und das Öffnen markiert als gelesen. Einladungsmails führen zum Einladungs-Dialog
(`peek`). Kommentare vor der Einführung der Glocke haben keine Benachrichtigung und erscheinen daher nicht mehr in der
Sammelmail (einmaliger Übergang).

### 17.5 Aufräumen (Prüfpunkt 6)

| Anlass | Was |
|---|---|
| Törn löschen oder ablaufen | Einträge mit dem Törn als Gegenstand (Kommentare, Reaktionen, Löschwarnung) und Crew-Einladungen |
| Beitrag löschen (auch Moderation) | Reaktionen auf den Beitrag |
| Boot löschen | Einladungen als Boots-Admin |
| Gruppe löschen | Anfragen, Reaktionen auf ihre Beiträge, Einladungen in die Gruppe |
| Einladung angenommen, abgelehnt, zurückgezogen | ihre Einträge |
| Konto löschen (auch inaktiv, `purgeUser`) | eigene Einträge und Push-Abos, solche über eigene Beiträge und Einladungen des Kontos (auch zu seinen Booten und Törns) bei anderen; als Handelnde wird `actor_id` geleert („Jemand“, Zählung bleibt) |
| Nächtlich (eigener Schritt) | gelesene nach **30 Tagen**, alle nach **90 Tagen**, Einträge ohne Gegenstand (Törn, Beitrag, Neuigkeit, Gruppe, Konto, gültige Einladung) – je Schritt höchstens 1000; Push-Abos ein Jahr ohne Zustellung |

Keine R2-Dateien, kein Speicherzähler; das Durable Object speichert nichts (nur offene Verbindungen). Fristen stehen in der Datenschutzerklärung (`src/content/legal.ts`).

### 17.6 Kanäle je Art: keine, Mail, Push – Hinweise des Betreibers nicht abschaltbar

Vorgabe des Betreibers: Benachrichtigungen per Mail sollen abschaltbar sein, als App-Benachrichtigung (Push)
einschaltbar – Auswahl *keine / Mail / Push*; Hinweise des Betreibers zum Konto und zum Löschen nicht abschaltbar.

| Art | Standard | Mail heißt |
|---|---|---|
| Kommentare auf deinen Törns und Törns, die du kommentiert hast | keine | tägliche Sammelmail (bisher „Tägliche Sammelmail bei neuen Kommentaren“, übernommen) |
| Reaktionen auf deine Inhalte | keine | tägliche Sammelmail |
| Neue Follower | keine | tägliche Sammelmail |
| Einladungen an dich (per Profilname) | Mail | sofort die Einladungsmail (wie bisher); Einladungen an eine Adresse sind die Mail selbst und kommen immer |
| Beitrittsanfragen in deinen Gruppen | keine | tägliche Sammelmail |

Die Glocke zeigt **immer** alles; die Auswahl betrifft nur, was zusätzlich kommt. Gespeichert als JSON in
`users.notify_prefs` (fehlende Arten = Standard), Konto → Einstellungen, `PATCH /api/me/settings { notify }`;
`notifyComments` bleibt als Kurzform (`daily` = Kommentare per Mail). Die **Sammelmail** ersetzt die bisherige
Kommentar-Sammelmail: einmal am Tag (höchstens 25 pro Lauf, Resend Free), nur Ungelesenes der Arten auf „Mail“ seit der
letzten Sammelmail, geprüft wie die Liste (17.3), Zeilen nur mit Anzahl und eigenem Törn bzw. eigener Gruppe – keine
Namen, keine Texte, Follower-Links zur Startseite. Wird eine Art neu auf Mail gestellt und gab es bisher keine
Sammelmail, zählt erst ab dann.

**Nicht abschaltbar** (Hinweise des Betreibers): Anmeldelink/-code, „neuer Passkey an deinem Konto“, „Törns werden bald
gelöscht“ und die Saison-Erinnerung kommen immer per Mail. Passkey und Löschwarnung (`passkey`, `expiry`) erscheinen
zusätzlich in der Glocke, ohne handelnde Person; sie stehen nicht in der Auswahl.

### 17.7 Push (Web Push)

Push heißt eine Mitteilung des Betriebssystems, auch wenn die Seite zu ist. Umsetzung ohne Fremd-Bibliothek:
`public/sw.js` (nur Push, kein Offline-Cache), Abo per `PushManager.subscribe` mit dem öffentlichen VAPID-Schlüssel
(`GET /api/push/key`), gespeichert wird nur die **Adresse** des Push-Dienstes (`push_subscriptions.endpoint`,
`PUT/DELETE /api/me/push`, höchstens 10 Geräte je Konto, nur bekannte Dienste: Google, Mozilla, Apple, Microsoft – sonst
400).

**Leere Weckrufe:** Der Worker schickt je Gerät ein `POST` ohne Inhalt mit VAPID-Signatur (ES256, 12 h gültig) – keine
Verschlüsselung nötig, und der Push-Dienst erfährt nichts über Inhalte. Der Service Worker holt dann
`/api/notifications` mit der Sitzung und zeigt den neuesten ungelesenen Eintrag (`text`, `href`); ohne Sitzung einen
neutralen Hinweis; er fragt `?push=1` und sieht so nur Arten auf „Push“. 403/404/410 vom Dienst löschen das Abo.
Push geht nur an Arten auf „Push“, nicht an Hinweise des Betreibers, und nicht erneut, wenn dieselbe Person direkt
hintereinander folgt oder reagiert. Gesendet wird parallel, das JWT je Push-Dienst einmal, höchstens 20 Geräte je
Ereignis (Subrequest-Grenze, Latenz der auslösenden Anfrage – der Worker hat dort kein `waitUntil`). Wählt man Push,
fragt der Browser nach der Erlaubnis; steht keine Art mehr auf Push, werden **alle** Geräte des Kontos abgemeldet.
Abmelden meldet dieses Gerät ab (geteilter Rechner). Ohne VAPID-Schlüssel (Vorschau, lokale Entwicklung) ist „Push“ ausgegraut. iOS: nur als App vom
Home-Bildschirm. Aufräumen: Konto löschen, ein Jahr ohne Zustellung (nächtlich).

### 17.8 Live per WebSocket

Neues soll ohne Neuladen und ohne Polling erscheinen. Ein **Durable Object je Konto** (`NotificationHub`,
SQLite-basiert, im Free Tier enthalten) hält die offenen Seiten per WebSocket mit **Hibernation** – zwischen den
Nachrichten schläft es und kostet keine Dauer. Entsteht eine Benachrichtigung oder wird eine gelesen, stößt der Worker
das Objekt des Kontos an; es schickt allen Seiten nur `changed` – den Zähler (und eine offene Liste) holt jede Seite
selbst, mit derselben Prüfung wie immer. Im Socket stehen also nie Inhalte. `GET /api/notifications/live` nur
angemeldet und nur mit Origin der eigenen Seite (Schutz vor Cross-Site WebSocket Hijacking), höchstens 10 Verbindungen
je Konto. „ping“ beantwortet die Laufzeit selbst (Auto-Response, ohne Aufwachen). Die Seite verbindet nach dem ersten
Zähler, schließt im Hintergrund-Tab und verbindet beim Zurückkommen sofort wieder; nach einem Abbruch mit wachsendem
Abstand (5 s … 5 min), auch wenn das Netz gerade fehlt. Beim Wiederverbinden lädt sie den Zähler nach. Eine Seite, die
wegen zu vieler Verbindungen getrennt wurde (Code 4000), bleibt ohne Live.

**Kosten:** je Benachrichtigung und Empfänger eine Anfrage ans Durable Object (Free: 100 000/Tag), je offene Seite eine
Verbindung; ohne Binding (andere Installationen) ist Live aus und die Glocke lädt wie in 17.3.

### 17.9 Fragen an den Betreiber – entschieden 28.10.2026

1. **Mitkommentierende:** Ein neuer Kommentar benachrichtigt die Eigentümer:in und alle, die auf dem Törn schon
   kommentiert haben – nie die Autor:in selbst. Jede:r nach eigener Auswahl für „Kommentare“ (keine/Mail/Push),
   gebündelt je Törn wie bisher. Nur bei öffentlichen, nicht ausgeblendeten oder gesperrten Törns mit sichtbaren
   Kommentaren; ausgeblendete Kommentare und gesperrte Konten zählen nicht, gelöschte Konten haben keine Kommentare
   mehr. Höchstens 50 Empfänger (Eigentümer:in zuerst, dann die zuletzt Aktiven). Beim Lesen erneut geprüft (17.3):
   „Nur mit Link“ oder „Nur ich“ fällt für Mitkommentierende weg – der Schlüssel könnte inzwischen erneuert sein und
   darf über die Glocke nicht verraten werden.
2. **Anfragen bei „Alle Mitglieder bestätigen“:** bleibt – gemeldet werden nur Eigner und Admins (höchstens 20).
3. **Löschwarnung nach Unterstützung:** verschwindet automatisch – Stripe-Zahlung (Webhook) und Gutschein der
   Moderation löschen die Löschwarnungen zu Törns, die danach nicht mehr im Warnfenster (14 Tage) ablaufen.
4. **VAPID-Schlüssel:** setzt der Betreiber (`node scripts/vapid-keys.mjs`, README) – erst dann ist Push in der
   Produktion wählbar.

## 15. Crew-Rollen

Stand: 27.10.2026, vom Betreiber freigegeben. Ausführliches Konzept mit Stammcrew-Schaltern, Boot-Beiträgen, Charter
und Meilennachweis: `crew-rollen-konzept.md` (außerhalb des Repos; baut auf `docs/ROLLEN.md` aus
`feature/supporter-badges` auf). Anforderungen **F-270 … F-280**. Umgesetzt ist der Teil, der nicht von den
Boots-Stufen aus ROLLEN.md abhängt: **Rollen am Törn und Bestätigung durch den Skipper** (F-275, F-276, F-279, F-280).
Umsetzung: `migrations/0022_crew_roles.sql`, `src/domain/crew-roles.ts`, `worker/crew-roles.ts`, `worker/invites.ts`
(`getCrew`, Einladung mit Rolle), `sx-crew`.

| Punkt | Entscheidung |
|---|---|
| Rollen | `skipper` · `co` (Co-Skipper:in/Wachführer:in) · `crew` (Standard) · `guest`. Crew-Mitglieder in `share_crew.role`, die Eigentümer:in in `shares.owner_role` (NULL = nicht angegeben). Das Fahrtenbuch liest künftig diese Spalte statt `log.role` |
| Wer setzt | Eigentümer:in alle Rollen; Crew nur die eigene, nie Skipper; Einladungen geben Co-Skipper, Crew oder Gast vor |
| Skipper | höchstens eine:r je Törn, geprüft in derselben SQL-Anweisung (409 `skipper_taken`) |
| Bestätigung | nur die Skipper:in bestätigt die anderen (nie sich selbst), auch die Eigentümer:in. Neue Rolle → Bestätigung der Person fällt; anderes Boot, Skipper-Wechsel oder Skipper verlässt die Crew → alle fallen. Ersetzt keine Unterschrift |
| Sichtbarkeit | Crew öffnet weiter nichts (10.6): Rollen erscheinen für Besucher nur neben namentlich genannten Mitgliedern öffentlicher Törns; Bestätigungen nur für Eigentümer:in, Skipper:in und die Person selbst. Ein Skipper aus der Crew sieht alle Mitglieder (zum Bestätigen), private Profile aber nur mit Spaßnamen; Anzeigenamen privater Profile sieht nur die Eigentümer:in. „Bestätigt von“ nennt den Namen nur bei öffentlichem Profil |
| Nicht öffentliche Törns | Die Schreib-Endpunkte prüfen die Mitgliedschaft, nicht die Sichtbarkeit. Das Crew-Panel gibt es aber nur, wo man den Törn sehen darf; für Crew nicht öffentlicher Törns kommt die Ansicht mit dem Meilennachweis (Ausnahme M1, nur Eckdaten). Ausgeblendete Törns (Moderation) → 404 auch für Rollen |
| Gleichzeitigkeit | Skipper-Prüfung, „Rolle noch die gelesene“ (sonst 409 `role_changed`) und „bin noch Skipper“ beim Bestätigen stehen jeweils in derselben SQL-Anweisung; dazu ein eindeutiger Teilindex „ein Skipper je Törn“ |
| Löschen | mit Törn und Crew-Eintrag; Boot gelöscht (auch mit dem Konto des Eigners) → Bestätigungen der Törns fallen; Konto der Skipper:in gelöscht → Bestätigung bleibt ohne Konto-ID |

Noch offen (eigene Schritte): Stammcrew-Schalter, Titel, Boot-Beiträge und „Törns zuordnen“ (F-270 … F-274, brauchen
`boat_admins.role` aus ROLLEN.md Schritt 1); Meilennachweis-Export und „In mein Fahrtenbuch übernehmen“ (F-277, F-278,
mit dem Fahrtenbuch); Ausnahme M1 (Eckdaten nicht öffentlicher Törns im eigenen Nachweis) kommt mit dem Export.
