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

**Neue Abschnitte ab 26** stehen je Feature als eigene Datei in `docs/concept/NN-name.md`; am Ende dieser Datei steht
dafür nur eine Verweiszeile (CLAUDE.md, „Docs konfliktarm“). Die Nummer kommt aus den Reservierungen in `docs/ROADMAP.md`.

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

Umgesetzt: Panel „Kommentare“ nach „Crew“; das Formular erscheint erst nach „Kommentieren“ (ohne Anmeldung führt
der Knopf zur Anmeldung, ohne Profil zum Hinweis „Profil anlegen“; gesperrt oder abgeschaltet steht der Grund da).
„Törn melden“ und der Schalter Kommentare an/aus liegen im Zahnrad des Törns (F-510, F-514), „Melden“ auf Profil-
und Bootsseiten ebenfalls im Zahnrad. Die tägliche Sammelmail schaltet man im Konto unter „Einstellungen“.

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
„<Name> lädt dich ein, das Boot „<Boot>“ bei Luv & Leute mitzuverwalten“
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
- Jeder kann sich selbst entfernen (Crew: „Crew verlassen“ im Zahnrad des Törns, Admin: „Boot
  verlassen“); der Eigentümer kann jederzeit entfernen. Konto löschen entfernt
  alle Mitgliedschaften und Einladungen.

### 10.7 Oberfläche

| Stelle | Inhalt |
|---|---|
| `sx-account-dialog`, Reiter Boote | Knopf „Admins“ je Boot: Liste, entfernen, offene Einladungen zurückziehen, Feld „E-Mail oder Profilname“ (nur Eigner); als Admin „Boot verlassen“ mit Bestätigung |
| `sx-account-dialog`, oben | „Einladungen an dich“: Einladender, Ziel, Annehmen/Ablehnen |
| `sx-crew` (neu, Panel „Crew“ in der Törn-Ansicht) | Besucher: Namen mit Profil-Link, „+ n weitere“; Eigentümer: „+ Einladen“ klappt auf: „Einladungslink erzeugen“ (einmal anzeigen, kopieren), per E-Mail oder Profilname einladen, offene Einladungen (F-513); Entfernen und Rollen im Bearbeiten-Modus (F-512); Crew: „Crew verlassen“ im Zahnrad des Törns (F-510) |
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

Stand: Oktober 2026. Ziel des Betreibers: Luv & Leute (bis 03.11.2026 „Sail Explorer“) soll Segler zusammenbringen – wie ein soziales Netz, aber
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
| Gruppenseite | Kopf (Name, Art, Heimathafen, Beschreibung, Verein bzw. Teams), Kennzahlen (Mitglieder, Boote, sm und Törns – nur öffentliche, nicht ausgeblendete Törns, die in der Gruppe gezeigt werden (11.12); „Saison“ = Kalenderjahr), Mitglieder (namentlich nur mit öffentlichem Profil, sonst „+ n weitere“; Admins sehen alle Anzeigenamen), Boote, Neuigkeiten. Link-Vorschau wie `/u` und `/b` |
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
| Törn wird öffentlich (Anlegen oder Wechsel, einmal je Törn) | `voyage` | Segler (`user`), Boot, Hafen des Boots (12.4), die **ausgewählten** Gruppen des Törns (`share_groups`, 11.12) |
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
| Törn löschen/ablaufen | Aktivitäten mit dem Törn als Gegenstand, seine Gruppen-Auswahl (`share_groups`) |
| Boot löschen | Gruppen-Zuordnungen, Folgen, Aktivitäten des Boots, Ziele `boat` |
| Gruppe löschen | Mitglieder, Anfragen, Boots-Zuordnungen, gezeigte Törns (`share_groups`), Beiträge, Einladungen, Folgen, Aktivitäten der Gruppe, Ziele `group`, Meldungen |
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

### 11.12 Törns in Gruppen: beim Teilen auswählen (Entscheidung 28.10.2026)

Betreiber: „derzeit werden Fotos und Seemeilen der Mitglieder z. B. im Hafen gepostet oder Gruppe Mittwochsregatta,
ideal wäre: jemand veröffentlicht einen Törn da in der Gruppe und dann taucht das dort auf … das ist so herum
verwirrend.“ Gewählt: **beim Teilen auswählen** (F-373 … F-378).

- **Auswahl:** Beim Speichern bzw. Teilen zeigt der Dialog „In Gruppen zeigen“ mit einem Haken je Gruppe, in der die
  Eigentümer:in Mitglied ist (nicht ausgeblendet, nicht gesperrt). Vorausgewählt sind die Gruppen, denen das Boot des
  Törns zugeordnet ist; ohne Boot keine. Ein Boot in einer Gruppe, in der man nicht Mitglied ist (z. B. als
  Boots-Admin), wählt dort nichts vor. Ohne Angabe (ältere Oberflächen) gilt dieselbe Vorauswahl.
- **Wirkung:** Nur ausgewählte **öffentliche** Törns erscheinen im Gruppen-Stream und zählen in Kennzahlen (Seemeilen,
  Törns, Saison), Meilensteinen, Galerie, Wochenmail und „in <Gruppe>“ am Törn (F-228). Andere Törns der Mitglieder
  erscheinen dort nicht mehr; im persönlichen Stream bleiben sie über Segler, Boot, Teammitglieder und Gefolgtes (12.4).
- **Hafen bleibt automatisch:** Törns öffentlicher Boote mit Heimathafen erscheinen weiter im Hafen (12.4).
- **Später ändern:** am gespeicherten Törn im Teilen-Dialog (`PATCH /api/shares/:id { groupIds }`); die Gruppen-Ziele
  der Törn- und Foto-Aktivitäten werden angeglichen (neue Ziele mit der Zeit der Aktivität – nichts springt nach oben
  oder zählt erneut). Ein Bootswechsel ändert die Auswahl nicht. Zeilen ausgeblendeter oder gesperrter Gruppen bleiben
  beim Ersetzen stehen (nicht wählbar, Sperre umkehrbar). Meilensteine werden nur beim Veröffentlichen geprüft, nicht
  beim späteren Ändern der Auswahl.
  Im Dialog gilt die Auswahl sofort (optimistisch); die Änderungen gehen nacheinander als ganze Liste an den Server,
  ein Fehler setzt auf den Server-Stand zurück und erscheint im Dialog. Gecachte öffentliche Gruppen-Streams (60 s)
  und RSS-Feeds (600 s) folgen mit dieser Verzögerung. In „Konto → Freigaben“ nennt die Sichtbarkeit, in welchen
  Gruppen der Törn (öffentlich) erscheint.
- **Daten:** `share_groups (share_id, group_id, created_at)` (`0028_share_groups.sql`). Invariante: die Eigentümer:in
  ist Mitglied der Gruppe.
- **Bestand (Migration):** jeder Törn bekommt die Gruppen seines Boots, in denen die Eigentümer:in Mitglied ist – nicht
  mehr alle Gruppen der Segler:in. Auch nicht öffentliche Törns, damit ein späteres Veröffentlichen sie wie bisher in
  den Boots-Gruppen zeigt. Gruppen-Ziele bestehender Törn- und Foto-Aktivitäten werden darauf angeglichen. Anders als
  die Vorauswahl beim Anlegen übernimmt die Migration auch ausgeblendete und gesperrte Gruppen (Bestand bleibt
  erhalten, gelesen wird ohnehin nur Sichtbares).
- **Löschen:** Törn gelöscht oder abgelaufen, Gruppe gelöscht, Konto gelöscht (auch inaktiv entfernt) → Zeilen weg.
  **Austreten bzw. Entfernen** nimmt die eigenen Törns aus der Gruppe (Zeilen und Stream-Ziele) – ein Wiedereintritt
  stellt sie nicht wieder her. Konten zusammenführen: die Zeilen hängen am Törn und wandern mit, die Mitgliedschaft
  geht ans Ziel. Moderation: gesperrte Törns und Gruppen behalten ihre Zeilen (Sperre umkehrbar), beim endgültigen
  Löschen fallen sie mit.

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
| Verein/Team | Törns, die in der Gruppe gezeigt werden (11.12) |

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
mit dem Fahrtenbuch); Ausnahme M1 (Eckdaten nicht öffentlicher Törns im eigenen Nachweis) ist mit dem Fahrtenbuch nach Jahren umgesetzt (Konzept 27.3, F-456).

## 19. Fahrtenbuch – Törns ohne GPX-Datei

Ziel: Törns auch **ohne GPX** anlegen – mit Angaben wie in einem Fahrtenbuch –, ehrlich als „nicht aufgezeichnet“
gekennzeichnet, und dasselbe Fahrtenbuch-Feldset auch für GPX-Törns. Anforderungen F-300 … F-315 (F-2xx sind auf anderen Branches vergeben);
die endgültigen Texte stehen in `docs/REQUIREMENTS.md`.

**Umsetzungsstand (Branch `feature/fahrtenbuch`):** Phase 1 umgesetzt – Migration `0025_logbook.sql`, `src/domain/logbook.ts`,
`worker/logbook.ts`, `POST /api/shares/manual`, `PATCH /api/shares/:id` mit `log`/Häfen, Kontingent (L1), Aufbewahrung (L2),
Hafenposition (L3), Meilensteine (L4), nur angemeldet (L5), keine Medien (L6), Formular `sx-logbook-form` mit kleiner Karte für die
Hafenposition (`sx-place-picker`, F-353), Panel `sx-logbook-panel`, gestrichelte Linie, Abzeichen, „davon aufgezeichnet“, Stream-Bündel
`logbook`. Aus L8 umgesetzt: Obergrenze, `X-Share-Ended`, 60 Tage, 30 kn in Browser und Worker, Ausreißer aus der Distanz;
**offen** (Phase 3, F-315): Hinweis bei > 10 % Abweichung für Eigentümer und Moderation.

Abweichungen von der Skizze unten (gehen ihr vor):

| Punkt | Umsetzung |
|---|---|
| Rolle an Bord | nicht `log.role`, sondern `shares.owner_role` aus den Crew-Rollen (Konzept 15) – `POST /api/shares/manual { ownerRole }` |
| Uhrzeiten | `log.timed` merkt, ob Abfahrt (und Ankunft) eine Uhrzeit haben; ohne gilt 12 Uhr Ortszeit und die 120-sm-je-Tag-Regel |
| Hafen ohne Position | mindestens einer der beiden Häfen braucht eine Position (400 `harbor_position`); fremde Häfen ohne Position setzt nur die Anleger:in (403) |
| Stream-Ziel Starthafen | noch nicht: der Hafen-Stream zeigt Törns nur über öffentliche Boote (`harborKeep`); kommt mit „Törns ab/nach diesem Hafen“ (Phase 3) |
| Bündel `logbook` | Gegenstand ist das Konto, die Törns stehen in `data.ids` (höchstens 100) und werden beim Lesen geprüft; nachts fällt ein Bündel ohne vorhandene Törns |
| Wetter | kein Abruf für geschätzte Routen (Hinweis in „Bedingungen“) – `routeTrack` mit Zeiten und Wetter folgt in Phase 2 (F-314) |
| Medien-Sperre F-309 | schon in Phase 1 (statt Phase 2) |
| Distanz bei Änderung | Meilensteine werden beim PATCH der Strecke nicht neu geprüft (wie bei GPX-Törns) |
| Abgelehnter Eintrag | Häfen, die dabei neu angelegt bzw. positioniert wurden, bleiben (wie beim Boot-Formular) – sie sind gültige Häfen; zählen aufs Hafen-Tageslimit |
| Öffentlich schalten | ein privat angelegter Nachtrag kommt beim Öffentlich-Schalten ins Bündel, nie einzeln; ein Törn steht in höchstens einem Bündel |
| Listen | Profil-, Boots- und Hafenlisten liefern keine Fahrtenbuch-Angaben (`log`), nur Einzelansicht und eigene Liste |
| Ältere Oberflächen | ein gecachter alter Client zeigt `logbook`-Bündel als leeren Eintrag und Einträge ohne GPX nicht – übergangsweise hingenommen |

### 19.0 Entscheidungen des Betreibers (Oktober 2026)

Diese Entscheidungen gehen allen Vorschlägen unten vor; betroffene Stellen sind angepasst.

| # | Entscheidung | Folge |
|---|---|---|
| L1 | **Eigenes Kontingent: 100 Fahrtenbuch-Einträge pro Jahr** (offene Frage 1 erledigt). | Zählt je Saison der **Abfahrt** (`seasonOf(started_at)`), getrennt von den 3 kostenlosen Törns; gleich für kostenlos und Unterstützer (bestätigt). Gelöschte Einträge geben den Platz frei. Darüber 409 `quota` „100 Fahrtenbuch-Einträge für 2026 erreicht“. |
| L2 | **Manuelle Einträge bleiben 2 Jahre** (offene Frage 2 erledigt). | Gelöscht am 1. Februar nach der **zweiten** Saison ab Anlegen (angelegt 2026 → gelöscht 1.2.2028), bzw. nach der letzten unterstützten Saison, wenn die später endet. Eigene Regel `manualExpiry` neben `shareExpiry` und `EXPIRES_SQL` (Test vergleicht beide). Wird GPX nachgereicht, gilt ab dann die Törn-Regel (5.5) – die Oberfläche sagt das vorher, falls der Eintrag dadurch früher gelöscht würde. |
| L3 | **Hafenposition: wer den Hafen anlegt, setzt die Position; danach nur die Anleger:in** (offene Frage 4 erledigt). | Wer im Fahrtenbuch einen neuen Hafen anlegt, ist damit Anleger:in (`harbors.created_by`) und setzt die Position gleich mit (Klick auf die Karte). Ändern danach: Anleger:in und Moderation, wie heute F-171. Für migrierte Häfen ohne Position **und** ohne Anleger:in (Altbestand, `created_by = NULL`) gilt dieselbe Regel sinngemäß: wer als Erste:r die Position setzt, wird Anleger:in (bestätigt). |
| L4 | **Meilensteine zählen Fahrtenbuch-Meilen mit** (offene Frage 3 erledigt). | Wie K6: Meilensteine und Saison-Summen zählen beides, Kennzahlen nennen den Anteil „aufgezeichnet“. |
| L5 | **Nur angemeldet** (offene Frage 5 erledigt). | Ohne Konto gäbe es keinen Eigentümer, keine Zuordnung (Boot, Crew, Hafen) und keinen Löschpfad. Gäste sehen „Anmelden, um ins Fahrtenbuch einzutragen“ und kommen danach direkt ins Formular (wie F-31). |
| L6 | **Fahrtenbuch-Einträge bekommen keine Medien** und umgehen keine Upload-Grenzen. | Keine Fotos (`POST /api/shares/:id/photos` → 409 `no_media_manual`), kein gespeichertes Übersichtsbild (`PUT /api/shares/:id/image` → 409), Link-Vorschau ohne Bild. Die Payload (Route + Wetter) ist auf **32 KB** begrenzt und zählt zum Speicher wie jeder Törn. Fotos gibt es erst, wenn GPX nachgereicht wird – dann ist es ein normaler Törn mit allen Kontingenten (3 Törns, Fotos nur Unterstützer, 200 MB). Sonst könnte ein kostenloses Konto über 100 Einträge × 1,5 MB Übersichtsbild ≈ 150 MB belegen statt 40,5 MB. |
| L7 | **Rollen der Crew werden konfigurierbar – eigenes Konzept, noch nicht entschieden.** | Ideen des Betreibers: eine Stammcrew am Boot darf z. B. Beiträge für das Boot schreiben (also nicht jede:r), Gäste bei Charter brauchen ein eigenes Modell. Das Fahrtenbuch speichert vorerst nur die Rolle des Eigentümers (`log.role`); Crew-Rollen kommen später aus dem Crew-Konzept, ohne Umbau hier. |
| L8 | **GPX-Plausibilisierung wie in 19.5.1 und Ausreißer raus aus der Distanz.** | Obergrenze 2.000 sm je Törn, Endzeit als Header, Dauer ≤ 60 Tage, Distanz ≤ Dauer × 30 kn, gleiche Regel im Browser; `computeTrackStats` zählt Segmente zu Ausreißer-Punkten nicht mehr zur Distanz (Bestand bleibt, wie gespeichert); Hinweis bei > 10 % Abweichung für Eigentümer und Moderation. |

#### Kurzfassung der Empfehlungen

| # | Empfehlung | Warum |
|---|---|---|
| K1 | **Kein eigenes Objekt:** ein Fahrtenbuch-Eintrag ist ein Törn in `shares` mit `source = 'manual'`. | Sichtbarkeit, Schlüssel-Links, Kommentare, Fotos, Crew, Reaktionen, Stream, Meldungen, Galerien, Aufbewahrung und alle Löschpfade hängen an `share_id` – eine eigene Tabelle müsste jeden davon verdoppeln. |
| K2 | **Ein Feldset für beide:** Fahrtenbuch-Angaben (Häfen, Ankunft, Wind, Motorstunden, Segelführung, Liegeplatz, Notizen, Rolle) stehen in D1 an jedem Törn, egal ob GPX oder manuell. | Der GPX-Törn bekommt Motorstunden und Notizen, der manuelle Eintrag später den Track – ohne Umbau. |
| K3 | **Herkunft der Distanz** als eigene Spalte `dist_source` = `track` · `route` · `stated`; überall, wo Seemeilen summiert werden, zusätzlich „davon aufgezeichnet“. | Prinzip „Daten ehrlich zeigen“. Eine Zahl, eine Quelle. |
| K4 | **Strecke als synthetischer Track** im Browser (Start → Wegpunkte → Ziel, verdichtet, Zeiten linear zwischen Abfahrt und Ankunft) – gestrichelt gezeichnet, ohne Speed-Kennzahlen. | Karte, Wetter-Nachladen (`loadWeather`), Zeit-Diagramm und Hover lassen sich weiterverwenden; nur Speed-Werte werden unterdrückt. |
| K5 | **Eigenes Kontingent** für Fahrtenbuch-Einträge: **100 pro Jahr** (L1), sie zählen **nicht** zu den 3 kostenlosen Törns; GPX nachreichen macht daraus einen normalen Törn (zählt dann). | Ein Eintrag kostet ≈ 2–5 KB statt ≈ 300 KB; ein Fahrtenbuch mit 3 Einträgen pro Saison ist nutzlos. Bezahlt wird weiter für Tracks, Fotos, Privatsphäre. |
| K6 | **Keine Ranglisten** für geschätzte Meilen – es gibt heute ohnehin keine Ranglisten oder Rekorde. Meilensteine und Saison-Summen zählen beides, mit Kennzeichnung; Max-Speed, „längste Etappe“ o. Ä. künftig nur aus Tracks. | Das Fahrtenbuch ist der klassische Meilennachweis (SKS: Logbuchauszug); wer ohne Plotter segelt, darf nicht schlechter dastehen. Auch GPX-Distanzen meldet heute der Client (`X-Share-Distance`), der Server prüft sie nicht. |
| K7 | **Nachträge fluten den Stream nicht:** Einträge, deren Abfahrt länger als 14 Tage zurückliegt, kommen gebündelt („hat 6 Törns ins Fahrtenbuch nachgetragen“) statt einzeln. | Wer im November die Saison nachträgt, würde sonst Dutzende Neuigkeiten erzeugen. |

### 19.1 Was gehört in einen Fahrtenbuch-Eintrag?

Vorbild: Yacht-/Charter-Logbücher (Kopf: Datum, Schiff, Skipper, Crew, Von/Nach; stündliche Zeilen mit Kurs,
Logstand, Wind, Seegang, Barometer, Segelführung, Motor, Position; Tagesabschluss mit Distanz, Motorstunden,
Liegeplatz) und der **Meilennachweis** für SKS/SSS (Datum, Von/Nach, Seemeilen, Funktion an Bord, Fahrtgebiet,
Unterschrift des Skippers). Für Freizeitsegler auf Havel und Ostsee zählt der **Tagesabschluss**, nicht die
stündliche Zeile.

| Feld | Stufe | Begründung |
|---|---|---|
| Datum der Abfahrt | **Pflicht** | Saison, Sortierung, Meilensteine, Wetter |
| Starthafen (`sx-harbor-picker`) | **Pflicht** | Ort auf der Karte, Hafenseite, Stream-Ziel |
| Zielhafen | **Pflicht**, Vorgabe = Starthafen („zurück in den Heimathafen“) | Tagestörns enden meist dort, wo sie begannen |
| Strecke (sm) | **Pflicht**, vorbefüllt aus Wegpunkten | Kern des Meilennachweises |
| Boot | empfohlen | Bootskennzahlen; wie heute (`checkBoat`) |
| Abfahrt/Ankunft Uhrzeit, Ankunftsdatum | empfohlen | Dauer, Ø-Fahrt, Wetter nachladen; mehrtägige Törns |
| Rolle an Bord (Skipper, Co-Skipper/Wachführer, Crew) | empfohlen | Meilennachweis unterscheidet die Funktion |
| Crew | wie heute (`share_crew`, Einladung) | nichts Neues |
| Wind: Stärke (Bft 0–12) und Richtung (8 Striche) | optional, **oder** aus Wetterdaten | Segler notieren Bft, nicht kn; Modellwerte gibt es zusätzlich, beide mit Quelle |
| Seegang (glatt · leicht · mäßig · grob) | optional | eine Auswahl reicht, keine Meter |
| Motorstunden (0,1 h) | optional | in Charter-Logbüchern Standard, für Eigner nützlich (Wartung) |
| Segelführung/Reffs | optional, Kurztext ≤ 120 Zeichen | z. B. „Groß 1. Reff, Fock“ – eine Auswahlliste wäre je Bootstyp anders |
| Liegeplatz | optional, Kurztext ≤ 120 Zeichen | mit Hinweis „öffentlich sichtbar“ (Steg/Box verrät, wo das Boot liegt) |
| Notizen | optional, ≤ 2000 Zeichen | ersetzt die Bemerkungsspalte |
| Fotos | **keine** (L6) | erst nach GPX nachreichen |

**Bewusst weggelassen (überladen):** stündliche Einträge, Kurse (rwK/KdW), Logstand, Barometer, Positionen je Stunde,
Diesel/Wasser/Hafengeld, Wachplan, Unterschrift. Wer so genau protokolliert, hat in der Regel einen Plotter und lädt
GPX hoch. Eine digitale Unterschrift des Skippers wäre ein eigenes Thema (L7).

### 19.2 Darstellung ohne Track

#### 19.2.1 Karte

| Fall | Darstellung |
|---|---|
| Start ≠ Ziel, ohne Wegpunkte | Hafen-Marker Start/Ziel, **gestrichelte** Linie in der Trackfarbe, Beschriftung „Strecke nicht aufgezeichnet“ |
| mit Wegpunkten (von Hand gesetzt, höchstens 50) | gestrichelte Linie Start → Wegpunkte → Ziel, Wegpunkte als kleine Ringe |
| Rundtörn (Start = Ziel) ohne Wegpunkte | nur der Hafen-Marker mit Etikett „Rundtörn · 14 sm (Angabe)“, Karte zoomt auf den Hafen; Hinweis „Wegpunkte setzen, um die Route zu zeigen“ (für den Eigentümer) |
| Hafen ohne Position | Formular verlangt einen Klick auf die Karte („Wo liegt der Hafen?“). Neuer Hafen: die Anleger:in setzt die Position beim Anlegen; danach ändert sie nur die Anleger:in bzw. die Moderation (L3) |

Wegpunkte setzen: Modus wie „Ort setzen“ bei Fotos (F-102): Klick fügt hinzu, Ziehen verschiebt, Klick auf einen
Punkt entfernt, Esc beendet; die Distanz der Linie wird live angezeigt und füllt „Strecke“, solange man sie nicht
selbst überschrieben hat.

Gestrichelt statt neuer Farbe: Prinzip „Eine Farbe = eine Bedeutung“ – die Farbe sagt weiter „dieser Törn“, die
Strichelung sagt „geschätzt“. Einfärbung nach Speed ist für manuelle Einträge deaktiviert (F-11-Mechanik „Metrik ohne
Daten“), nach Wind/Böen/Wellen nur, wenn Wetter geladen ist.

#### 19.2.2 Technisch: synthetischer Track (rein, `src/domain/logbook.ts`)

`routeTrack(route, departAt, arriveAt)` erzeugt einen `Track` mit Punkten alle ≈ 0,25 sm entlang der Linie und linear
verteilten Zeiten, markiert mit `estimated: true` (neues Feld an `Track`). Damit funktionieren unverändert:
`map.fit`, Zeichnen (mit Strichelung), `loadWeather` + `attachConditions` (Wetter zur Route), Zeit-Diagramm für Wind
und Wellen, Hover-Verknüpfung. Unterdrückt wird alles, was echte Zeitstempel voraussetzt: `computeTrackStats` liefert
für `estimated` keine Speeds, `kpis()` zeigt statt „Max. Fahrt“ nichts und statt „Ø Fahrt“ „≈ 4,1 kn (geschätzt)“ aus
Strecke/Dauer. Ohne Uhrzeiten gibt es keine Zeiten an den Punkten – dann auch kein Modellwetter (wie F-05).

#### 19.2.3 Kennzeichnung überall

| Stelle | Anzeige |
|---|---|
| Törn-Ansicht, Kopf | Abzeichen „Fahrtenbuch“ (Icon Buch), Tooltip „Ohne GPS-Aufzeichnung – Strecke vom Segler angegeben“ |
| Kennzahl Distanz | „14,0 sm“ + Unterzeile „Angabe“ bzw. „aus Wegpunkten“ |
| Wind | „4 Bft W (Fahrtenbuch)“ und – falls geladen – „Modell: Ø 11 kn“; beide Quellen genannt |
| Listen (Meine Törns, Profil, Boot, Hafen, Entdecken, Galerie-Kacheln) | dasselbe Abzeichen; Kachelbild = schematische Linie statt Track |
| Stream (`voyage`) | „Lisa hat einen Törn ins Fahrtenbuch eingetragen: Potsdam → Werder, 14 sm“ |
| Profil, Boot, Verein, Hafen – Kennzahlen | „1.234 sm · davon 1.020 sm aufgezeichnet“ (nur wenn es Einträge gibt) |
| Meilenstein | zählt beides (K6); Text bleibt „500 sm in der Saison 2026“ |
| Übersichtsbild (F-47) | nur zum Herunterladen/Teilen im Browser (gestrichelte Linie, Zusatz „Fahrtenbuch“), **nicht gespeichert**, keine og:image (L6) |

### 19.3 Datenmodell

#### 19.3.1 Entscheidung: gleiche Tabelle

| Option | Vorteil | Nachteil | Urteil |
|---|---|---|---|
| **A: `shares` + `source`** | alle Funktionen und Löschpfade erben; ein Törn kann von manuell zu GPX wechseln, ohne ID, Link, Kommentare, Fotos, Reaktionen zu verlieren | jede Kennzahlen-Abfrage muss `dist_source` kennen (nur dort, wo summiert wird) | **empfohlen** |
| B: eigene Tabelle `log_entries` | sauber getrennt | Sichtbarkeit, Schlüssel, Kommentare, Fotos, Crew, Reaktionen, Meldungen, Stream, Galerien, Cron, `purgeUser` alle doppelt; „GPX nachreichen“ = Umzug zwischen Tabellen | nein |

#### 19.3.2 Migration (Vorschlag `0025_logbook.sql`)

```sql
-- Herkunft des Törns und der Distanz (Werte prüft worker/validate.ts, kein CHECK – Prinzip Architektur 7).
ALTER TABLE shares ADD COLUMN source TEXT NOT NULL DEFAULT 'gpx';           -- gpx | manual
ALTER TABLE shares ADD COLUMN dist_source TEXT NOT NULL DEFAULT 'track';    -- track | route | stated
ALTER TABLE shares ADD COLUMN ended_at INTEGER;                             -- Ankunft (UTC ms), auch aus GPX
ALTER TABLE shares ADD COLUMN from_harbor_id TEXT REFERENCES harbors(id) ON DELETE SET NULL;
ALTER TABLE shares ADD COLUMN to_harbor_id   TEXT REFERENCES harbors(id) ON DELETE SET NULL;
-- Fahrtenbuch-Angaben für GPX- und manuelle Törns, kleines JSON (≤ 4 KB), Schema in src/domain/logbook.ts.
ALTER TABLE shares ADD COLUMN log TEXT NOT NULL DEFAULT '{}';
CREATE INDEX shares_from_harbor ON shares(from_harbor_id, started_at DESC) WHERE from_harbor_id IS NOT NULL;
CREATE INDEX shares_to_harbor   ON shares(to_harbor_id,   started_at DESC) WHERE to_harbor_id IS NOT NULL;
CREATE INDEX shares_user_source ON shares(user_id, source);                -- Kontingent je Art
```

`log` (validiert in `worker/validate.ts` über eine reine Funktion `parseLog` in `src/domain/logbook.ts`):

```ts
interface Logbook {
  role?: 'skipper' | 'co' | 'crew';
  engineH?: number;                 // 0–500, 0,1 h
  wind?: { bft: number; dir: 'N' | 'NO' | 'O' | 'SO' | 'S' | 'SW' | 'W' | 'NW' | null };
  sea?: 'calm' | 'slight' | 'moderate' | 'rough';
  sails?: string;                   // ≤ 120
  berth?: string;                   // ≤ 120
  notes?: string;                   // ≤ 2000, bereinigt wie Kommentare (cleanComment), kein HTML
}
```

**Geometrie und Wetter in R2**, im bestehenden Format: `shares/<id>` = gzip
`{"v":1,"tracks":[],"route":[[lat,lon],…],"weather":{…}}`. `PAYLOAD_PREFIX` bleibt gültig, `getShareData`,
`removeShare`, Speicherzähler und Cron bleiben unverändert; `size_bytes` ist die (kleine) Payload-Größe.
`validatePayload` im Client muss `tracks: []` mit `route` akzeptieren. Alternativ ginge die Route als JSON in D1 – dann
bräuchte das Wetter trotzdem R2; ein Ort für Geometrie ist einfacher.

#### 19.3.3 Auswirkungen

| Bereich | Wirkung |
|---|---|
| Kontingent | neues Feld `logEntriesPerSeason = 100` in `limitsFor`, gleich für beide Stufen (L1); `supportStatus` zählt `source = 'manual'` der laufenden Saison (nach `started_at`) getrennt; `sharesUsed` zählt nur `gpx`. Speicher zählt wie immer `size_bytes` (+ Fotos). Notbremse gilt (sie bremst neue Einträge mit) |
| Speicher | ≈ 0,5 KB D1-Zeile + 1–5 KB R2 (mit Wetter); 10.000 Einträge ≈ 50 MB – kein Engpass |
| Aufbewahrung (L2) | **2 Jahre**: 1. Februar nach der zweiten Saison ab Anlegen bzw. nach der letzten unterstützten Saison, wenn später. `EXPIRES_SQL` bekommt einen Zweig `CASE WHEN s.source = 'manual'` (+ 1 Jahr auf das Saisonende), `shareExpiry` ein Argument `source`; Erinnerungsmail 14 Tage vorher wie F-66, dazu der Export-Hinweis (Phase 3). Fotos an manuellen Einträgen leben ebenso lange (zählen weiter zum Speicher) |
| Sichtbarkeit | unverändert (E1: kostenlos öffentlich; F-80 ff.). Liegeplatz und Notizen folgen dem Törn |
| Kommentare, Reaktionen, Meldungen | unverändert – hängen an `share_id` |
| Crew | Einladen wie heute; die eigene Rolle steht in `log.role`, Rollen der Crew kommen aus dem eigenen Crew-Konzept (L7) |
| Fotos, Übersichtsbild | keine (L6); Payload ≤ 32 KB, zählt zum Speicher |
| Stream | `recordVoyage` wie bisher bei öffentlichen Einträgen, Ziel zusätzlich `harbor` = Starthafen (heute nur Hafen des Boots). Nachträge (Abfahrt > 14 Tage zurück) → gebündelte Aktivität `logbook` je Konto und Tag (`bucket = logbook:<user>:<tag>`, Muster `recordPhotos`); Meilensteine nur für die laufende Saison (wie heute) |
| Kennzahlen | Abfragen in `boats.ts`, `discover.ts`, `groups.ts`, `harbors.ts`, `activity.ts` bekommen zusätzlich `SUM(CASE WHEN dist_source = 'track' THEN dist_nm END) AS dist_rec` |
| Hafenseite | neu möglich: „Törns ab/nach diesem Hafen“ (öffentlich, über die neuen Indizes) – Phase 3 |
| Löschkonzept | **keine neuen Löschpfade**: Zeile, R2-Payload, Fotos, Kommentare, Crew, Reaktionen, Aktivitäten gehen über `removeShare` (Einzeln, Ablauf, Konto, inaktiv, Moderation). Hafen gelöscht → `ON DELETE SET NULL`. Das Bündel `logbook` fällt mit den Aktivitäten des Kontos bzw. nach 12 Monaten; enthält es nur gelöschte Törns, wird es beim Lesen verworfen (Prüfung wie `photos`-Bündel) |

#### 19.3.4 Keine Medien (L6)

Fahrtenbuch-Einträge haben weder Fotos noch ein gespeichertes Übersichtsbild. Der Worker prüft `source` vor allen
anderen Prüfungen beim Foto-Upload und beim Übersichtsbild (409). Wird GPX nachgereicht (19.4), gelten ab dann
die normalen Regeln. Damit gibt es keinen Weg, über Fahrtenbuch-Einträge mehr Speicher oder Fotos zu bekommen als
über Törns.

### 19.4 Nachträglich GPX und Fahrtenbuch für GPX-Törns

| Richtung | Ablauf |
|---|---|
| Manuell → aufgezeichnet | „GPX hinzufügen“ in der Törn-Ansicht (Eigentümer). `PUT /api/shares/:id/data` mit GPX-Payload wie `createShare`: Prüfung Törn-Kontingent (der Eintrag wird ein normaler Törn → kostenlos ggf. 402), Speicher, Notbremse. Danach `source = 'gpx'`, `dist_source = 'track'`, `dist_nm`/`started_at`/`ended_at` aus dem Track; Häfen, `log`, Kommentare, Crew, Reaktionen, Link bleiben; ab jetzt sind Fotos und Übersichtsbild möglich. Keine neue `voyage`-Aktivität; Meilensteine werden mit der Differenz geprüft. Liegen Start/Ende des Tracks > 2 km von den Häfen, fragt die Oberfläche, ob die Häfen angepasst werden sollen |
| GPX → Fahrtenbuch-Angaben | Panel „Fahrtenbuch“ in jeder eigenen Törn-Ansicht: dieselben Felder (`log`, Häfen). Häfen werden aus Start/Ende des Tracks vorgeschlagen (nächster Hafen mit Position ≤ 1 km). Datum, Uhrzeit und Strecke kommen aus dem Track und sind dort nicht editierbar |
| Aufgezeichnet → manuell | nicht vorgesehen (Track löschen = Törn löschen); vermeidet „Track weg, Meilen behalten“ |

### 19.5 Missbrauch und Fairness

| Risiko | Gegenmaßnahme |
|---|---|
| erfundene Seemeilen | Plausibilität im Server (`plausibleDistance` in `logbook.ts`, getestet): Angabe ≥ Länge der Route; mit Uhrzeiten ≤ Dauer × 15 kn; ohne Uhrzeiten ≤ 120 sm je Kalendertag; absolute Grenze 2.000 sm je Eintrag; mehrtägig höchstens 30 Tage. Sonst 400 `implausible_distance` mit deutscher Meldung |
| Nachtragen in Massen | Kontingent 100 je Saison der Abfahrt (L1), 20 neue Einträge pro Konto und Tag (429 `log_quota`), Abfahrt nicht älter als 5 Jahre und nicht in der Zukunft (+ 1 Tag) |
| Stream-Spam | Bündelung der Nachträge (K7) |
| Ranglisten | gibt es nicht; falls sie kommen, nur `dist_source = 'track'`. Max-Speed, Ø-Fahrt-Rekorde, „längste Etappe“ immer nur aus Tracks |
| Meilensteine/Saison-Summen | zählen beides, Kennzahlen nennen den Anteil „aufgezeichnet“ (K3, K6). entschieden (L4) |
| ehrlich bleiben bei GPX | siehe 19.5.1 |
| Inhalte | Notizen, Liegeplatz, Segelführung wie Kommentare bereinigt; der Törn bleibt als Ganzes meldbar (F-114) |

#### 19.5.1 GPX-Plausibilisierung

**Heute:** Der Worker parst GPX nicht (CPU-Limit 10 ms, Prinzip „Billig im Betrieb“). Distanz, Startzeit und
Track-Anzahl schickt der Browser als Header (`X-Share-Distance`, `X-Share-Started`, `X-Share-Tracks`); der Server
begrenzt nur auf 0–100.000 sm bzw. „Start nicht in der Zukunft“. Wer die API direkt aufruft, kann also eine kleine
GPX-Datei mit „5.000 sm“ hochladen – und die zählt in Profil-, Boots-, Vereins- und Hafensummen und löst Meilensteine
aus. Die Törn-Ansicht selbst ist ehrlich: Sie rechnet die Distanz im Browser aus der Datei neu.

**Vorschlag (billig, ohne Parsen im Worker):**

| Prüfung | Regel | Fehler |
|---|---|---|
| Obergrenze je Törn | `dist_nm` ≤ 2.000 sm (statt 100.000) | 400 `implausible_distance` |
| Dauer | neuer Header `X-Share-Ended`; Ende ≥ Start, Dauer ≤ 60 Tage | 400 |
| Geschwindigkeit | mit Start und Ende: `dist_nm` ≤ Dauer × 30 kn (großzügig, auch für Motor und schnelle Boote); ohne Zeitstempel (F-05) nur die Obergrenze | 400 `implausible_distance` |
| Gleiche Regel im Browser | `plausibleDistance` aus `src/domain/logbook.ts` läuft vor dem Hochladen; die Oberfläche erklärt, statt dass der Server überrascht | – |
| Ausreißer | `computeTrackStats` summiert die Distanz heute **inklusive** der als Ausreißer markierten Sprünge (nur Speed und Max-Speed lassen sie weg, F-04). Ein einziger GPS-Sprung kann die Strecke stark aufblähen. Entschieden (L8): Segmente zu Ausreißer-Punkten aus `distNm` herausnehmen; F-04 wird entsprechend ergänzt | – |
| Abweichung sichtbar machen | die Törn-Ansicht vergleicht die gespeicherte Distanz mit der aus der Datei; weicht sie > 10 % ab, sehen Eigentümer und Moderation einen Hinweis, Admins in der Meldungs-Ansicht ebenfalls | – |

**Nicht möglich im Free Tier:** echte Nachprüfung im Worker oder im Cron (beide haben 10 ms CPU; eine 12-MB-Datei zu
parsen dauert deutlich länger). Gegen gezielte Manipulation bleiben Melden (F-114) und die Moderation. Da es keine
Ranglisten gibt, ist der Schaden auf eigene Summen und Meilensteine begrenzt.

Neue Anforderung: **F-311** Plausibilität für GPX-Törns wie oben (Obergrenze, Dauer, 30 kn), gleiche Regel in Browser
und Worker, Test je Grenze.

### 19.6 API-Skizze

Alle Mutationen same-origin, fremde/unsichtbare Törns 404 – wie bisher.

| Methode | Pfad | Wer | Zweck |
|---|---|---|---|
| POST | `/api/shares/manual` | angemeldet, nicht gesperrt | JSON `{ title?, startedAt, endedAt?, fromHarbor, toHarbor, distNm?, route?, boatId?, visibility, log, weather? }`; `fromHarbor`/`toHarbor` = `{ harborId }` oder `{ name, lat?, lon? }` (wie `sx-harbor-picker`). Server prüft Kontingent `logEntries`, Notbremse, Sichtbarkeit (E1), Plausibilität, baut die gzip-Payload, schreibt R2 + D1 in einem Ablauf wie `createShare` (Aufräumen bei D1-Fehler). Titel-Vorschlag „Potsdam → Werder“ bzw. „Rundtörn ab Potsdam“. 201 |
| PATCH | `/api/shares/:id` | Eigentümer | zusätzlich `log`, `fromHarbor`, `toHarbor`; nur bei `manual` auch `startedAt`, `endedAt`, `distNm`, `route`, `weather` (schreibt Payload neu, Speicherzähler per Differenz) |
| PUT | `/api/shares/:id/data` | Eigentümer | GPX nachreichen (19.4); nur für `source = 'manual'`, sonst 409 |
| GET | `/api/shares/:id`, `/data` | wie heute | `shareShape` zusätzlich `source`, `distSource`, `endedAt`, `from`/`to` (`{ slug, name, lat, lon }`, ausgeblendete Häfen null), `log` |
| GET | `/api/me/support` | selbst | zusätzlich `logEntriesUsed` (laufende Saison), `logEntriesMax` (100) |
| POST/PATCH | `/api/harbors`, `/api/harbors/:id` | angemeldet | `POST` nimmt `lat`/`lon` mit (Anleger:in setzt die Position beim Anlegen); `PATCH` Position wie F-171, zusätzlich: Hafen ohne Position und ohne Anleger:in → wer sie setzt, wird Anleger:in (L3) |
| GET | `/api/me/logbook.csv` | selbst | Meilennachweis: Datum, Von, Nach, sm, Quelle, Rolle, Boot, Dauer – umgesetzt in Konzept 27 (F-457) |
| GET | `/api/harbors/:id/voyages` | alle | öffentliche Törns ab/nach dem Hafen – Phase 3 |

### 19.7 Oberfläche (Skizze)

**Einstieg** (`sx-empty-state`, Kopfzeile, FAB): „Track anlegen“ öffnet eine kleine Auswahl
„GPX-Datei laden“ · „Ohne GPX eintragen (Fahrtenbuch)“. Die Einstiegskarte bekommt unter „GPX-Datei wählen“ den Link
„Kein Track? Ins Fahrtenbuch eintragen“. Gäste: Anmeldedialog, danach geht es weiter (wie F-31) – ohne Server gibt es
nichts zu analysieren, und ohne Konto keinen Eigentümer und keinen Löschpfad (L5).

**Formular** `sx-logbook-form` (Seitenleiste über der Karte, mobil Bottom-Sheet; Karte bleibt sichtbar):

```
┌ Törn eintragen ─────────────────────────────┐
│ Datum      [So, 12.10.2026]  Uhrzeit [10:30]│
│ Von        [Potsdam – Yachthafen ▾]         │
│ Nach       [Werder ▾]   ☐ zurück nach Von   │
│ Strecke    [14,2] sm  · aus Wegpunkten  ✎   │
│            [Wegpunkte auf der Karte setzen] │
│ Boot       [Möwe ▾]                         │
│ ▸ Mehr Angaben                              │
│   Ankunft [12.10.] [16:00] · Rolle [Skipper]│
│   Wind [4] Bft aus [W ▾] [Aus Wetterdaten]  │
│   Seegang [leicht ▾] · Motor [0,5] h        │
│   Segelführung [Groß 1. Reff, Fock]         │
│   Liegeplatz [Steg B, Box 12] ⓘ öffentlich  │
│   Notizen [...]                             │
│ Titel [Potsdam → Werder]                    │
│ Sichtbarkeit (sx-visibility-picker)         │
│ 4 von 100 Einträgen 2026 ·      [Speichern]│
└─────────────────────────────────────────────┘
```

„Aus Wetterdaten“ lädt über den synthetischen Track (19.2.2) und setzt Bft/Richtung als Vorschlag; gespeichert wird
beides mit Quelle. Nach dem Speichern öffnet sich die normale Törn-Ansicht (`/s/<id>`).

**Törn-Ansicht:** Panel „Fahrtenbuch“ (für alle Törns, nur befüllte Felder; Eigentümer „Bearbeiten“), Abzeichen
„Fahrtenbuch“, Kennzahlen nach 19.2.3, für manuelle Einträge des Eigentümers „GPX hinzufügen“.

**Konto:** „x von y Fahrtenbuch-Einträgen“ neben „x von 3 Törns“; „Meine Törns“ mit Filter „Fahrtenbuch“ und
(Phase 3) „Meilennachweis exportieren“.

Neue/angepasste Teile: `src/domain/logbook.ts` (Schema, `parseLog`, `routeTrack`, `plausibleDistance`,
Titel-Vorschlag – rein, getestet), `sx-logbook-form`, `sx-logbook-panel`, `src/map/route-layer.ts` (Wegpunkte setzen,
Strichelung), `sx-kpis`/`summary.ts` (geschätzt), Abzeichen in `sx-stream`, `sx-discover`, `sx-profile-page`,
`sx-account-dialog`, `worker/shares.ts` (+ `worker/logbook.ts` für Anlegen/Nachreichen), `worker/validate.ts`,
`worker/supporter.ts`, `worker/activity.ts`, Kennzahlen-Abfragen.

### 19.8 Anforderungen (Entwurf – gültig ist `docs/REQUIREMENTS.md`)

- **F-300** Fahrtenbuch-Eintrag ohne GPX anlegen (Pflicht: Datum, Start- und Zielhafen, Strecke), angemeldet; Törn mit `source = 'manual'`.
- **F-301** Fahrtenbuch-Felder (Rolle, Motorstunden, Wind Bft/Richtung, Seegang, Segelführung, Liegeplatz, Notizen, Ankunft) für GPX- und manuelle Törns; Validierung und Grenzen wie in 19.3.2.
- **F-302** Darstellung: gestrichelte Linie bzw. Hafen-Marker, Wegpunkte von Hand (≤ 50), keine Speed-Kennzahlen, Abzeichen „Fahrtenbuch“ in allen Listen.
- **F-303** Distanz-Herkunft `track`/`route`/`stated`; Kennzahlen von Profil, Boot, Gruppe, Hafen nennen „davon aufgezeichnet“.
- **F-304** Plausibilitätsgrenzen für Distanz und Datum (19.5), 400 `implausible_distance`; 20 Einträge pro Tag.
- **F-305** Kontingent: 100 Fahrtenbuch-Einträge je Saison der Abfahrt, für alle Stufen, getrennt von `shares` (409 `quota`); `GET /api/me/support` liefert es.
- **F-306** Aufbewahrung manueller Einträge: 1. Februar nach der zweiten Saison ab Anlegen bzw. nach der letzten unterstützten Saison; nach GPX-Nachreichen gilt F-65.
- **F-307** Hafenposition: Anleger:in setzt sie beim Anlegen; Ändern Anleger:in und Moderation; Altbestand ohne Anleger:in und ohne Position – wer sie zuerst setzt, wird Anleger:in.
- **F-308** Nachträge älter als 14 Tage erscheinen gebündelt im Stream; Meilensteine wie F-166.
- **F-313** GPX nachreichen: Eintrag wird aufgezeichneter Törn, ID, Link, Kommentare, Crew, Reaktionen bleiben; Kontingent wie neuer Törn, danach Fotos möglich.
- **F-309** Keine Medien an Fahrtenbuch-Einträgen: Foto-Upload und Übersichtsbild → 409; Payload ≤ 32 KB; nach GPX-Nachreichen normale Regeln.
- **F-314** Wetter für manuelle Einträge über die geschätzte Route, mit Quellenangabe neben den eigenen Angaben.
- **F-310** Löschen: keine neuen Pfade; Test, dass Ablauf, Konto löschen und Moderation manuelle Einträge samt Payload, Zähleranteil und Bündel entfernen.

### 19.9 Offene Fragen an den Betreiber

Entschieden: Kontingent (L1), Aufbewahrung (L2), Hafenposition (L3), Meilensteine (L4), Gäste (L5), Medien (L6), GPX-Plausibilität (L8); die Annahmen in L1 (100 je Abfahrtsjahr, für alle) und L3 (Altbestand-Häfen) sind bestätigt.
Crew-Rollen bekommen ein eigenes Konzept (L7).

Keine offenen Fragen mehr.

### 19.10 Aufwand (grob)

| Phase | Inhalt | Aufwand |
|---|---|---|
| **1 – Kern** | Migration 0025, `logbook.ts` (Schema, Plausibilität, Titel), `POST /api/shares/manual`, `PATCH` mit `log`/Häfen, `shareShape`, Kontingent `logEntries`, Formular ohne Wegpunkte (Start/Ziel, Strecke manuell, Häfen mit Position setzen), gestrichelte Linie/Hafen-Marker, Abzeichen, Kennzahlen „davon aufgezeichnet“, Stream-Bündelung, Aufbewahrung 2 Jahre (`manualExpiry`/`EXPIRES_SQL`), Hafenposition beim Anlegen, Tests F-300–F-312, Doku | 4–5 Tage |
| **2 – Karte und Wetter** | Wegpunkte setzen (`route-layer`), `routeTrack` + Wetter nachladen, Wind-Vorschlag, Zeit-Diagramm ohne Speed, Fahrtenbuch-Panel für GPX-Törns mit Hafen-Vorschlag, Medien-Sperre F-309 | 3 Tage |
| **3 – Abrunden** | GPX nachreichen (F-313), Meilennachweis-CSV, Hafenseite „Törns ab hier“, Übersichtsbild zum Herunterladen für manuelle Einträge, GPX-Plausibilität F-311 | 2–3 Tage |

Vor jedem Merge: Review-Agent nach `CLAUDE.md` (insbesondere Prüfpunkt 6, Löschkonzept), `npm run check` grün.

## 20. Verifizierte Vertretung von Vereinen und Häfen

*Umgesetzt (Oktober 2026, Branch `feature/verifizierung`): `migrations/0026_verification.sql`, `src/domain/claims.ts`,
`worker/claims.ts`, `worker/claim-cleanup.ts`, `src/controllers/claims.ts`, `sx-claim`, `sx-verified-badge`,
`sx-admin-claims`; Anforderungen F-360 … F-372. Fragen in 20.9 am 28.10.2026 entschieden.*

Anlass (Betreiber): *„Eigentümerschaft von Vereinen oder Häfen müssen wir nebst Anlage noch eine Verifiziert
einbauen, die dem Anleger wieder sein Recht nehmen kann, wenn ein echter Besitzer auftaucht.“*

Heute gehört ein Verein dem Konto, das ihn anlegt (`groups.owner_id`, 11.1, 14.1), ein Hafen dem Konto, das ihn
anlegt (`harbors.created_by`, 12.2; mit dem Fahrtenbuch auch dem, das bei Altbestand zuerst die Position setzt, L3).
Wer zuerst kommt, verwaltet – auch ohne Bezug zum Verein oder Hafen. Die Moderation kann den Eigner schon heute neu
zuweisen (18.6), aber es gibt keinen Weg, das zu **beantragen**, kein sichtbares Zeichen „echt“ und keinen Schutz
davor, dass die verdrängte Person die Verwaltung über die Nachfolge-Regeln zurückbekommt.

### 20.1 Begriffe und Umfang

| Begriff | Bedeutung |
|---|---|
| **Vertretung** | das Konto, das für den echten Verein bzw. Hafen spricht (Vorstand, Hafenmeister:in, Betreiber:in) |
| **Antrag** | „Ich vertrete diesen Verein / Hafen“ – geprüft von den Plattform-Admins (`ADMIN_USER_IDS`) |
| **verifiziert** | ein Admin hat die Vertretung bestätigt; Abzeichen am Verein bzw. Hafen |
| **verdrängt** | wer beim Annehmen eines Antrags Eigner bzw. Anleger:in war und es danach nicht mehr ist |

Nur **Vereine** (`groups.kind = 'club'`) und **Häfen**. Teams sind private Zusammenschlüsse ohne öffentliche
Identität – dort gibt es nichts zu verifizieren (20.9 Frage 4). Boote und Profile ebenso nicht.

### 20.2 Antrag

Auf der Vereins- und der Hafenseite steht für angemeldete, aktive Konten (nicht suspendiert, nicht gesperrt)
„Ich vertrete diesen Verein“ bzw. „… diesen Hafen“ – auch für den heutigen Eigner (dann wird ohne Übertragung nur
verifiziert). Der Dialog fragt:

| Feld | Pflicht | Grenze | Zweck |
|---|---|---|---|
| Funktion | ja | 3–80 Zeichen | „1. Vorsitzende“, „Hafenmeister“ |
| Begründung | ja | 20–1000 Zeichen | warum, was stimmt heute nicht |
| Kontakt für Rückfragen | ja | 5–200 Zeichen | Telefon oder Mail-Adresse **des Vereins/Hafens** |
| Beleg-Link | nein | `https://`-Adresse, ≤ 300 Zeichen | Impressum der Vereinsseite, Vereinsregister, Hafen-Website |

**Keine Uploads.** Ausweis- oder Vollmachtskopien wären besonders schutzbedürftig, bräuchten R2-Speicher, Fristen
und Zugriffsschutz – und beweisen wenig. Stattdessen prüft die Moderation über einen **unabhängigen öffentlichen
Kanal**: Sie ruft die Nummer bzw. schreibt die Adresse aus dem Impressum oder dem Vereinsregister an (nicht die im
Antrag genannte) und fragt nach. Der Dialog sagt das so und bittet, keine Ausweiskopien zu schicken. Eine Bestätigung
per Mail bleibt im Postfach der Moderation – nicht in Luv & Leute.

Antragstellende sehen den Stand auf der Seite („Antrag in Prüfung seit …“, „abgelehnt am … – Begründung“) und können
einen offenen Antrag zurückziehen (Status `withdrawn`, Angaben sofort geleert; das Gerüst zählt bis zur Wartefrist zur
Grenze aus 20.7).

### 20.3 Prüfung durch die Moderation

Der Admin-Bereich (18) bekommt einen Reiter **„Anträge“**: offene zuerst, älteste oben; je Antrag Objekt (Link),
heutiger Eigner bzw. Anleger:in (Kontoalter, Verifizierungsstand), Antragsteller:in (Kontoalter, Profil-Link),
Funktion, Begründung, Kontakt, Beleg-Link, Alter, weitere offene Anträge zum selben Objekt. Neue Anträge erscheinen
den Admins in der **Glocke** (Art `claim`, nicht abschaltbar, je Antrag; gelesen mit dem Öffnen des Reiters).

Entscheidung (`POST /api/admin/claims/:id { decision, note, previous }`):

| Entscheidung | Wirkung |
|---|---|
| **annehmen** | in **einem** D1-Batch: `verified_at = jetzt`; Antragsteller:in wird Eigner (Verein: wie 18.6, wird Mitglied falls nötig) bzw. Anleger:in (Hafen); weitere offene Anträge zum Objekt werden abgelehnt („ein anderer Antrag wurde angenommen“); Protokoll `claim_accept` |
| ↳ gleichzeitig | Der Batch nimmt nur an, wenn der Antrag noch offen ist und Eigner bzw. Anleger:in noch dieselbe wie gelesen; sonst rollt eine Zusicherung den ganzen Batch zurück (409) – zwei Admins übertragen nie doppelt. Die Sichtbarkeit des Vereins zählt beim Entscheiden nicht (der Eigner kann die Annahme nicht durch „geschlossen“ blockieren) |
| ↳ bisherige Person (`previous`) | Verein: **`admin`** (bleibt Admin, Standard) · **`member`** (nur noch Mitglied) · **`remove`** (verlässt die Gruppe). Hafen: verliert das Bearbeitungsrecht immer (Häfen haben keine Admins). War sie selbst die Antragsteller:in, entfällt das |
| **ablehnen** | Begründung Pflicht (10–500 Zeichen), geht an die Antragsteller:in; Protokoll `claim_reject` |

### 20.4 Abzeichen „verifiziert“

`groups.verified_at`, `harbors.verified_at` (Zeitpunkt, sonst NULL). Ein Haken-Abzeichen „Verifiziert“ mit Hinweis
„Von Luv & Leute bestätigt: wird vom Verein selbst verwaltet“ (bzw. „vom Hafen“) erscheint im Kopf der Vereins- und
der Hafenseite, auf `/entdecken`-Karten und im Hafen-Picker. Die API liefert nur `verified: boolean` – wer
vertritt, Funktion und Kontakt bleiben intern.

### 20.5 Rechte nach der Verifizierung, Sperre gegen Rückübernahme

Die Verwaltung eines verifizierten Objekts wechselt nur noch über die Moderation:

| Weg | Regel |
|---|---|
| Nachfolge beim Konto-Löschen (13.4) | Die Gruppe geht wie bisher an den dienstältesten Admin bzw. das dienstälteste Mitglied – **nie an eine verdrängte Person** (sie wird übersprungen); die Verifizierung endet (20.6) |
| Hafen ohne Anleger:in (Fahrtenbuch L3: wer zuerst die Position setzt, wird Anleger:in) | gilt **nicht** für verifizierte oder je verifizierte Häfen und nie für Verdrängte – dort setzt nur die Moderation eine neue Anleger:in |
| Eigner neu zuweisen durch Admins (18.6) | bleibt möglich; ohne Antrag endet dabei die Verifizierung (Dialog warnt) |
| Übergabe durch den Eigentümer an einen Admin (F-347) | möglich, beendet die Verifizierung; nie an Verdrängte (409 `claim_blocked`) |
| Häfen zusammenführen (18.7) | verifizierte Quelle in nicht verifiziertes Ziel → 409 `verified` (andersherum zusammenführen) |
| neuer Antrag einer verdrängten Person auf dasselbe Objekt | 409 `claim_blocked` – aufheben kann das nur die Moderation (Verifizierung entziehen, 20.6) |
| Verein des Hafens (`harbors.club_id`, 12.2) | bei verifiziertem Hafen setzen, ersetzen und lösen nur Hafen-Vertretung (setzen: Vereine, die sie verwaltet) und Moderation (20.9 Frage 6) |
| Gruppe löschen, solange ein Antrag offen ist | 409 `claim_pending` mit neutralem Hinweis „gerade nicht möglich – bitte an die Moderation wenden“ (niemand löscht den Verein vor der Entscheidung, 20.9 Frage 2) |

Die Verdrängung steht im angenommenen Antrag (`claims.previous_user_id`) – keine eigene Sperrliste.

### 20.6 Verifizierung endet

- **Admin entzieht** (`DELETE /api/admin/:art/:id/verification { reason }`), z. B. Vorstandswechsel oder Täuschung:
  Abzeichen weg, Rechte bleiben beim heutigen Eigner, die angenommenen Anträge (und damit die Sperre gegen
  Verdrängte) werden gelöscht. Protokoll `unverify`.
- **Vertretung löscht ihr Konto** bzw. wird als inaktiv entfernt: Nachfolge wie 20.5, Abzeichen weg; die Sperre gegen
  Verdrängte bleibt.
- **Eigner-Wechsel durch Admin ohne Antrag** (18.6): Abzeichen weg.
- Ein neuer Vorstand stellt einen neuen Antrag; angenommen ersetzt er die bisherige Vertretung (`previous` wie 20.3).

### 20.7 Missbrauchsgrenzen (`CLAIM_LIMITS`, `src/domain/claims.ts`)

| Grenze | Wert |
|---|---|
| offene Anträge je Konto und Objekt | 1 (409 `claim_open`) |
| offene Anträge je Konto | 3 (429) |
| Anträge je Konto in 30 Tagen (auch zurückgezogene, abgelehnte) | 5 (429) |
| erneut auf dasselbe Objekt nach Ablehnung | frühestens nach 30 Tagen (429) |
| offene Anträge je Objekt | 10 (429) |
| Kontoalter | keine Grenze (ein Vorstand registriert sich oft erst dafür) – die Moderation sieht das Alter |
| gesperrte, ausgeblendete, nicht sichtbare Objekte | 404 wie „gibt es nicht“ |
| suspendierte oder gesperrte Konten | 403 wie überall |

### 20.8 Datenmodell, Benachrichtigungen, Löschkonzept

`0026_verification.sql`: `groups.verified_at`, `harbors.verified_at`; `claims (id, target_kind ∈ group|harbor,
target_id, user_id, role_text, reason, contact, evidence_url, status ∈ open|accepted|rejected|expired|withdrawn, decided_by, decided_at,
decision_note, previous_user_id, previous_action, created_at)` mit Indizes `(target_kind, target_id, status)` und
`(user_id, created_at)`; Arten ohne SQL-`CHECK` (Architektur 7), geprüft in `src/domain/claims.ts`.

Benachrichtigungen (Glocke, Mail wo genannt; alles **Hinweise des Betreibers**, nicht abschaltbar):

| Art | An | Wann | Mail |
|---|---|---|---|
| `claim` | Admins | neuer Antrag | nein |
| `claim_result` | Antragsteller:in | angenommen, abgelehnt, abgelaufen | ja, mit Begründung bei Ablehnung |
| `claim_transfer` | verdrängte Person | Antrag angenommen | ja: was übertragen wurde, neue Rolle, Widerspruch per Antwort bzw. an `REPORT_CONTACT` (wie F-296) |

Löschkonzept (Prüfpunkt 6) – keine R2-Dateien, kein Speicherzähler:

| Anlass | Was |
|---|---|
| zurückgezogen oder abgelehnt | Funktion, Begründung, Kontakt, Beleg **sofort** geleert; Gerüst bleibt **30 Tage** (Wartefrist, Grenze 20.7), dann gelöscht |
| angenommen | Funktion, Begründung, Kontakt, Beleg nach **30 Tagen** geleert (Widerspruchsfrist); das Gerüst (wer, wann, wer verdrängt) bleibt, solange das Objekt besteht – es trägt die Sperre aus 20.5 |
| offen, älter als 180 Tage | nächtlich als `expired` markiert und geleert (höchstens 25 je Nacht), Antragsteller:in bekommt `claim_result` „ohne Entscheidung abgelaufen“; nach 30 Tagen gelöscht |
| Objekt gelöscht (`removeGroup`, `removeHarbor`) | alle Anträge zum Objekt |
| Häfen zusammengeführt (18.7) | nicht angenommene Anträge der Dublette gelten für das Ziel; angenommene fallen mit der Dublette weg |
| Konto gelöscht (`purgeUser`, auch inaktiv) | eigene offene und entschiedene Anträge; **angenommene bleiben ohne Konto-ID** (`user_id` NULL) – sie tragen die Sperre gegen Verdrängte; als Verdrängte:r wird die ID geleert (ohne Konto wirkungslos; 20.9 Frage 5) |
| Konten verbinden (18.8) | `user_id` und `previous_user_id` gehen ans Ziel |
| Verifizierung entzogen | angenommene Anträge zum Objekt gelöscht |
| Benachrichtigungen | wie 17.5; ohne Gegenstand nächtlich weg |
| Admin-Protokoll | `claim_accept`, `claim_reject`, `unverify` – Ziel und kurze Begründung, **keine Kontaktdaten**, 2 Jahre (18.10) |

Datenschutzerklärung (`src/content/legal.ts`): Zweck, Daten, Fristen wie oben.

Module: `src/domain/claims.ts` (Arten, Grenzen, Feldprüfung – rein), `worker/claims.ts` (Antrag, Zurückziehen,
Admin-Liste, Entscheidung, Entziehen, Aufräumen), Abzeichen in `shared.ts`, Dialog `sx-claim-dialog`, Reiter
„Anträge“ in `sx-admin-page`.

### 20.9 Fragen an den Betreiber – entschieden 28.10.2026 (alle Vorschläge übernommen)

1. **Bisherige Person beim Verein:** Standard „bleibt Admin“; die Moderation wählt je Fall Admin / Mitglied / entfernen.
2. **Heutige Eigner:in beim Einreichen:** wird **nicht** informiert; Löschen des Vereins ist während eines offenen
   Antrags gesperrt. Sie erfährt es bei der Annahme (mit Widerspruch).
3. **Nachweis:** nur Kontakt + optionaler Link, keine Uploads, Prüfung über Impressum/Vereinsregister.
4. **Teams** sind ausgeschlossen.
5. **Verdrängte nach Kontolöschung:** die ID wird geleert.
6. **Verein des verifizierten Hafens:** nur Hafen-Vertretung und Moderation ordnen zu.
7. **Abzeichen-Text:** „Verifiziert“.

Hinweis für das Fahrtenbuch (L3, Branch `feature/fahrtenbuch`): Die Regel „wer zuerst die Position setzt, wird
Anleger:in“ prüft vorher `mayAdoptHarbor` (`worker/claim-cleanup.ts`) – je verifizierte Häfen übernimmt niemand so.

## 21. Beiträge als Grundtyp

Stand: 02.11.2026, **Entscheidungen des Betreibers eingearbeitet (21.0), Phase 1 (21.11) und Phase 2 (21.12) umgesetzt.**
Anforderungs-IDs hier sind Platzhalter (**F-400 ff.**) und werden erst bei der Umsetzung nach `docs/REQUIREMENTS.md`
übernommen – vergeben sind F-400, F-401, F-402, F-404, F-405, F-406, F-409, F-415 (Bedeutung wie unten), F-420 … F-424
(21.11), F-425 … F-428 (21.12), F-403, F-416, F-429 (21.13) und F-407 (Konzept 29).

Anlass (Betreiber): *„Ich denke es macht Sinn, Posts als solche zu definieren und diese können dann ein GPX-Törn sein,
oder Umfrage, Veranstaltung mit Check-in, Fotos oder nur ein Fahrtenbuch-Eintrag. Alle Typen sollten über den
Plus-Button erstellbar sein […] Posts sollten angepinnt werden können […] anpinnen nur dort wo es gemacht wird. […]
Das eigene Fahrtenbuch soll dann auch nach Jahren sortiert editierbar sein und Zusatzpunkte eingetragen werden können
[…] Ggf. muss man unterschiedliche Berechnungsmodelle im Adminbereich einstellen können.“* Dazu frühere Wünsche:
Beiträge in Gruppen mit Fotos und angehängtem eigenen Törn; Umfragen und Veranstaltungen mit Zusage; **jeder Beitrag
hat einen Kontext** (man schreibt nie „an alle“, sondern immer in einen Verlauf); Törns erscheinen in einer Gruppe
nur, wenn sie dort ausgewählt sind (11.12).

### 21.0 Entscheidungen des Betreibers (02.11.2026)

Diese Entscheidungen gehen allen Vorschlägen unten vor; die Abschnitte sind angepasst.

| # | Entscheidung | Folge |
|---|---|---|
| B1 | **Anpinnen in jedem Verlauf**, in dem der Beitrag erscheint, aus der Liste heraus; wirkt nur dort (im Verein gepinnt ≠ im Hafen/Team). **Unbegrenzt**, nur manuell lösen, nichts automatisch | 21.2, `channel_pins` ohne Obergrenze und ohne Ablauf |
| B2 | **Ausbreitung nach oben:** Team → Verein → Hafen → Community („Alles“/„Umgebung“), wenn öffentlich; öffentliche persönliche Beiträge ebenso bis in die Community. Neu je Beitrag **„Sichtbar bis“** (nur hier / bis Verein / bis Hafen / überall) | 21.2, Spalte `posts.reach`, 21.7 |
| B3 | **Schreiben in Gruppen je Gruppe einstellbar**, Standard Verein „nur Admins“, Team „alle Mitglieder“ | `groups.post_by` |
| B4 | **„Nur Mitglieder“ kostenlos** für alle Arten außer Törns (Törns bleiben E1) | 21.2 |
| B5 | **Galerie für alle**, kostenlos mit kleinem Kontingent (Vorschlag 10 Fotos je Monat), Unterstützer mehr; Speicher gemeinsam mit Fotos an Törns | 21.3.4; Ausnahme zu E3 nur für Galerie-Beiträge |
| B6 | **Hafen-Verlauf:** schreiben dürfen alle mit einem Boot in diesem Heimathafen; anpinnen Vertretung, Anleger:in, Moderation | 21.7 |
| B7 | **Veranstaltungen:** nur Zusage „nehme teil / vielleicht / nehme nicht teil“; **kein Check-in**, kein QR | 21.5 |
| B8 | **Große Gruppen:** Hinweis vor dem Posten („geht an ca. N Personen – lieber in kleinerer Gruppe schreiben?“) und zusammengefasste Timeline (Tageszusammenfassung ab einer Schwelle) | 21.7.1 |
| B9 | **Umfragen** Standard anonym, „namentlich“ wählbar, vorher angekündigt, nicht umstellbar | 21.5 |
| B10 | **Fahrtenbuch-Zusatzangaben:** Binnen/Küste umschaltbar (passende Felder), Motor-/Segelzeit auch bei GPX nur Vorschlag und änderbar, zusätzliche Posten (Brücken, Mast legen, Training …); alles Vorschläge, änderbar | 21.6 |
| B11 | **Wertung:** Plattform-Admins schlagen Vorlagen vor; Vereine übernehmen, erweitern oder nutzen nur eigene; Mitglieder wählen **je Eintrag eine Vorlage (Pflicht)**; Vereine listen Punktesummen ihrer Mitglieder (Gewichtung einstellbar); Mitglieder erstellen ihren **Jahresbericht** (Excel/CSV, druckbar) zur Abgabe im Verein; dafür ein **Verwaltungsbereich im Konto** | 21.6 |
| B13 | **„Ansehen als …“** auf der eigenen Seite hinter einem Zahnrad (wie der Kartenstil): Vorschau „Öffentlich“, „jemand aus meinem Hafen“, „Mitglied von …“ (eigene Gruppen) – der Server rechnet mit einem simulierten Betrachter, nie mehr als ein echter dürfte; deutlich als Vorschau markiert, „Vorschau beenden“ | 21.11, F-423 |
| B14 | **„Ins Fahrtenbuch“** je Beitrag mit Strecke, Standard an, je Eintrag abschaltbar; dreistufig `shares.log_state`: `confirmed` (eigener Fahrtenbuch-Eintrag), `suggested` (GPX, zählt mit, solange kein Filter „nur bestätigte“), `excluded` (zählt nie, bleibt Beitrag). Bestand: manuell bestätigt, GPX Vorschlag. Phase 1: Schalter am Eintrag + „Bestätigen“; Filter im Fahrtenbuch erst Phase 8 | 21.6, 21.11, F-422 |
| B12 | **Eigene Seite** zeigt einem selbst immer alles (Törns, Beiträge, Fahrtenbuch, auch Privates); „wer sieht es“ (Sichtbarkeit) und „wo steht es“ (Verlauf) werden klar getrennt; Privates steht in einem privaten Bereich und ist gekennzeichnet | 21.2 |

### 21.1 Ausgangslage: fünf Dinge, die für Nutzer:innen „ein Beitrag“ sind

| Heute | Speicher | Wo erscheint es | Was verwirrt |
|---|---|---|---|
| Törn mit GPX | `shares` (`source = 'gpx'`) + R2-Payload | eigene Seite `/s/<id>`; Stream über `activity` (`voyage`) an Segler, Boot, Hafen, gewählte Gruppen (`share_groups`) | Einstieg nur „Track anlegen“; dass ein Törn „in die Gruppe gepostet“ wird, ist ein Haken im Teilen-Dialog |
| Fahrtenbuch-Eintrag | `shares` (`source = 'manual'`, `log`-JSON) | wie Törn; Nachträge gebündelt (`logbook`) | eigener Einstieg „Ins Fahrtenbuch eintragen“; keine Übersicht „mein Fahrtenbuch“ nach Jahren |
| Gruppen-Beitrag (News) | `posts` (`group_id`, `body`, `link`) | nur Gruppe (+ Teams eines Vereins) über `activity` (`post`) | nur Eigner/Admins; kein Foto, kein Törn-Anhang; schreiben nur auf der Gruppenseite |
| Fotos | `photos.share_id NOT NULL` | nur an einem Törn; Stream-Bündel `photos`; Galerien (13.1) | Fotos vom Vereinsfest ohne Törn sind unmöglich |
| Aktivitäten | `activity` + `activity_target` | Stream (Index, Prüfung beim Lesen, 11.3) | Mitglied/Boot/Meilenstein sind *Ereignisse*, keine Beiträge – stehen aber gleichrangig dazwischen |

Es fehlen: persönliche Beiträge (11.10 nur vorbereitet), Umfragen, Veranstaltungen, Anpinnen, eine Seite, auf der man
**alle eigenen** Inhalte (auch private) sieht, und ein gemeinsamer Einstieg.

### 21.2 Zielmodell

**Ein Beitrag (`post`) hat immer: Autor:in, Art, Heimatverlauf („wo steht es“), Sichtbarkeit („wer sieht es“),
Reichweite („Sichtbar bis“), Zeit.** Die Art bestimmt die Nutzlast:

| Art (`kind`) | Nutzlast | Darstellung | Eigene Seite |
|---|---|---|---|
| `voyage` | Törn mit GPX (`shares`) | Stream-Karte wie heute, Klick → Törn-Ansicht (Karte, Fotos, Kommentare, Crew) | ja, `/s/<id>` (unverändert) |
| `logbook` | Fahrtenbuch-Eintrag (`shares`, `source = 'manual'`) | wie heute, gestrichelt | ja, `/s/<id>` |
| `gallery` | 1–30 Fotos + Text | Karte mit Fotoraster, Lightbox | **nein** – Ankerlink |
| `poll` | Frage + 2–10 Antworten | Karte mit Abstimmen/Ergebnis | nein |
| `event` | Termin, Ort, Zusagen | Karte mit Datum, Ort, Zusage-Knöpfen | nein |
| `text` | Text + optional Link (heutige News) | wie heute | nein |

Ein `text`- oder `gallery`-Beitrag kann **einen eigenen Törn anhängen** (`data.shareId`; ist der Törn für den
Lesenden nicht sichtbar, fällt der Anhang beim Lesen weg).

**Verläufe (Kanäle):** `user` (Profil), `group` (Verein oder Team), `harbor`, `boat`. Die Community („Alles“,
„Umgebung“) ist kein Verlauf, in den man schreibt – Beiträge kommen dort nur über die Ausbreitung an (F-400).

| Regel | Inhalt |
|---|---|
| Heimatverlauf | wo der Beitrag angelegt wurde (`channel_kind`, `channel_id`). Über „+“ auf einer Gruppen-/Hafen-/Bootsseite = dieser Verlauf, sonst Vorauswahl „Mein Profil“ |
| Ausbreitung nach oben (B2) | **öffentliche** Beiträge erscheinen zusätzlich in den übergeordneten Verläufen: Team → Verein des Teams (`parent_id`) → Heimathafen des Vereins (13.3) → Community. Profil → Community (Umgebung über den Heimathafen der Person). Boot → Hafen des Boots → Community. Hafen → Community. Begrenzt durch „Sichtbar bis“ (F-409) |
| „Sichtbar bis“ (`reach`) | `here` (nur Heimatverlauf) · `club` (bis Verein) · `harbor` (bis Hafen) · `all` (überall, **Standard** bei öffentlich). Nur Stufen, die es für den Verlauf gibt, werden angeboten. Nicht öffentliche Beiträge sind immer `here` |
| Törns | `voyage`/`logbook` breiten sich wie heute aus (Segler, Boot, Hafen des öffentlichen Boots, ausgewählte Gruppen `share_groups`, Community); „Sichtbar bis“ gilt für sie zusätzlich: `here` = nur eigenes Profil und ausgewählte Gruppen, kein Hafen, keine Community |
| Sichtbarkeit | `public` · `members` (nur Mitglieder des Gruppen-Verlaufs; **kostenlos**, B4; nicht für Törns) · `unlisted` (Schlüssel-Link) · `private` (nur ich). Effektiv = min(Beitrag, Verlauf) für alle Arten außer Törns – dort bleibt Abschnitt 1 (F-402) |
| Eigene Seite (B12) | „Mein Verlauf“ zeigt einem selbst **alles**: Törns, Beiträge, Fahrtenbuch, jede Sichtbarkeit, jeden Verlauf. Jede Karte trägt zwei getrennte Angaben: **Wer sieht es** (Symbol + „Öffentlich“, „Nur Mitglieder von …“, „Nur mit Link“, „Nur ich“) und **Wo steht es** („in Mittwochsregatta → Verein → Hafen“ bzw. „nur hier“). Private Beiträge stehen im Bereich „Privat“ (Filter-Reiter) und sind dort zusätzlich als „Nur ich“ markiert. Gelesen direkt aus `posts.author_id`, nicht über das Aktivitäts-Log (F-401) |
| Anpinnen (B1) | in **jedem** Verlauf, in dem der Beitrag erscheint, über das Menü an der Karte; wirkt nur dort. Unbegrenzt, neueste Pins oben, nur manuell lösen. Ein Pin zeigt nur, was der Lesende ohnehin sehen darf (F-403) |

**Wer pinnt:** eigenes Profil – die Person selbst; Gruppe – Eigner und Admins; Hafen – verifizierte Hafen-Vertretung
(20), sonst die Anleger:in, und die Moderation; Boot – Eigner und Boots-Admins.

### 21.3 Datenmodell und Migration

#### 21.3.1 Zwei Optionen

| | **A: `posts` als Dach (empfohlen)** | B: Arten nebeneinander |
|---|---|---|
| Idee | Jeder Inhalt hat eine Zeile in `posts`. Törns behalten `shares` als Nutzlast; ihre Post-Zeile hat **dieselbe ID** wie der Törn (`posts.share_id = posts.id`). Umfrage, Veranstaltung, Galerie bekommen Untertabellen | `shares` bleibt allein für Törns, `posts` wird um Arten erweitert; „Beitrag“ ist nur ein Begriff der Oberfläche |
| Eigene Seite | eine indizierte Abfrage auf `posts(author_id, created_at)` | zwei Abfragen (`shares`, `posts`) im Worker zusammengeführt, Cursor über zwei Quellen |
| Pins | `channel_pins.post_id` mit Fremdschlüssel → fällt automatisch mit | generisch `(subject_kind, subject_id)` ohne Fremdschlüssel → eigene Aufräumregeln je Art |
| Löschen | gemeinsamer Einstieg `removePost`; bei `voyage`/`logbook` ruft er `removeShare` (der löscht die Post-Zeile per `ON DELETE CASCADE`) | zwei Einstiege wie heute |
| Kosten D1 | +1 Zeile je Törn (≈ 200 B), Rückfüllung einmalig `INSERT … SELECT FROM shares`; Lesen gleich | keine Zusatzzeilen; dafür doppelte Abfragen auf der eigenen Seite und bei Pins |
| Risiko | zwei Zeilen konsistent halten (gleicher Batch beim Anlegen, Fremdschlüssel beim Löschen, nächtlicher Waisen-Check) | „Beitrag“ ohne Gegenstück im Modell; jede neue Art fragt wieder „wo hängt das?“ |
| Stream | `activity` bleibt der Index; die Ausbreitung sind zusätzliche `activity_target`-Zeilen (eine je Stufe, kein Fan-out an Personen) | gleich |

**Empfehlung A**, weil Verlauf, Reichweite, Pin, eigene Seite und Löschen dann für alle Arten **ein** Modell haben und
die Törn-Logik (Sichtbarkeit, Schlüssel, Payload, Fotos, Kommentare, Crew, Aufbewahrung) unangetastet bleibt. Die
Sichtbarkeit von Törns steht weiter nur in `shares`; `posts.visibility` ist für Törn-Zeilen bedeutungslos.

#### 21.3.2 Migration (Vorschlag `0029_posts.sql`, Nummer vor Vergabe in allen Branches prüfen)

```sql
ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';         -- text|gallery|poll|event|voyage|logbook
ALTER TABLE posts ADD COLUMN channel_kind TEXT;                         -- user|group|harbor|boat
ALTER TABLE posts ADD COLUMN channel_id TEXT;
ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'; -- public|members|unlisted|private
ALTER TABLE posts ADD COLUMN reach TEXT NOT NULL DEFAULT 'all';         -- here|club|harbor|all („Sichtbar bis“)
ALTER TABLE posts ADD COLUMN link_key TEXT;                             -- Schlüssel für „Nur mit Link“
ALTER TABLE posts ADD COLUMN share_id TEXT REFERENCES shares(id) ON DELETE CASCADE;
ALTER TABLE posts ADD COLUMN data TEXT NOT NULL DEFAULT '{}';           -- Umfrage-Optionen, Törn-Anhang …
ALTER TABLE posts ADD COLUMN updated_at INTEGER;
ALTER TABLE groups ADD COLUMN post_by TEXT;                             -- admins|members; NULL = Standard je Art (B3)
UPDATE posts SET channel_kind = 'group', channel_id = group_id, reach = 'here' WHERE group_id IS NOT NULL;
INSERT INTO posts (id, author_id, kind, channel_kind, channel_id, share_id, body, created_at)
  SELECT id, user_id, CASE source WHEN 'manual' THEN 'logbook' ELSE 'voyage' END, 'user', user_id, id, '', created_at
  FROM shares;
CREATE UNIQUE INDEX posts_share ON posts(share_id) WHERE share_id IS NOT NULL;
CREATE INDEX posts_channel ON posts(channel_kind, channel_id, created_at DESC);
CREATE INDEX posts_author_created ON posts(author_id, created_at DESC);

CREATE TABLE channel_pins (channel_kind TEXT NOT NULL, channel_id TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, pinned_by TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_kind, channel_id, post_id));
CREATE TABLE poll_votes (post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, choice INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id, choice));
CREATE TABLE post_events (post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, harbor_id TEXT REFERENCES harbors(id) ON DELETE SET NULL,
  lat REAL, lon REAL, capacity INTEGER, reminded_at INTEGER);
CREATE INDEX post_events_start ON post_events(starts_at);
CREATE TABLE event_rsvps (post_id TEXT NOT NULL REFERENCES post_events(post_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL,    -- yes|maybe|no
  updated_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
```

Bestehende Gruppen-Beiträge bekommen `reach = 'here'` (sie erschienen bisher nur in der Gruppe – nichts breitet sich
rückwirkend aus). `group_id` bleibt (Fremdschlüssel für das Löschen der Gruppe). Werte prüft `worker/validate.ts`,
kein `CHECK` (Architektur 7). Reine Regeln (Arten, Verläufe, Ausbreitungskette, Sichtbarkeit, Pin- und Schreibrechte,
Umfrage- und Veranstaltungs-Regeln) in `src/domain/posts.ts`. Neue Törns schreiben Törn- und Post-Zeile im selben Batch.

**Ausbreitung schreiben:** beim Anlegen bzw. Ändern von Sichtbarkeit/„Sichtbar bis“ setzt der Worker die
`activity_target`-Zeilen: Heimatverlauf + jede Stufe bis `reach` (Team → `group` Verein → `harbor` → Community
braucht kein Ziel, „Alles“ liest `activity_recent` und prüft `reach = 'all'`). Wie bei 11.12 werden Ziele angeglichen,
nichts springt nach oben. Die Kette wird beim Schreiben aufgelöst (Verein, Hafen zum Zeitpunkt); beim Lesen wird nur
geprüft, ob der Beitrag noch öffentlich ist und `reach` die Stufe noch abdeckt.

#### 21.3.3 Löschkonzept je Art (CLAUDE.md Prüfpunkt 6)

| Art | einzeln | Eltern (Gruppe, Hafen, Boot) | Konto / inaktiv | Ablauf | Moderation |
|---|---|---|---|---|---|
| `voyage`, `logbook` | `removeShare` (unverändert), Post-Zeile per Cascade | Törn bleibt, nur `share_groups`, Ziele und Pins des Verlaufs fallen | wie heute | wie heute (5.5, L2) | wie heute |
| `text` | `removePost` (heute) + Pins, Reaktionen, Meldungen, Aktivität samt Zielen | Gruppe: Cascade über `group_id`; Hafen/Boot: neue Anweisung in `harborActivityCleanup`/`boatCleanup` (kein Fremdschlüssel auf `channel_id`). Wird ein **übergeordneter** Verlauf gelöscht, fallen nur dessen Ziele und Pins | Cascade `author_id` | Vorschlag: 24 Monate nach Anlegen, nicht solange gepinnt | ausblenden/löschen wie heute |
| `gallery` | wie `text` + **R2-Dateien und Speicherzähler** über die D1-Liste der Foto-IDs (wie `photo-keys.ts`) | **Achtung:** Cascade löscht D1-Zeilen, nicht R2 – Gruppe/Hafen/Boot löschen sammelt vorher die Foto-Schlüssel ihrer Galerie-Beiträge ein | `purgeUser` löscht Fotos künftig über `photos.user_id` (nicht nur über Törns) | wie Fotos am Törn (Saison + Unterstützerende, 5.5/E4) | Foto einzeln (`removePhotoById`) |
| `poll` | Cascade `poll_votes` | wie `text` | eigene Stimmen fallen (Ergebnis ändert sich – gewollt) | wie `text` | wie `text` |
| `event` | Cascade `post_events`, `event_rsvps`, Erinnerungs-Benachrichtigungen | wie `text` | Zusagen fallen | 12 Monate nach Ende (übernommene Fahrtenbuch-Einträge bleiben, sie sind eigene Törns) | wie `text` |
| Pins | Cascade über `post_id`; sonst nur manuell (B1) | Verlauf gelöscht → Anweisung je Verlauf-Art | – | keiner | – |

Ein Test je Zeile (F-404). `post_log` (Beiträge je Verlauf und Tag) gilt für alle Arten außer Törns.

#### 21.3.4 Galerie-Fotos und Kontingent (B5)

`photos.share_id` ist `NOT NULL`. Nötig ist ein einmaliger **Tabellen-Neubau** von `photos` (`share_id` nullable, neu
`post_id REFERENCES posts ON DELETE CASCADE`; genau eins von beiden, geprüft im Worker). R2-Schlüssel
`photos/<postId>/<photoId>.webp`. Das ist das größte Migrationsrisiko (Kopieren, Indizes, `PRAGMA
defer_foreign_keys`), deshalb eine eigene Phase.

Kontingent (`limitsFor`, `src/domain/limits.ts`): **kostenlos 10 Galerie-Fotos je Kalendermonat** (gezählt über
`photos(user_id, created_at)` mit `post_id IS NOT NULL`, gelöschte geben nicht frei, damit niemand rotiert),
Unterstützer z. B. 200 je Monat. Speicher gemeinsam mit Fotos an Törns (200 MB Unterstützer; kostenlos neu ein kleiner
Deckel, Vorschlag 25 MB, nur für Galerie-Fotos). Fotos an Törns bleiben Unterstützern vorbehalten (E3). Notbremse
gilt. Galerie-Fotos haben keinen Ort auf der Karte (EXIF wird wie immer entfernt).

### 21.4 Plus-Knopf: ein Einstieg für alles

Der heutige FAB (`sx-empty-state`, mobil unten rechts) und „Track anlegen“ in der Kopfzeile werden zu **„+ Neu“**.
Auf Gruppen-, Hafen- und Bootsseiten ist der Verlauf vorausgewählt (F-405).

1. **Art wählen** (Bottom-Sheet mobil, Menü am Knopf ab 760 px): „Törn (GPX)“ · „Fahrtenbuch-Eintrag“ · „Fotos“ ·
   „Umfrage“ · „Veranstaltung“ · „Text“. Gäste: Anmeldedialog, danach weiter (wie F-31); „Törn (GPX)“ bleibt ohne
   Anmeldung möglich (lokal analysieren, Prinzip Security 1). Ziehen & Ablegen einer GPX-Datei bleibt der Schnellweg.
2. **Wo steht es?** „Mein Profil“ + Gruppen, in denen ich schreiben darf (B3) + Häfen meiner Boote (B6) + eigene/
   verwaltete Boote. Bei Törns die bekannte Mehrfachauswahl „In Gruppen zeigen“ (11.12).
3. **Wer sieht es?** (`sx-visibility-picker`, um „Nur Mitglieder“ erweitert, nur bei Gruppen-Verlauf) und
   **Sichtbar bis** (nur bei öffentlich; zeigt die Kette, z. B. „Mittwochsregatta → PYC → Hafen Potsdam → überall“).
4. **Hinweis bei großem Publikum** (21.7.1).
5. **Formular je Art.** Törn: Datei wählen → wie heute in die **Törn-Ansicht** (Karte), dort Speichern/Teilen;
   Fahrtenbuch: `sx-logbook-form`. Fotos/Umfrage/Veranstaltung/Text: kompaktes Formular im Sheet bzw. Dialog
   (`dialogStyles`), danach zurück in den Verlauf, die neue Karte oben und kurz hervorgehoben.

**Ohne eigene Seite:** Galerie, Umfrage, Veranstaltung und Text sind nur Stream-Karten. Teilen und Benachrichtigungen
verlinken `/p/<id>` (bzw. `/p/<id>/<schlüssel>`): der Worker leitet auf den Heimatverlauf mit Anker `#p-<id>` um, die
Karte wird nachgeladen, falls sie nicht auf der ersten Seite steht, und hervorgehoben. Ist der Verlauf für den Lesenden
nicht sichtbar (z. B. Beitrag „Nur mit Link“), zeigt `/p/…` die einzelne Karte im Rahmen des Verlaufs. Link-Vorschau:
erste Zeile, bei Galerien das erste Foto nur bei effektiv öffentlich (wie 1.4) (F-406).

Komponenten: `sx-compose` (Ablauf, Controller für die Schritte), je Art eine kleine Karte (`sx-poll`, `sx-event`,
`sx-gallery-post`); `sx-stream` delegiert an sie.

### 21.5 Umfragen und Veranstaltungen

**Umfrage (`poll`)** (F-407)

| Punkt | Regel |
|---|---|
| Inhalt | Frage ≤ 300 Zeichen, 2–10 Antworten ≤ 100 Zeichen; nach der ersten Stimme nicht mehr änderbar (nur schließen/löschen) |
| Auswahl | einfach (Standard) oder mehrfach (höchstens n) |
| Ende | optional Datum/Uhrzeit (≤ 90 Tage); danach geschlossen, geprüft beim Lesen und Abstimmen – kein Cron |
| Ergebnis sichtbar | „nach eigener Stimme“ (Standard) · „immer“ · „erst nach Ende“; die Autor:in sieht es immer |
| Anonymität (B9) | Standard **anonym** (nur Zahlen); wählbar „namentlich“ – steht dann im Formular und an der Karte, Namen nur bei öffentlichem Profil (sonst „+ n weitere“, wie Reaktionen). Nicht umstellbar |
| Wer stimmt ab | angemeldet, nicht gesperrt, wer den Beitrag sehen darf (auch in übergeordneten Verläufen) – sonst 404 |
| Ändern | eigene Stimme ändern/zurücknehmen bis zum Ende |
| Grenzen | zählen in `post_log`; 300 Stimmen je Konto und Tag (wie Reaktionen); ≤ 1000 Stimmen je Umfrage |
| Zählen | `GROUP BY choice` auf `poll_votes(post_id)`; im Stream ein Batch für alle Umfragen der Seite |

**Veranstaltung (`event`)** (F-408, F-410)

| Punkt | Regel |
|---|---|
| Inhalt | Titel, Beschreibung, Art (Treffen · Ausfahrt · Regatta · Arbeitsdienst · Training · Kurs), Beginn, Ende (≤ 14 Tage), Ort: Hafen (`sx-harbor-picker`) **oder** Kartenpunkt (`sx-place-picker`) |
| Zusage (B7) | „Nehme teil“ · „Vielleicht“ · „Nehme nicht teil“, änderbar bis Ende; Zähler je Status, Namen wie bei Reaktionen (öffentliche Profile); Autor:in und Gruppen-Admins sehen alle Anzeigenamen (wie Mitgliederliste). **Kein Check-in, kein QR** |
| Kapazität | optional; voll ⇒ „Nehme teil“ gesperrt, „Vielleicht“ geht (keine Warteliste); geprüft in derselben SQL-Anweisung (`INSERT … SELECT … WHERE COUNT < capacity`) |
| Erinnerung | Benachrichtigung (17) `event_reminder` an „Nehme teil“/„Vielleicht“ im Nachtlauf (Cron 03:17 UTC) für Veranstaltungen der nächsten 36 h, einmal (`reminded_at`); Kanäle je Art wie 17.6. Zeit/Ort geändert oder abgesagt ⇒ `event_changed` an alle Zusagen |
| Danach | wer „Nehme teil“ hatte, sieht „Ins Fahrtenbuch übernehmen“: `sx-logbook-form` vorbefüllt (Datum, Hafen, Titel, Art), bei Regatten mit Platz/Startern (21.6). Es entsteht ein normaler Fahrtenbuch-Eintrag mit Verweis `log.eventId` |
| Kalender | `.ics`-Download je Veranstaltung (im Browser erzeugt) |
| Grenzen | zählen in `post_log`; Zusagen 300 je Konto und Tag; Kapazität ≤ 500 |

### 21.6 Fahrtenbuch: Jahre, Zusatzangaben, Wertung, Jahresbericht

**Ansicht „Mein Fahrtenbuch“** im neuen **Verwaltungsbereich des Kontos** (`/konto/fahrtenbuch`, auch von der eigenen
Seite erreichbar) (F-411, F-418): Reiter je Saison (neueste zuerst), Tabelle Datum · Von → Nach · sm (Quelle) · Rolle ·
Boot · Revier · Posten · Vorlage · Punkte; Klick öffnet `sx-logbook-form` bzw. das Fahrtenbuch-Panel des GPX-Törns.
Kopf je Jahr: Summen (sm, davon aufgezeichnet, unter Segel/Motor, als Skipper, Nachtstunden, Tage an Bord, Häfen,
Küste/Tide) und Punkte je Vorlage. Enthält **alle** eigenen Törns, auch private, und bestätigte Crew-Törns anderer
(Ausnahme M1, nur Eckdaten). Der Verwaltungsbereich bündelt außerdem: Meine Törns und Beiträge (mit Filter Sichtbarkeit/
Verlauf), Fotos und Kontingente, Gruppen, Wertungen/Jahresbericht – statt der heutigen Reiter im Konto-Dialog.

**Zusatzangaben** (in `shares.log`, für GPX- und manuelle Törns) (F-412). *Annahmen, vor der Umsetzung mit Prüfungs-
und Vereinsordnungen abgleichen:* Meilennachweise für SKS/SSS zählen Seemeilen in Küstengewässern mit Funktion an Bord;
Binnenmeilen zählen dort nicht; Vereins-Fahrtenpreise werten meist Meilen, Tage, Häfen, Nachtfahrten.

| Feld | Binnen | Küste | Hinweis |
|---|---|---|---|
| Revier-Schalter (B10) | `inland` | `coastal` (+ `offshore`, Haken Tidengewässer) | schaltet die passenden Felder um; Vorschlag aus Hafen/Track, änderbar |
| Stunden unter Segel / Motor | ja | ja | bei GPX **nur Vorschlag** (aus Speed-Profil im Browser, z. B. gleichmäßige Fahrt ohne Wendemanöver = Motor), immer änderbar |
| Nachtfahrt (Stunden) | – | ja | bei GPX aus Zeit und Sonnenstand vorgeschlagen |
| Tage an Bord / Hafentage | ja | ja | aus Ab- und Ankunft vorgeschlagen |
| Schleusen, Brücken (Anzahl) | ja | – | typische Binnen-Posten |
| Mast legen/stellen | ja | – | |
| Max. Windstärke | ja | ja | Bft |
| Regatta | ja | ja | Name, Platz, Starter |
| **Posten** (B10) | ja | ja | frei wählbare Zusätze aus der Vorlage, z. B. Training, Ausbildung, Arbeitsdienst, Regattaleitung, Überführung – je Posten Anzahl oder Haken, Begründung ≤ 200 Zeichen |

Alles sind Vorschläge; nichts wird ohne Bestätigung gesetzt, alles bleibt änderbar. Selbstangaben sind als solche
gekennzeichnet.

**Wertungsvorlagen (B11)** (F-413, F-414): kein Formeltext (kein `eval`), sondern ein **Baukasten** als JSON, geprüft
und berechnet von einer reinen Funktion `scoreEntry(entry, template)` / `scoreSeason` in `src/domain/scoring.ts`
(im Browser für das eigene Fahrtenbuch, im Worker für Vereinslisten).

| Baustein | Beispiel-Gewicht |
|---|---|
| Punkte je sm unter Segel / unter Motor | 1,0 / 0,3 |
| Faktor Revier binnen / Küste / offshore / Tide | 1,0 / 1,2 / 1,5 / +0,2 |
| Faktor Rolle Skipper / Co / Crew / Gast | 1,2 / 1,1 / 1,0 / 0,5 |
| Punkte je Nachtstunde / Tag an Bord / verschiedenem Hafen / Schleuse / Mastlegen | 2 / 5 / 3 / 1 / 5 |
| Regatta: Teilnahme + (Starter − Platz + 1) × Gewicht | 10 + 1 |
| Posten (frei definierbar: Name, Einheit, Punkte je Einheit, Deckel) | Training 5, Arbeitsdienst 10 |
| Deckel je Eintrag | 500 |

| Wer | Was |
|---|---|
| Plattform-Admins | pflegen **vorgeschlagene Vorlagen** (`scoring_templates`, global, z. B. „Nur Meilen“, „Fahrtenpreis klassisch“, „Binnen-Wanderfahrt“, „Regatta“) im Admin-Bereich |
| Vereine (Eigner/Admins) | **übernehmen** eine Vorlage (Kopie mit Herkunft), **erweitern** sie (eigene Posten, Gewichte) oder legen **nur eigene** an (`group_templates (id, group_id, name, json, source_id)`); legen fest, welche ihrer Vorlagen für die Vereinsliste zählen und wie gewichtet wird (Feld `weighting`, z. B. Punkte je Kopf der Crew an Bord oder Normierung nach Mitgliederzahl – *Auslegung von „Gewichtung nach Mitgliederzahl“, mit dem Betreiber bestätigen*) |
| Mitglieder | wählen **bei jedem Eintrag eine Vorlage (Pflicht)** – Auswahl aus globalen Vorlagen und denen ihrer Vereine, vorbelegt mit der zuletzt genutzten (`log.templateId`). Ohne Vorlage kein Speichern (Altbestand: „Nur Meilen“) |
| Vereinsliste | Punktesummen je Mitglied für die Saison, nur Einträge mit einer Vorlage dieses Vereins, die in der Gruppe gezeigt sind (`share_groups`) und deren Mitglied teilnimmt (`group_members.scoring_opt_in`); nur Summen, Name nur mit öffentlichem Profil bzw. für Gruppen-Admins (wie Mitgliederliste); 10 min gecacht |

**Jahresbericht (B11)** (F-418): im Verwaltungsbereich „Jahresbericht {Saison} für {Verein}“ – Einzelangaben je
Eintrag (Datum, Von/Nach, sm, Revier, Rolle, Boot, Posten, Punkte) und Summen, als **CSV/Excel** (CSV mit
Semikolon und UTF-8-BOM, öffnet in Excel; echtes `.xlsx` nur, wenn eine kleine Bibliothek gebündelt werden darf) und
als **druckbare Seite** (Druckstil, „Als PDF speichern“ des Browsers). Erzeugt im Browser aus der eigenen Liste –
kein Server-Speicher, kein Mailversand; abgegeben wird er von der Person selbst. Optional: Vereins-Admins sehen, wer
für die Saison einen Bericht „als abgegeben markiert“ hat (nur ein Zeitstempel).

**Datenschutz:** Gerechnet wird nur über eigene Einträge bzw. in der Vereinsliste über teilnehmende Mitglieder und
deren dort gezeigte Einträge; nie Einzelangaben nicht öffentlicher Einträge für andere; keine plattformweiten
Ranglisten (K6 bleibt). Löschen: globale Vorlagen nur durch Admins (Vereins-Kopien bleiben), Vereinsvorlagen per
Cascade mit der Gruppe, `log.templateId` auf gelöschte Vorlage ⇒ Rückfall „Nur Meilen“, Opt-in mit der Mitgliedschaft.

### 21.7 Sichtbarkeit und Stream je Verlauf

| Verlauf | Wer schreibt | Erscheint im Verlauf | Ausbreitung nach oben (öffentlich, bis „Sichtbar bis“) |
|---|---|---|---|
| Profil (`user`) | die Person | eigene Beiträge; Besucher öffentliche nur bei öffentlichem Profil | Community (Alles; Umgebung über den Heimathafen der Person); Follower und Teamkollegen im persönlichen Stream |
| Team (`group`, `team`) | je Gruppe (B3), Standard alle Mitglieder | alle Arten; `members` nur für Mitglieder | Verein des Teams → dessen Heimathafen → Community |
| Verein (`group`, `club`) | je Gruppe (B3), Standard nur Admins | eigene + öffentliche Beiträge seiner Teams (bis `club`+) | Heimathafen des Vereins → Community |
| Hafen (`harbor`) | alle mit einem Boot in diesem Heimathafen (B6), dazu Vertretung, Anleger:in, Moderation | eigene + Ausbreitung von Vereinen, Teams, Booten, Personen mit diesem Hafen + Törns öffentlicher Boote | Community |
| Boot (`boat`) | Eigner, Boots-Admins | Beiträge + Törns des Boots | Hafen des Boots → Community |

Regeln: Prüfung beim Lesen wie 11.3, ergänzt um Sichtbarkeit, `reach` je Stufe, Sichtbarkeit des Heimatverlaufs und
Autor-Profil (11.10). `private`/`unlisted` werden **nie** ins Aktivitäts-Log geschrieben; `members` nur mit Ziel
Heimatgruppe, beim Lesen auf Mitgliedschaft geprüft, nie aus dem 60-s-Cache öffentlicher Gruppen-Streams (F-415).
Persönlicher Stream (Mitgliedschaften) wie 12.4; „Umgebung“ und „Alles“ zeigen öffentliche Beiträge mit `reach = 'all'`.
Pins stehen über dem Stream des Verlaufs, in dem gepinnt wurde, nicht im persönlichen Stream.

**Benachrichtigungen** (Erweiterung von 17.1, F-416): `post` (neuer Beitrag in einer meiner Gruppen – Standard
**aus**, je Art wählbar; Umfragen und Veranstaltungen Standard „Glocke“), `rsvp` (Zusagen an die Autor:in, gebündelt),
`event_reminder`, `event_changed`, `poll_closed` (an die Autor:in), Reaktionen wie heute. Stumme Gruppen (12.12)
benachrichtigen nicht – außer Erinnerung/Änderung einer Veranstaltung mit eigener Zusage. Ausbreitung nach oben
benachrichtigt nie (nur der Heimatverlauf).

#### 21.7.1 Große Gruppen: Hinweis und Tageszusammenfassung (B8)

Umgesetzt in Phase 6, Entscheidungen und Abweichungen in Konzept 28 (`docs/concept/28-grosse-gruppen.md`).

**Hinweis vor dem Posten** (F-417): `sx-compose` zeigt das ungefähre Publikum der gewählten Kombination aus Verlauf,
Sichtbarkeit und „Sichtbar bis“ – Mitglieder + Follower des Heimatverlaufs und der Stufen darüber (Hafen: Konten mit
Boot oder Heimathafen dort + Follower; „überall“: „alle in der Community“). Ab **100** Personen: „Geht an ca. N
Personen – lieber in einer kleineren Gruppe schreiben?“ mit den passenden Teams/kleineren Gruppen als Knöpfen und
„Sichtbar bis“ als Schnellwahl; Senden bleibt möglich. Zahl gerundet (≈ 10er), keine Namen. Kosten: ein
`GET /api/compose/audience?…` mit einem Zähl-Batch, 5 min gecacht je Verlauf.

**Zusammengefasste Timeline** (F-417): gilt für Verläufe mit mehr als **150 Mitgliedern bzw. Booten** oder mehr als
**15 Einträgen an einem Tag**. Dann zeigt der Verlauf (und der persönliche Stream für diese Quelle) ältere Tage nicht
mehr einzeln, sondern als **Tageskarte**: „Sa, 14.6. – 6 Törns (212 sm), 18 Fotos, 3 Beiträge, 2 neue Mitglieder“ mit
den 3 meistbeachteten Einträgen (Reaktionen) als Vorschau und „Alle anzeigen“ (klappt die Einträge des Tages auf, lädt
per Cursor). Der laufende Tag bleibt einzeln. **Nie zusammengefasst:** Pins, Veranstaltungen und Umfragen (laufend),
eigene Beiträge, Beiträge von Admins/Vertretung. Umsetzung beim Lesen im Worker (Gruppieren der geprüften Kandidaten nach
Tag in Ortszeit Europe/Berlin), keine neue Tabelle, kein Schreiben; Schwellen in `GROUP_LIMITS`, je Gruppe vom Eigner
abschaltbar.

### 21.8 Phasenplan

Jede Phase ist für sich auslieferbar; Review-Agent und `npm run check` vor jedem Merge.

| Phase | Inhalt | Aufwand | Risiko |
|---|---|---|---|
| **1 – Dach und eigene Seite** | Migration `0029_posts` (Spalten inkl. `reach`, `groups.post_by`, Rückfüllung Törns, Indizes), `src/domain/posts.ts`, `removePost` als Einstieg, „Mein Verlauf“ mit „Wer sieht es / Wo steht es“ und Bereich „Privat“, Text-Beiträge im eigenen Profil, Schreibrecht je Gruppe, `members` | M | Rückfüllung muss Törn-ID = Post-ID halten; Anlegen von Törns schreibt künftig zwei Zeilen |
| **2 – Plus-Knopf, Ausbreitung, Hafen-Verlauf** | `sx-compose` (Art, Verlauf, Sichtbarkeit, „Sichtbar bis“), Ausbreitungskette als Ziele, Schreiben im Hafen für Boots-Eigner, `/p/<id>`-Anker | M | FAB und Ziehen & Ablegen mobil nicht verlieren; Ziele beim Ändern angleichen |
| **3 – Pins** | `channel_pins`, Rechte je Verlauf, unbegrenzt, Menü an der Karte | S | gering |
| **4 – Umfragen** | `poll_votes`, Karte, Grenzen, `poll_closed` | M | gering |
| **5 – Veranstaltungen** | `post_events`, `event_rsvps`, Kapazität, Erinnerungen im Cron, `.ics`, „Ins Fahrtenbuch übernehmen“ | M | Mail-Budget (100/Tag, geteilt) |
| **6 – Große Gruppen** | Publikums-Hinweis, Tageszusammenfassung beim Lesen | M | Cursor über zusammengefasste Tage |
| **7 – Galerie-Beiträge** | Neubau `photos` (`post_id`), Kontingent kostenlos/Unterstützer, R2-Pfad, Löschpfade inkl. Gruppe/Hafen/Boot/Konto, Törn-Anhang | L | **größtes Migrationsrisiko** (Tabellen-Neubau, Speicherzähler, Waisen in R2) |
| **8 – Verwaltungsbereich und Fahrtenbuch** | `/konto/…` mit Fahrtenbuch nach Jahren, Zusatzangaben mit Binnen/Küste, Vorschläge aus GPX, Posten; Filteransicht nach `log_state` (Bestätigte / mit Vorschlägen / Ausgeschlossene, Mehrfachauswahl, B14) und Summen „nur bestätigte“ | M–L | Abgleich mit Crew-Ausnahme M1, Konto-Dialog ablösen ohne Funktionsverlust |
| **9 – Wertung und Jahresbericht** | `scoring.ts`, globale Vorlagen (Admin), Vereinsvorlagen, Pflicht-Vorlage je Eintrag, Vereinsliste mit Opt-in, Jahresbericht CSV/Druck | L | Erwartung „offizielle“ Wertung – als Vereinshilfe kennzeichnen |

Migrationsrisiken allgemein: Nummernkollision mit parallelen Branches (vor Vergabe prüfen); Konsistenz Törn/Post
(nächtlicher Waisen-Check); gecachte alte Clients zeigen neue Arten als leere Karte – abgemildert, indem jede Art einen
lesbaren `body` als Rückfall mitbringt.

### 21.9 Platzhalter-Anforderungen

- **F-400** Jeder Beitrag hat genau einen Heimatverlauf (`user`/`group`/`harbor`/`boat`); in die Community schreibt man nicht direkt.
- **F-401** Die eigene Seite zeigt einem selbst alle eigenen Törns, Beiträge und Einträge; „Wer sieht es“ und „Wo steht es“ getrennt; Bereich „Privat“.
- **F-402** Sichtbarkeit `public`/`members`/`unlisted`/`private`, effektiv = min(Beitrag, Verlauf); `members` kostenlos, nicht für Törns.
- **F-403** Anpinnen in jedem Verlauf, in dem der Beitrag erscheint, nur dort wirksam, unbegrenzt, nur manuell gelöst.
- **F-404** Löschkonzept je Art (21.3.3) mit Test je Weg, inkl. R2-Fotos von Galerie-Beiträgen.
- **F-405** Plus-Knopf mit Art, Verlauf, Sichtbarkeit, „Sichtbar bis“; Verlauf auf Gruppen-, Hafen- und Bootsseiten vorausgewählt.
- **F-406** Galerie, Umfrage, Veranstaltung, Text ohne eigene Seite; `/p/<id>` führt zum Anker im Heimatverlauf.
- **F-407** Umfragen nach 21.5 (umgesetzt, Konzept 29).
- **F-408** Veranstaltungen mit Zusage (teil/vielleicht/nicht) und Kapazität, ohne Check-in.
- **F-409** Ausbreitung Team → Verein → Hafen → Community für öffentliche Beiträge, begrenzt durch „Sichtbar bis“.
- **F-410** Erinnerungen und Änderungsmeldungen zu Veranstaltungen.
- **F-411** Fahrtenbuch nach Jahren, bearbeitbar, mit Jahressummen. *Umgesetzt in Konzept 27.*
- **F-412** Zusatzangaben mit Binnen/Küste, Vorschläge aus GPX änderbar, frei definierbare Posten. *Umgesetzt in Konzept 27 (Posten frei, Vorlagen mit Phase 9).*
- **F-413** Wertungsvorlagen als geprüfter Baukasten: global (Admin), Verein (übernehmen/erweitern/eigene), Pflicht je Eintrag. *Umgesetzt in Konzept 32 (F-500 … F-502).*
- **F-414** Vereinsliste der Punktesummen nur mit Opt-in, nur dort gezeigte Einträge, Gewichtung einstellbar. *Umgesetzt in Konzept 32 (F-503, F-504).*
- **F-415** `members`-Beiträge nie aus öffentlichen Caches, nie für Nicht-Mitglieder, nie weiter ausgebreitet.
- **F-416** Benachrichtigungen für Beiträge, Zusagen, Erinnerungen, Umfrage-Ende; Ausbreitung benachrichtigt nicht.
- **F-417** Publikums-Hinweis ab 100 Personen und Tageszusammenfassung großer Verläufe – ausformuliert als F-465 … F-469 (Konzept 28).
- **F-418** Verwaltungsbereich im Konto mit Jahresbericht (CSV/Excel, druckbar). *Verwaltungsbereich und Meilennachweis (CSV, Druck) in Konzept 27; Jahresbericht mit Punkten in Konzept 32 (F-505).*
- **F-419** Galerie-Kontingent: kostenlos 10 Fotos je Monat, Unterstützer mehr, Speicher gemeinsam mit Törn-Fotos. → umgesetzt als F-490 … F-495 (Konzept 31).

### 21.11 Umsetzung Phase 1 (02.11.2026)

Migration `0029_posts.sql`, Regeln `src/domain/posts.ts`, Worker `worker/posts.ts` (+ `post-sql.ts`), Oberfläche
`sx-my-posts`, `sx-post-composer`, `sx-profile-posts`, `sx-preview-menu`, Ablauf `controllers/posts.ts`.

| Anforderung | Inhalt |
|---|---|
| F-400 | Dach `posts`, Törn-Zeile mit gleicher ID im selben Batch, Rückfüllung, nächtlicher Waisen-Check |
| F-401 | „Mein Verlauf“ mit „Wer sieht es“ / „Wo steht es“ und Reiter „Privat“ (auch „Nur mit Link“ und „Nur ich“) |
| F-402 | Sichtbarkeit beim Lesen mit einer Regel (`canSeePost`); „Nur Mitglieder“ kostenlos |
| F-404 | `removePost` als ein Einstieg; alle Wege aus Prüfpunkt 6 getestet |
| F-415 | „Nur Mitglieder“ nie in Teams, RSS, Community oder aus dem Gruppen-Cache |
| F-420 | Text-Beiträge im eigenen Profil (öffentlich / „Nur ich“); Besucher sehen Profil- und sichtbare Gruppen-Beiträge |
| F-421 | Schreibrecht je Gruppe `groups.post_by` (B3) |
| F-422 | „Ins Fahrtenbuch“ (B14) |
| F-423 | „Ansehen als …“ (B13) |
| F-424 | Törn-Titel nach dem Teilen überall umbenennen (Törn-Ansicht, Teilen-Dialog, „Mein Verlauf“, Konto), auch „Nur mit Link“ – Wunsch des Betreibers |

Abweichungen bzw. Festlegungen gegenüber 21.2–21.7:

- **Keine Ausbreitung in Phase 1:** neue Text-Beiträge stehen mit `reach = 'here'`; „Alles“ zeigt Profil-Beiträge erst mit
  `reach = 'all'` (Phase 2). Öffentliche Gruppen-Beiträge erscheinen in „Alles“ und „Umgebung“ wie bisher – die Annahme
  in 21.3.2, sie hätten nur in der Gruppe gestanden, stimmte nicht; ob `reach = 'here'` des Bestands sie dort künftig
  ausblendet, entscheidet Phase 2.
- **„Nur ich“ für Text-Beiträge** bleibt wie überall Unterstützern vorbehalten (E1); B4 macht nur „Nur Mitglieder“ frei.
  „Nur mit Link“ kommt mit `/p/<id>` (Phase 2); `link_key` ist schon angelegt.
- **Profil für Besucher** zeigt neben Profil-Beiträgen auch die Gruppen-Beiträge der Person, soweit der Betrachter die
  Gruppe sehen darf (mit „Wo steht es“) – damit „Mitglied von …“ in der Vorschau einen Unterschied zeigt. Die Vorschau
  „jemand aus meinem Hafen“ zeigt in Phase 1 dasselbe wie „Öffentlich“ (Häfen haben noch keine eigenen Stufen).
- **Kennzahlen und „Ins Fahrtenbuch“:** ausgeschlossene Törns zählen nirgends in Seemeilen, Törn-Zahlen, Saison und
  Meilensteinen (Profil, Boot, Gruppe, Hafen, Entdecken), bleiben aber in Listen und Streams. Der Schalter liegt in Phase 1
  nur in „Mein Verlauf“ (und beim Speichern per API), noch nicht im Teilen-Dialog und im Fahrtenbuch-Formular.
- **Keine Ablauffrist** für Text-Beiträge in Phase 1 (Vorschlag 24 Monate, 21.3.3) – sie verschwinden mit Gruppe, Konto,
  Moderation oder einzeln; das Aktivitäts-Log läuft wie bisher nach 12 Monaten ab.
- Tageszähler des Profil-Verlaufs: `post_log.group_id = 'user:<id>'`, gelöscht mit dem Konto bzw. nach 24 h.
- **Meilensteine** werden nur beim Veröffentlichen geprüft (wie 11.12) – späteres Umschalten von „Ins Fahrtenbuch“
  nimmt einen schon erreichten Meilenstein nicht zurück und löst keinen neuen aus.
- **Fremdschlüssel `posts.share_id → shares`** (ON DELETE CASCADE): ein künftiger Tabellen-Neubau von `shares` braucht
  `PRAGMA defer_foreign_keys = ON`, sonst fallen alle Post-Zeilen der Törns (Hinweis auch in `0029_posts.sql`).
- **„Ins Fahrtenbuch“ beim Speichern** gibt es nur per API (`X-Share-Log-State`, `logState`); in der Oberfläche liegt
  der Schalter in Phase 1 am Eintrag in „Mein Verlauf“. `logState` liefert der Server nur der Eigentümer:in.

### 21.12 Umsetzung Phase 2 (02.11.2026)

Migration `0030_post_reach.sql`, Regeln `src/domain/posts.ts` (Kette, Stufen, Schreibrechte Hafen/Boot), SQL-Fragment
`worker/reach-sql.ts` (eine Stelle für „Sichtbar bis“ in Abfragen), Verläufe `worker/post-chain.ts`, Worker
`worker/posts.ts` (`POST /api/posts`, `PATCH`/`GET /api/posts/:id`, `GET /api/me/compose`), `worker/stream.ts`
(Boots-Stream, Einzelkarte), Oberfläche `sx-compose`, `sx-compose-dialog`, `sx-reach-picker`, `sx-account-menu`, Abläufe
`controllers/compose.ts` und `controllers/post-link.ts`.

| Anforderung | Inhalt |
|---|---|
| F-405 | „+ Neu“ als einziger Einstieg zum Anlegen (Törn GPX, Fahrtenbuch, Text), „Wo steht es?“ mit Vorauswahl der offenen Seite |
| F-406 | `/p/<id>` mit Anker im Heimatverlauf, Einzelkarte, Link-Vorschau, „Nur mit Link“ für Text-Beiträge, Permalink an der Zeitangabe |
| F-409 | Ausbreitung nach oben bis „Sichtbar bis“, Ziele beim Schreiben, Prüfung beim Lesen, Ändern ohne Sprung nach oben |
| F-425 | Hafen- und Boots-Verlauf: Schreibrechte (B6), Streams, Löschkonzept |
| F-426 | Text-Beitrag mit eigenem Törn als Anhang |
| F-427 | „Sichtbar bis“ für Törns, Ziele aus einer Funktion für Anlegen und Ändern |
| F-428 | Konto-Menü (Meine Seite, Mein Fahrtenbuch, Konto & Einstellungen), Reiter „Fahrtenbuch“ in „Mein Verlauf“ – Wunsch des Betreibers; der Reiter ist seit Konzept 27 die Seite `/konto/fahrtenbuch` (F-459) |

Abweichungen bzw. Festlegungen gegenüber 21.2–21.7:

- **Weiterleitung von `/p/<id>` im Browser statt per HTTP-Redirect:** Der Worker liefert die App mit Link-Vorschau (erste
  Zeile); die App ersetzt die Adresse durch den Heimatverlauf mit `#p-<id>`. Ein 302 hätte Messenger-Vorschauen auf die
  Gruppen- bzw. Hafenseite umgelenkt. Für die Einzelkarte nutzt die App die Profilseiten-Hülle (`kind: 'post'`).
- **Standard „Sichtbar bis“:** Die Oberfläche schlägt „überall“ vor. Ohne Angabe (ältere Oberflächen, API) gilt für
  Gruppen, Häfen und Boote „überall“ (bisheriges Verhalten der Gruppen-Beiträge), im Profil „nur hier“ (Phase 1).
- **Bestand (Migration 0030):** öffentliche Gruppen-Beiträge stehen auf „überall“ – sie erschienen schon in „Alles“ und
  „Umgebung“ (21.11) und bleiben dort; Ziele kommen keine dazu, nichts erscheint neu in Verein oder Hafen.
- **Profil-Kette:** Profil → Heimathafen der Person → Community; „bis Hafen“ wird angeboten, wenn die Person einen
  Heimathafen hat (21.7 nennt ihn als Weg in die Umgebung). Teams ohne Verein breiten sich über ihren eigenen Heimathafen aus.
- **Lesen:** Gruppen-, Hafen- und Community-Streams prüfen Stufe und Öffentlichkeit beim Lesen; der persönliche Stream
  folgt den beim Schreiben angeglichenen Zielen. Öffentliche Streams sind 60 s gecacht (wie 11.12): ein herabgesetzter
  Beitrag kann dort so lange noch erscheinen. „Nur Mitglieder“, „Nur mit Link“, „Nur ich“, Vorschauen und Pins kommen
  nie in einen Cache. **Bewusst keine Versionsnummer je Verlauf im Cache-Schlüssel:** Sie bräuchte je öffentlichem Abruf
  eine zusätzliche D1-Abfrage, einen Zähler je Verlauf und je Community-Seite, und jeder Schreibweg (Beiträge, Törns,
  Fotos, Boote, Gruppen, Moderation, Ablauf) müsste ihn für alle betroffenen Verläufe hochzählen – ein vergessener Weg
  ließe Altes unbegrenzt stehen statt höchstens 60 s. Die Grenze von 60 s ist klein, sicher und billig (Prinzip 6).
- **Törns:** „nur hier“ = Profil und gewählte Gruppen (ohne Boot), „bis Verein“ zusätzlich Vereine gewählter Teams,
  „bis Hafen“ zusätzlich Boot, Hafen des Boots und Hafenseite. Ziele von Törn und Fotos entstehen beim Anlegen und bei
  jeder Änderung (Auswahl, Boot, Sichtbarkeit, „Sichtbar bis“) aus derselben Funktion. `/entdecken` gehört zur
  Community und zeigt nur Törns mit „überall“.
- **Tageszähler (Review S2):** Gruppen zählen wie bisher je Gruppe, das Profil je Person; Hafen und Boot zählen je
  Konto (`harbor:<id>:<konto>`), weiter 5 pro Tag und Person – sonst sperrte, wer fünfmal schreibt und löscht, den
  Verlauf für alle.
- **Autor:in und Erweitern (Review K2, K3):** Die Autor:in sieht eigene Beiträge in jedem Verlauf (auch `/p/<id>`).
  Sichtbarkeit bzw. „Sichtbar bis“ erweitern geht nur mit aktuellem Schreibrecht im Verlauf, einschränken immer.
- **Anhang (Review K5):** Ein angehängter Törn erscheint nur, wenn sein eigenes „Sichtbar bis“ die Stufe abdeckt, in der
  der Beitrag gerade gelesen wird (fail closed).
- **Hafen schreiben (B6):** Boot zählt als Eigner oder Boots-Admin; Anleger:in bzw. Vertretung und Moderation dürfen
  auch. Löschen eines Hafen- oder Boots-Beitrags: Autor:in (Pins und Moderation über das Menü folgen in Phase 3).
- **Ein Einstieg je Aufgabe (Leitlinie des Betreibers):** „+ Neu“ ersetzt „Track anlegen“, den runden Knopf und „Ins
  Fahrtenbuch eintragen“; „Mein Verlauf“ hat kein eigenes Schreibfeld mehr, die eigene Seite keine zweite Törn-Liste; das
  Konto-Menü ersetzt die Karte „Dein Bereich“. Gruppen-, Hafen- und Bootsseiten haben kein eigenes Schreibfeld mehr,
  sondern „Beitrag schreiben“ (öffnet „+ Neu → Text“ mit diesem Verlauf). Die große Einstiegskarte ohne Backend bleibt. „Ansehen als …“ hat ein Auge statt des
  Zahnrads; ein gemeinsames Seiten-Menü (Bearbeiten, Titelbild, Ansehen als, Melden) folgt.
- **Benachrichtigungen:** Reaktionen verlinken `/p/<id>`; neue Beiträge siehe 21.13 (F-416).
- Fotos an Beiträgen kommen mit Phase 7; Ablauffrist für Text-Beiträge weiter offen (21.11).

### 21.13 Umsetzung Phase 3: Pins, Benachrichtigungen, Seiten-Menü (02.11.2026)

Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“):

| Punkt | Pins (F-403) | Neue Beiträge (F-416) | Seiten-Menü (F-429) |
|---|---|---|---|
| Datenmodell | `channel_pins (channel_kind, channel_id, post_id → posts ON DELETE CASCADE, created_at)`, Migration `0031_channel_pins`, ohne Konto-ID | Art `post` in `notifications` (Gegenstand Beitrag), Kanal `off` in `notify_prefs` | – |
| Querschnitte | Sichtbarkeit: Karte über `postCard` mit Lese-Kontext des Verlaufs (dieselbe Prüfung wie der Stream); Cache: eigener, nie gecachter Abruf; Rechte: `canManageChannel` | Publikum nur Heimatverlauf (Gruppe ohne stumme, Hafen, Boot), Fan-out 200, Mail über Sammelmail | ersetzt Einzelknöpfe (Bearbeiten, Melden, Stumm, Austreten, Löschen, „Ansehen als …“) |
| Löschpfade | Beitrag → Cascade; Gruppe, Hafen, Boot, Konto → `channelPinsCleanup`; Häfen/Konten zusammengeführt → wandern; nächtlich verwaiste | wie alle Benachrichtigungen (Beitrag, Konto, nächtlich) | – |
| Komponenten | `sx-stream` (`pins`, `manage`, Knopf „Anpinnen“/„Lösen“), `sx-my-posts` („Im Profil anpinnen“), `controllers/pins.ts` | Einstellungen im Konto (`channelsFor`) | `sx-page-menu` (Muster `menuStyles`, mobil Sheet), `pageMenuReveal` |

Festlegungen:

- Angepinnt werden Text-Beiträge; Törns behalten ihre eigene Seite (Pins für Törns später).
- Pins stehen über dem Stream der Seite und zusätzlich an ihrer Stelle im Stream; „Lösen“ geht auch, wenn der Beitrag
  dort nicht mehr erscheint. Angezeigt werden die neuesten 50 Pins.
- Verwalter von Hafen (Anleger:in bzw. Vertretung, Moderation) und Boot (Eigner, Admins) löschen dort auch fremde
  Beiträge; ein eigenes „Ausblenden“ gibt es wie bei Gruppen nicht – dafür bleibt die Meldung an die Moderation.
- Neue Beiträge: eine Benachrichtigung je Beitrag (Link `/p/<id>`) statt einer gebündelten Zeile je Verlauf – sonst
  führte der Link nicht zur Karte; die Tagesgrenze (5 je Verlauf) begrenzt die Menge, Mails bündelt die Sammelmail.
- Fahrtenbuch-Bündel und Austritt bauen ihre Ziele aus derselben Funktion wie Törns (`shareTargetStmts`); Bündel zeigen im
  Hafen- und Community-Stream nur Einträge, deren „Sichtbar bis“ die Stufe abdeckt.
- Das Seiten-Menü führt kein „Titelbild“: es wird wie bisher direkt am Bild geändert.

### 21.10 Fragen an den Betreiber – entschieden 02.11.2026

1. **Wer schreibt in Gruppen?** Entschieden (B3): je Gruppe einstellbar, Standard Verein „nur Admins“, Team „alle
   Mitglieder“.
2. **„Nur Mitglieder“ kostenlos?** Entschieden (B4): ja, außer Törns (E1 bleibt).
3. **Galerie nur für Unterstützer?** Entschieden (B5): nein – für alle, kostenlos mit kleinem Kontingent, Speicher
   gemeinsam mit Fotos.
4. **Persönliche Beiträge in der Community?** Entschieden (B2): ja, öffentliche Beiträge breiten sich nach oben aus,
   begrenzbar über „Sichtbar bis“.
5. **Wer schreibt und pinnt im Hafen?** Entschieden (B6): schreiben alle mit Boot in diesem Heimathafen; pinnen
   Vertretung, Anleger:in, Moderation.
6. **Pins?** Entschieden (B1): in jedem Verlauf, unbegrenzt, nur manuell lösen.
7. **Check-in?** Entschieden (B7): entfällt, nur Zusage.
8. **Umfragen anonym?** Entschieden (B9): Standard anonym, „namentlich“ wählbar und nicht umstellbar.
9. **Zusatzpunkte?** Entschieden (B10, B11): als Posten in Vorlagen; alle Angaben sind Vorschläge und änderbar, die
   Vorlage je Eintrag entscheidet, was zählt.
10. **Berechnungsmodelle?** Entschieden (B11): Admin-Vorlagen, Vereine übernehmen/erweitern/eigene, Pflicht-Vorlage je
    Eintrag, Vereinsliste, Jahresbericht im Verwaltungsbereich.

Noch zu bestätigen bei der Umsetzung: Auslegung „Gewichtung nach Mitgliederzahl“ (21.6), genaue Kontingente (10/200
Fotos je Monat, 25 MB kostenlos), Schwellen der Tageszusammenfassung (150 Mitglieder, 15 Einträge/Tag) und des
Hinweises (100 Personen).

## 22. Gäste-Slider auf der Startseite (F-431, 02.11.2026)

Leitlinie „Weniger ist mehr, ein Weg nach Rom“: Gäste bekommen einen Einstieg statt zweier Karten. Der Slider ersetzt
„Mitmachen“ (F-261) und für Gäste die Karte „Eigenen Törn anlegen“; jede Folie führt über **einen** vorhandenen Weg
(+ Neu → GPX, Stream, Anmeldedialog, /entdecken) – es entsteht kein neuer Einstieg (UX-NAVIGATION N1).
Die vier Folien stellen die Alleinstellungsmerkmale aus 22.1 vor: (1) ausprobieren ohne App und Konto, (2) Revier mit
Vereinen, Häfen und echten Saison-Zahlen, (3) Fahrtenbuch, (4) wer was sieht – nur, was es schon und kostenlos gibt (keine
Vereinswertung, kein Jahresbericht).

### 22.1 Positionierung und Alleinstellungsmerkmale

Ton nach außen: deutsch, du-Form, sachlich-freundlich, ohne Superlative und ohne Vergleich mit anderen Produkten.

| Merkmal | Was es heißt | Wo es steht |
|---|---|---|
| Ohne App und Konto ausprobieren | GPX in den Browser ziehen, Auswertung sofort; Dateien bleiben lokal, bis man teilt (Security 1) | Startseite, „+ Neu → Törn (GPX)“, Slider Folie 1 |
| Lokale Strukturen mit Sichtbarkeit nach oben | Verein, Team, Hafen und Boot als eigene Seiten; Beiträge breiten sich vom Verlauf nach oben aus, begrenzt über „Sichtbar bis“ (Konzept 11–14, 21) | Gruppen-, Hafen-, Bootsseiten, Stream, Slider Folie 2 |
| Fahrtenbuch nach deutschem Muster | Törns mit oder ohne GPX, Seemeilen je Saison und Jahr, Meilensteine (Konzept 19) | Profil „Mein Fahrtenbuch“, Slider Folie 3 |
| Datenschutz als Prinzip | Stufen Öffentlich, Nur Mitglieder, Nur mit Link, Nur ich; Mitgliederinhalte nur für Mitglieder; Daten mit Ablaufdatum | Teilen-Dialog, Schreib-Dialog, Slider Folie 4 |
| Auswertung mit Wind und Wellen samt Teilen-Bild | Speed, Wind, Böen und Wellen zur Zeit des Törns, Bild zum Teilen | Törn-Ansicht, Teilen-Dialog |
| Deutsch und Binnenreviere zuerst | Oberfläche deutsch; Potsdam, Havel und Seen als Startrevier | Texte, Startseite |

### 22.2 Architektur-Skizze

Nach CLAUDE.md „Vor dem ersten Code“:

| Punkt | Festlegung |
|---|---|
| Datenmodell | nichts gespeichert, keine Migration; „Ausblenden“ nur im Gerät (`localStorage` `sx-guest-slider-dismissed`) |
| Querschnitte | Sichtbarkeit: `GET /api/discover/stats` nutzt `LISTED` aus `worker/discover.ts` (öffentlich, nicht ausgeblendet, Konto nicht gesperrt, `reachAtLeastSql(…, 'all')`) und `IN_LOGBOOK_SQL`; Saison = Kalenderjahr wie Gruppen- und Hafen-Kennzahlen (`seasonStart`, `src/domain/season-stats.ts`). Cache: für alle gleich, `public, max-age=600` plus Worker-Cache (Prinzip Erweitern 3). Vereine und Häfen aus dem vorhandenen `/api/discover` (mit Ort aus `near-prefs`, sonst alle). Keine Zähler, Benachrichtigungen, Einbettungen (`/embed` zeigt keine Startseite), Admin. |
| Lösch- und Sichtbarkeitspfade | nichts zu löschen; ausgeblendete, gemeldete, eingeschränkte oder gesperrte Inhalte fallen über `LISTED` sofort aus den Zahlen, spätestens nach 10 min Cache. Wer sieht es: nur Gäste mit Backend auf `/`; Angemeldete nie (Controller wartet auf `backendReady`). |
| Komponentenschnitt | `sx-guest-slider` (Properties `stats`, `groups`, `harbors`; Events `sx-compose-open` {gpx}, `sx-login`, `sx-guest-stream`, `sx-guest-dismiss`; Stile aus `base`/`coverBannerStyles`), `GuestSliderController` (Sichtbarkeit, Laden, Ausblenden, Scrollen), in `app.ts` nur erzeugt; Slot „join“ von `sx-empty-state`, das die kompakte Karte zeigt, sobald der Slot leer bzw. versteckt ist. 375 px: Seitenleiste steht über dem Stream, eine Folie je Breite (Scroll-Snap waagerecht), Bild höchstens 16 svh, gesamt ≤ ~60 % der Höhe, keine senkrechte Scroll-Ebene, Punkte ≥ 40 px auf Touch, Pfeile nur mit Maus. |
| Parallele Arbeit | `feature/beitraege-phase2` (PostLinkController, `app.ts`) – hier nur Verdrahtung in `app.ts`; sonst kein Branch an `sx-empty-state`, `worker/discover.ts`, `index.html`. |

Entfernt: `sx-join-card` (Vorteilsliste und „Anmelden & mitmachen“) samt Verdrahtung; die Liste der Unterstützer-Vorteile
steht weiter im Unterstützen-Bereich des Kontos.

## 23. Törn-Arbeitsbereich: genau ein Törn

Anlass: Rückmeldung des Betreibers (02.11.2026) – nach dem Abmelden erschien ein gespeicherter Törn als „Entwurf“,
neue GPX hingen sich an jeden offenen Törn (auch an fremde), und man sah nicht, in welchem Törn man ist. Leitlinie:
„Weniger ist mehr, ein Weg nach Rom.“ Anforderungen F-432 … F-439, geändert F-06, F-15, F-30, F-75, F-76, F-225, F-405.

### 23.1 Modell

Der Arbeitsbereich (Karte, Seitenleiste) zeigt immer **genau einen Törn**:

| Art | `State.mode` | Status in der Kopfzeile | GPX hinzufügen / entfernen | Gespeichert in |
|---|---|---|---|---|
| Entwurf | `local` | „Entwurf · nur dieses Gerät“, Titel = erster Track (sonst „Neuer Törn“) | ja (Track-Liste) | IndexedDB, **ein** Platz `current`, mit Eigentümer (`owner`: Konto-ID bzw. `guest`) |
| eigener gespeicherter Törn | `share`, `isOwner` | „Gespeichert · Öffentlich / Nur mit Link / Nur ich“ | nein (Server kann Tracks nicht ersetzen, 23.3) | D1/R2 (Konzept 21) |
| fremde bzw. geteilte Ansicht, Beispiel, `?track=`, `#g=` | `share` bzw. `link` | „Ansicht“ | nein | – |

- **Neuer Törn:** „+ Neu → Törn (GPX)“, die Startkarte ohne Community und Ziehen & Ablegen außerhalb des offenen
  Entwurfs beginnen einen neuen Entwurf und ersetzen den Arbeitsbereich. Liegt im Entwurfsplatz schon ein Entwurf mit
  Tracks, fragt nach der Dateiwahl ein Dialog „Entwurf ‚…‘ verwerfen und neuen Törn beginnen?“. Die Frage kommt erst
  nach der Wahl, weil der Browser die Dateiauswahl nur direkt aus dem Klick öffnet. So gilt die Frage für alle Wege.
- **Mehrere GPX:** nur über „GPX hinzufügen“ in der Track-Liste des offenen Entwurfs (oder durch Ablegen auf ihm).
- **Wechsel:** Ein anderer Törn (Stream, „Mein Verlauf“, Link) ersetzt den Arbeitsbereich. Der Entwurf bleibt im
  Entwurfsplatz, „+ Neu“ bietet dann „Entwurf fortsetzen: ‚…‘“. Das ist kein zweiter Einstieg (N1), weil er nur
  erscheint, wenn der Entwurf nicht offen ist.
- **Schließen (×):** leert den Arbeitsbereich und zeigt die Startseite. Ein Entwurf bleibt im Entwurfsplatz.
- **Verwerfen:** genau an einer Stelle, „Entwurf verwerfen“ unter der Track-Liste des offenen Entwurfs (mit Rückfrage).
- **Speichern:** Nach „Speichern“ bzw. „Speichern & Link erstellen“ wird aus dem Entwurf – ebenso aus einer Ansicht
  (Beispiel, `?track=`, `#g=`) – der eigene gespeicherte Törn (`mode: share`, Adresse `/s/<id>`). Ein gespeicherter
  Entwurf leert den Entwurfsplatz; eine gespeicherte Ansicht lässt einen anderen Entwurf stehen.
- **Abmelden (auch Konto löschen, Abmelden in einem anderen Tab):** Arbeitsbereich und Entwurfsplatz werden geleert
  (geteilter Rechner). Das Konto nennt bei „Abmelden“ den Entwurf, der dabei verworfen wird.
- **Eigentümer:** Der Entwurf merkt sich sein Konto bzw. `guest`. Beim Lesen (nach `/api/auth/me`) und bei jedem
  Wechsel der Anmeldung gilt: ein Gast-Entwurf geht an das angemeldete Konto über; ein Entwurf eines anderen Kontos –
  auch wenn die Sitzung ohne Abmelden endete (401, Ablauf, entfernt, auf einem anderen Gerät gelöscht) – wird verworfen.
- **Mehrere Tabs:** Nach jedem Schreiben meldet der Tab über den BroadcastChannel `sx-draft` „geändert“. Andere Tabs
  lesen den Entwurf neu; ist er dort offen, zeigen sie den neuen Stand bzw. leeren ihn, mit Hinweis. Es gibt also keinen
  stillen Rückschrieb eines veralteten Stands (der letzte Schreiber gewinnt, alle sehen ihn).
- **Start:** Der Entwurf wird einmal gelesen, sobald die Anmeldung bekannt ist (`init()`); neuer Törn, Ablegen und die
  Startseite warten darauf, damit die Nachfrage auch direkt nach dem Laden greift.
- **Beispiele** sind eine „Ansicht“ und überschreiben keinen Entwurf.

### 23.2 Skizze (CLAUDE.md)

| Punkt | Entscheidung |
|---|---|
| Datenmodell | nichts Neues: kein Server, keine Migration. `State` bekommt `draft` (Titel und Zahl der Tracks im Entwurfsplatz). |
| Querschnitte | keine Sichtbarkeit, kein Stream, kein Zähler. Abmelden ruft über einen Haken im `SessionController` den Arbeitsbereich. |
| Löschpfade | Entwurfsplatz: neuer Törn (nach Nachfrage), „Entwurf verwerfen“ (nach Nachfrage), letzter Track entfernt, Speichern, Abmelden bzw. Konto löschen, Sitzungsende bzw. anderes Konto (Eigentümer passt nicht), Website-Daten löschen. Sonst liegt nichts lokal. Datenschutz (`src/content/legal.ts`, Abschnitt 6) nennt diese Wege. |
| Komponenten | `WorkspaceController` (`src/controllers/workspace.ts`) übernimmt den Ablauf „Tracks“ aus `app.ts` (Laden, Wetter, Entwurf, Freigabe, Link). `sx-topbar` zeigt den Törn-Chip (Titel, Status, ×) als Property `toern`. `sx-compose` bekommt `draft` („Entwurf fortsetzen“). `sx-track-list` bekommt `addable` („GPX hinzufügen“) und Tippen zum Hervorheben. Neu ist `sx-confirm` (geteilte Rückfrage mit `dialogStyles`, mobil randlos, `ask({ … }): Promise<boolean>` für jeden Controller). `sx-account-dialog` bekommt `draft` (Hinweis bei „Abmelden“). Events: `sx-toern-close`, `sx-files-add`, `sx-draft-discard`, `sx-compose-open { kind: 'draft' }`. |
| 375 px | Der Chip sitzt wie bisher mittig unter der Kopfzeile über der Karte, mit Titel (gekürzt), kurzem Status und × (Tippfläche 44 px, auch am Desktop über einen unsichtbaren Rand). Auf der Startseite ist er ausgeblendet, dort zeigt der Reiter „Törn“ den Weg zurück. |
| Parallele Arbeit | `feature/beitraege-phase2` (PostLinkController: `openPost`/`revealAnchor` bleiben unberührt), `feature/gaeste-slider` (Startseite: hier nur der Link „weitere GPX hinzufügen“ in `sx-empty-state` gestrichen). |

### 23.3 Offen

- **Tracks an gespeicherten Törns ändern:** `PATCH /api/shares/:id` ersetzt die Nutzlast nur für Fahrtenbuch-Einträge
  ohne GPX (Route ≤ 32 KB). Für GPX-Törns gibt es keinen Weg, Tracks zu ersetzen oder zu ergänzen. Dafür bräuchte es
  Plausibilität, Speicherzähler-Differenz, Neuberechnung von Distanz und Zeit sowie Wetter, Fotos (Zeitbezug) und das
  Vorschaubild. Bis dahin gibt es „GPX hinzufügen“ nur im Entwurf.

## 24. Sichtbarkeit von Mitgliedschaften, Folgen und Benachrichtigungen

Anlass (Betreiber): Inhalte und Mitgliedschaften in Gruppen sollen ohne Mitgliedschaft nicht sichtbar sein; Folgen,
Mitgliedschaft und Benachrichtigen sind nicht sauber getrennt. Die Entscheidungen des Betreibers vom 02.11.2026
(verbindlich) sind eingearbeitet. Anforderungen F-440 … F-449. (Die Abschnitte 22 und 23 gehören parallelen Branches.)

### 24.1 Bestandsaufnahme: wo Mitgliedschaften und Gruppeninhalte nach außen sichtbar waren

| Stelle | Datei | Was | Wer sah es bisher | Jetzt |
|---|---|---|---|---|
| Mitgliederliste | `worker/groups.ts` `getGroup` | Namen mit öffentlichem Profil, „+ n weitere“ | alle, die die Gruppe sehen | F-441: je Einstellung, Standard nur Mitglieder |
| Boote der Gruppe | `worker/groups.ts` `getGroup` | öffentliche Boote (Boot → Eigner) | alle | F-442: wie Mitgliederliste |
| Teams eines Vereins, Verein eines Teams | `worker/groups.ts` `getGroup` | öffentliche Teams bzw. Verein | alle | unverändert: Gruppen mit eigener Sichtbarkeit, keine Personen |
| Kennzahlen, Titelbild | `getGroup`, `groupStats` | Zahlen | alle | unverändert (Betreiber: Zahlen bleiben) |
| Törns der Mitglieder im Gruppen-Stream, Galerie der Gruppe | `stream-shape.ts` (`voyage`, `photos`, `logbook`), `galleryPhotos` | öffentliche Törns, die in der Gruppe gezeigt werden | alle (auch im öffentlichen Cache, RSS) | F-442: bei Liste „nur Mitglieder“ nur für Mitglieder (24.7 Nr. 7); im Profil und in der Community bleibt der Törn öffentlich |
| Beitritte im Stream | `worker/stream-shape.ts` `case 'member'`, `worker/activity.ts` `recordMember` | „X ist beigetreten“, Spaßname je Konto gleich | Gäste (öffentlicher Gruppen-Stream, „Alles“, „Umgebung“, `?club=`, 60 s gecacht), Follower | F-443: nur Mitglieder derselben Gruppe |
| Boot in Gruppe im Stream | `stream-shape.ts` `case 'boat'` | „Neues Boot in …“ | wie Beitritte | F-442 |
| RSS | `worker/feed.ts`, `feed-xml.ts` | Beitritte mit Name/Spaßname, 600 s gecacht | alle | F-443: keine Beitritte |
| Community-Badge | `worker/stream.ts` `streamUnread` | zählte Beitritte gefolgter Gruppen | Follower | F-443, F-447 |
| „Mitglied von“ (Mein Verein) | `worker/home.ts` `publicHome`, `worker/profiles.ts` | Verein bei öffentlichem Profil | alle | F-444: nur Mitglieder desselben Vereins |
| Bootsseite „Verein des Boots“ | `worker/boats.ts` `getBoat` | öffentliche Vereine des Boots | alle | F-442 |
| Gruppen-Beiträge auf dem Profil | `worker/posts.ts` `visitorPosts` | öffentliche Beiträge öffentlicher Gruppen; „Nur Mitglieder“ nur für Mitglieder | je Sichtbarkeit | unverändert (bewusst öffentlicher Inhalt, Betreiber 2) |
| Törn „in Gruppe gezeigt“ | `worker/share-context.ts` | öffentliche Gruppen eines öffentlichen Törns | alle | F-442: Gruppen mit Liste „nur Mitglieder“ nur für ihre Mitglieder (24.7) |
| Vorschlag „im selben Verein“ | `worker/follows.ts` | Personen aus gemeinsamen Gruppen | nur Mitglieder selbst | unverändert |
| Wochenmail | `worker/group-digest.ts`, `mail.ts` | Anzahl neuer Mitglieder | Mitglieder | F-448: keine automatischen Zahlen |
| Benachrichtigungen | `worker/notifications.ts` | Beitrittsanfrage an Verwalter | Verwalter | unverändert, Stufen F-449 |
| Einladungs-Vorschau | `worker/invites.ts` `peek` | Gruppenname, Einladende:r | wer den Token hat | unverändert (gezielt eingeladen) |
| Link-Vorschau (OG) | `worker/index.ts` | Name, Beschreibung, Hafen | alle | unverändert, keine Mitglieder |
| Admin, Zusammenführen | `worker/admin.ts`, `admin-merge.ts` | Zähler, Vorschau | Plattform-Admins | unverändert; Merge übernimmt Stufen, löscht Folgen bei Mitgliedschaft |
| Spaßname | `src/domain/names.ts` | `funnyName(userId)` überall gleich | – | im Gruppen-Kontext `memberAlias(user, group)`: nicht über Gruppen und Crew (F-134) verknüpfbar |
| Gesperrte Gruppe im Stream | `stream.ts` `LEFT JOIN group_members` | Rolle trotz Sperre | Ex-Verwalter | Rolle nur ohne `locked_at` (wie `roleIn`, Konzept 18.2) |

### 24.2 Wer sieht was

| Objekt | Gast | angemeldet ohne Mitgliedschaft (auch Folgende) | Mitglied | Admin/Eigner der Gruppe | Plattform-Admin |
|---|---|---|---|---|---|
| Mitgliederliste (`members_visible = members`, Standard) | nur Anzahl | nur Anzahl | alle; Name bei öffentlichem Profil, sonst Spaßname | alle Anzeigenamen + IDs, nie E-Mail | wie angemeldet; Einblick im Admin-Bereich |
| Mitgliederliste (`public`) | Name bei öffentlichem Profil, sonst Spaßname | wie Gast | wie Gast | wie oben | wie angemeldet |
| Mitgliedsanzahl, Zahlen (Boote, Törns, Seemeilen) | ja | ja | ja | ja | ja |
| „Mitglied von“ im Profil, Beitritt im Stream | nie | nie | nur für dieselbe Gruppe | wie Mitglied | wie angemeldet |
| Beitrag öffentlich | ja (bei sichtbarer Gruppe), Ausbreitung je „Sichtbar bis“ | ja | ja | ja | ja |
| Beitrag „Nur Mitglieder“ | nie | nie | ja | ja | Moderation über Meldungen |
| Boote der Gruppe (Liste, „Verein des Boots“, Stream) | wie Mitgliederliste | wie Mitgliederliste | ja | ja (+ eigene Boote immer) | wie angemeldet |
| Törns, Fotos, Fahrtenbuch-Bündel der Mitglieder im Gruppen-Stream und in der Galerie; „In Gruppe gezeigt“ am Törn | wie Mitgliederliste | wie Mitgliederliste | ja | ja | wie angemeldet |
| Teams eines Vereins | öffentliche | öffentliche + eigene | öffentliche + eigene | wie Mitglied | wie angemeldet |

Plattform-Admins bekommen auf normalen Seiten keine zusätzlichen Namen (least privilege); was die Moderation braucht,
steht im Admin-Bereich (18.5) und in Meldungen.

### 24.3 Drei getrennte Achsen: Beziehung, Stream, Benachrichtigung

| Achse | Werte | Gespeichert | Regel |
|---|---|---|---|
| Beziehung | keine · Folgen · Beitritt angefragt · Mitglied | `follows`, `group_requests`, `group_members` | Folgen und Mitglied schließen sich aus; Anfrage ist ein eigener Zustand |
| Im persönlichen Stream | ja bei Folgen oder Mitgliedschaft – außer „Stumm“ | abgeleitet | `TARGET_SQL` (`notify_level IS NOT 'muted'`) |
| Benachrichtigung | Alle Beiträge · Wichtiges · Nur Direktes · Stumm | `group_members.notify_level` bzw. `follows.notify_level` | `shouldNotify` / `notifyLevelSql` |

Folgen ist keine Vorstufe: Folgende sehen nur Öffentliches (Interesse von außen), Mitglieder gehören dazu (Rechte,
„Nur Mitglieder“, Mitgliederliste). Beim Beitritt (`addMember`, Übergabe, Zusammenführen) fällt das Folgen weg, die
gewählte Stufe geht auf die Mitgliedschaft über. Beim Austreten fragt die Oberfläche bei öffentlichen Gruppen „Weiter
folgen?“ (Ja → Folgen mit „Nur Direktes“). Wer folgt und anfragt, folgt bis zur Aufnahme weiter.

Kopf je Seite (N5), Bausteine `sx-follow` + `sx-notify-bell`: Nicht-Mitglied [Folgen] [Beitreten/Anfragen] · Folgend
[✓ Folgst du ▾ Stufen, Entfolgen] [Beitreten] · Angefragt [Anfrage gestellt] [Zurückziehen] · Mitglied [Glocke ▾];
Austreten im Zahnrad (nicht doppelt).

### 24.4 Datenmodell (Migration `0032_members_visible.sql`; `0033_follows_cleanup.sql` nur Bereinigung, 24.7 Nr. 12)

| Spalte | Werte | Standard | Bestand |
|---|---|---|---|
| `groups.members_visible` | `members` · `public` | `members` | alle bestehenden Gruppen „nur Mitglieder“ (Betreiber 1) |
| `group_members.notify_level` | `all` · `important` · `direct` · `muted` · NULL | NULL = Voreinstellung des Kontos (`users.notify_prefs.level`, sonst `important`) | `muted_at` gesetzt → `muted`; `muted_at` wird danach nicht mehr gelesen |
| `follows.notify_level` | wie oben | NULL = `direct` (Folgende) | – |
| `users.notify_prefs.level` (JSON) | `all` · `important` · `direct` | `important` | wer „Neue Beiträge“ eingeschaltet hatte → `all` (nichts ändert sich still) |

Werte prüft der Worker (`isMembersVisible`, `isNotifyLevel`), kein `CHECK`. Der Kanal „Neue Beiträge“ (Glocke, Mail,
Push) bleibt; sein „Aus“ entfällt – ob überhaupt benachrichtigt wird, entscheidet die Stufe je Verlauf.

### 24.5 Querschnitte, Caches, Löschpfade

- **Eine Regel, ein Modul:** `canSeeMembers`, `canSeeMembership` (`src/domain/groups.ts`) = `membersVisibleSql`,
  `isMemberSql` (`worker/member-sql.ts`); `shouldNotify` (`src/domain/notifications.ts`) = `notifyLevelSql`,
  `followLevelSql` (`worker/notify-sql.ts`); `STREAM_KIND_CLASS`/`isAutomaticKind` für Beitrag oder automatisch. Tests
  halten Domain und SQL gleich (`test/functional/member-visibility.test.ts`, `test/notify-levels.test.ts`).
- **Prüfen beim Lesen, fail closed:** `shapeItem` (Beitritt nur mit Rolle in derselben Gruppe, Boot nur mit
  `canSeeMembers`), `getGroup`, `getProfile` (`isMemberSql`), `getBoat` (`membersVisibleSql`). Unbekannte Einstellung =
  „nur Mitglieder“, unbekannte Art = automatisch, unbekannte Stufe = Standard.
- **Caches (F-415):** Mitglieder-abhängige Antworten kommen nie aus dem öffentlichen 60-s-Cache. Gruppenseite, Profil und
  Bootsseite sind `no-store`; Gruppen-Streams für Mitglieder ungecacht; der öffentliche Cache (Gruppen-, Hafen-,
  Community-Stream, RSS) wird ohne Betrachter berechnet und enthält daher nie Beitritte. Boots-Einträge hängen dort nur
  an der (für alle gleichen) Einstellung der Gruppe; nach dem Umschalten wirkt der Cache nach höchstens 60 s (RSS 600 s).
- **Benachrichtigungen:** `notifyPost` (Text-Beitrag ab „Alle Beiträge“; Pin, Umfrage, Veranstaltung ab „Wichtiges“; an
  Mitglieder und – nur bei öffentlichen Beiträgen öffentlicher Gruppen – Follower; die Follower-Stufe zählt nur ohne
  Mitgliedschaft; Hafen und Boot: wer dort Boot bzw. Heimathafen hat und folgt, bekommt die höhere Stufe; beim Pin ist
  die Autor:in die handelnde Person, weder sie noch wer anpinnt wird benachrichtigt), `notifyShare` (Törn bzw.
  Fahrtenbuch-Eintrag als Beitrag: Mitglieder der gewählten Gruppen, deren Follower nur bei öffentlicher Gruppe und
  Liste, Eigner/Admins und Follower des Boots; beim ersten Erscheinen bzw. neu gewählten Gruppen, je Konto einmal je
  Törn; Fotos nie einzeln; Ausbreitung nie), `notifyRequest` (direkt, nicht bei „Stumm“ – außer der Eigner, wenn nur er
  bestätigen darf). Automatische Einträge rufen nie eine Benachrichtigung auf; die Wochenmail zählt keine Beitritte.
- **Altbestand:** Vor 0032 löschte ein Beitritt das Folgen nicht; 0032 entfernt solche Doppel, und Empfänger-Abfragen
  sowie die Übersicht werten die Follower-Stufe ohnehin nur ohne Mitgliedschaft.
- **Löschpfade:** alle neuen Werte hängen an bestehenden Zeilen und fallen mit ihnen: Austritt/Entfernen
  (`group_members`), Entfolgen (`follows`), Gruppe gelöscht (`removeGroup`), Konto gelöscht (Cascade/`purgeUserGroups`),
  Konten zusammengeführt (Stufen wandern mit, Folgen einer Gruppe, in der man Mitglied ist, fällt weg), Häfen
  zusammengeführt (Follows samt Stufe). Keine neuen Tabellen, keine R2-Daten, keine Zähler.
- **Parallele Arbeit:** Startseite (Slider) und Törn-Arbeitsbereich berühren diese Dateien nicht; `app.ts` nur zwei
  Event-Zeilen.

### 24.6 Beitrag oder automatisch, Glocke

| Art (`activity.kind`) | Klasse | Darstellung | Benachrichtigt |
|---|---|---|---|
| `voyage`, `logbook`, `post` | Beitrag | Karte | je Stufe (F-416, F-449; Törns über `notifyShare`) |
| `photos` | Beitrag | Karte | nie einzeln – nur als Teil des Törns |
| `member`, `boat`, `harbor`, `milestone` | automatisch | graue Systemzeile, ausblendbar | nie (F-448) |

Austritt, Team angelegt und Rollenwechsel erzeugen keine Stream-Einträge (Austritt löscht den Beitritt); kämen sie
dazu, wären sie „automatisch“ (Typprüfung über `STREAM_KIND_CLASS`). Der Schalter „Automatische Einträge“ (vorher
„Beitritte“, F-350) wirkt auf dem Gerät in allen Streams und im Badge (`?joins=0`).

`shouldNotify(level, event, isDirect)`: Stumm nie; automatisch nie; Direktes ab „Nur Direktes“; Wichtiges ab
„Wichtiges“; jeder Beitrag nur bei „Alle Beiträge“. Die Glocke (`sx-notify-bell` mit `MenuController`/`menuStyles`,
mobil als Sheet; Symbole Glocke, Glocke mit Punkt, kleine Glocke, durchgestrichen) steht für Mitglieder im Kopf der
Gruppenseite, für Folgende im Knopf „Folgst du ▾“ und in der Übersicht unter Konto → Einstellungen →
Benachrichtigungen (Mitgliedschaften und Folgen getrennt, mit Voreinstellung) – bearbeitet wird nur dort. Konto →
Gruppen zeigt die Stufe als Symbol mit Link zur Gruppe (UX N9, bewusste Ausnahme). Häfen und Boote ohne Folgen (eigenes Boot,
Heimathafen) nutzen die Voreinstellung des Kontos.

### 24.7 Entscheidungen des Betreibers (02.11.2026)

1. Plattform-Admins sehen verborgene Mitgliederlisten auf normalen Seiten nicht – nur im Admin-Bereich.
2. Die graue Systemzeile automatischer Einträge bleibt ohne Vorschaubild (F-213 zeigt im Stream damit derzeit kein
   Titelbild).
3. „Austreten“ bleibt im Zahnrad-Menü, kein zusätzlicher Knopf „Mitglied ▾“.
4. „In Gruppe gezeigt“ eines öffentlichen Törns (`shareContext`, F-228) nennt eine Gruppe mit Mitgliederliste „nur
   Mitglieder“ nur ihren Mitgliedern (`membersVisibleSql`, F-442) – sonst verriete der Törn die Mitgliedschaft der
   Eigentümer:in. Öffentliche Gruppen-Beiträge auf dem Profil bleiben (bewusster Inhalt).
5. Die Verzögerung durch öffentliche Caches nach dem Umschalten der Listen-Einstellung – Streams höchstens 60 s, RSS
   höchstens 600 s – ist akzeptiert.

6. Törns sind Beiträge und benachrichtigen je Stufe (`notifyShare`): beim ersten Erscheinen in einer gewählten Gruppe
   bzw. am Boot, bei „Alle Beiträge“; Fotos nur als Teil des Törns, die Ausbreitung nach oben nie, gebündelt je Törn.
7. In Gruppen mit Mitgliederliste „nur Mitglieder“ erscheinen Törns, Fotos und Fahrtenbuch-Bündel der Mitglieder im
   Gruppen-Stream und in der Galerie nur für Mitglieder (`ReadAt.memberContent`); Gäste und andere sehen dort nur
   öffentliche Text-Beiträge. Der öffentliche Cache (ohne Betrachter) enthält sie damit nie; der Törn bleibt im Profil
   und in der Community öffentlich.
8. Die Glockenstufe wird an genau zwei Stellen bearbeitet: am Objekt (Seitenkopf) und in Konto → Benachrichtigungen;
   Konto → Gruppen zeigt sie nur als Symbol mit Link. Vermerkt als Ausnahme von N9, „Folgst du ▾“ + „Beitreten“ als
   Ausnahme von N5 (UX-NAVIGATION).

9. Am Hafen bzw. Boot gewinnt ein ausdrücklich gesetztes „Stumm“ am Folgen immer; sonst gilt die höhere Stufe aus
   Voreinstellung (Boot bzw. Heimathafen dort) und Folgen.
10. Keine Flut: Nachträge (Abfahrt länger als 14 Tage zurück) benachrichtigen nie; je Empfänger:in höchstens 5
    Törn-Benachrichtigungen derselben Eigentümer:in am Tag (`NOTIFICATION_LIMITS.sharesPerDay`). Am Boot nur, wenn
    „Sichtbar bis“ den Hafen abdeckt (dieselbe Regel wie die Stream-Ziele); steigt die Stufe oder wechselt das Boot,
    wird erneut geprüft (je Konto einmal je Törn).
11. Persönlicher Stream über Folgen einer Gruppe mit Liste „nur Mitglieder“: nur öffentliche Text-Beiträge, keine Törns,
    Fotos oder Fahrtenbuch-Bündel (`MEMBER_CONTENT_KINDS`, Schlüssel mit „nur Text“ in `PERSONAL_SQL`/`UNREAD_SQL`) –
    auch nicht im Badge.
12. Migration `0033_follows_cleanup.sql` wiederholt die Bereinigung „Mitglied und Folgen“ aus 0032 für Datenbanken, auf
    denen die erste Fassung von 0032 schon lief (Vorschau); idempotent.

Noch offen: Umfragen und Veranstaltungen gibt es noch nicht; die Regel stuft sie als „wichtig“ ein, sobald sie kommen.

## 25. Anleitung „So zeichnest du deinen Törn auf“ (F-450, 02.11.2026)

Andere Apps zeichnen selbst auf; Luv & Leute lebt vom GPX-Import. Neue Nutzer:innen wissen oft nicht, womit sie
aufzeichnen und wie sie an eine GPX-Datei kommen. Leitlinie: „Weniger ist mehr, ein Weg nach Rom“ – je Weg wenige
Schritte, je Gerät eine Empfehlung.

### 25.1 Umsetzung

| Teil | Ort |
|---|---|
| Texte als Daten | `src/content/recording-guide.ts` (`RECORDING_GUIDE`, `RECORDING_GUIDE_PATH`) |
| Seite | `sx-guide-page` unter `/anleitung/aufzeichnen` (Route `guide`, wie `sx-legal-page` ohne Backend), Abschnitte als `<details>` |
| Einstiege | „+ Neu“-Sheet: Zeile unter „Törn (GPX)“; Startseite: Einstiegskarte ohne Track; Fußzeile „Anleitung“; später der Gäste-Slider (Konzept 22) |

Keine Daten, keine Querschnitte, kein Löschpfad. Offener Punkt: direkter Import von Garmin-`.ADM`-Dateien (spart den
Umweg über BaseCamp/HomePort) – eigener Auftrag.

### 25.2 Stand und Quellen der App-Angaben (geprüft 02.11.2026)

Wer die Anleitung ändert, prüft diese Angaben mit. „Belegt“ heißt: offizielle Seite oder Handbuch; „Forum“ heißt: nur
aus Foren bzw. Dritt-Anleitungen, daher in der Anleitung allgemein formuliert.

| Angabe | Beleg |
|---|---|
| OsmAnd (iOS/Android): Fahrtenaufzeichnung kostenlos (nur Topo, Relief, Wikipedia, Seekarte, Wetter kosten) | belegt: https://osmand.net/docs/user/plugins/ |
| OsmAnd: Aufzeichnung, Standard alle 5 s, Hinweise zu Akku-Optimierung und iOS-Hintergrund | belegt: https://osmand.net/docs/user/plugins/trip-recording |
| OsmAnd: Meine Orte → Tracks → ⋮ bzw. lange antippen → Teilen (GPX) | belegt: https://osmand.net/docs/user/personal/tracks/manage-tracks |
| Open GPX Tracker (iOS + Watch): kostenlos, Open Source, GPX teilen; Watch sendet Datei ans iPhone | belegt (Menüpfad nicht): https://apps.apple.com/de/app/open-gpx-tracker/id984503772, https://github.com/merlos/iOS-Open-GPX-Tracker |
| OpenTracks (Android): kostenlos, Open Source, Export GPX/KML/KMZ, Teilen mit Apps | belegt (Menüpfad nicht): https://f-droid.org/packages/de.dennisguse.opentracks/, https://codeberg.org/OpenTracksApp/OpenTracks |
| Geo Tracker (Android): GPX/KML/KMZ, Trip → Als Datei teilen; „Akkuoptimierungen ignorieren“ | belegt (Preis nicht): https://geo-tracker.org/en/docs/sharing/files/ – in der Anleitung nicht genannt |
| Garmin-Uhren: Aktivität „Segeln“ (z. B. fēnix 8, quatix 8, MARQ) | belegt: Garmin-Handbuch fēnix 8 (Link in der Anleitung) |
| Garmin Connect: GPX-Export nur im Web über Zahnrad | Forum: https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/84396/how-to-export-as-gpx-in-modern |
| WorkOutDoors (Apple Watch): kostenpflichtig, zeichnet ohne iPhone auf, Export GPX/FIT/TCX | belegt: https://apps.apple.com/us/app/workoutdoors/id1241909999 |
| Garmin GPSMAP: Weg zur Datenübertragung, `.ADM`, nur ACTIVE LOG mit Zeitstempel, Umwandlung mit BaseCamp/HomePort | geprüfte Anleitung des Betreibers (Notion „Garmin-Plotter: Daten exportieren und in GPX umwandeln“); Handbuch GPSMAP 800/1000 nennt den Weg, nicht das Format |
| Raymarine Axiom (LightHouse 4): Meine Daten → Import/Export → Meine Daten speichern → GPX auf microSD | belegt: https://docs.raymarine.com/81406/en-US/latest/SavingUserData-C80AD8A3.html; fehlende Zeitstempel nur laut Forum (2020) |
| B&G/Simrad/Lowrance: Track exportieren auf Karte/USB; GPX nicht belegt | daher nur allgemein („GPX wählen, sonst Handbuch“) |
| Navionics Boating: Tracks → Teilen → GPX, nur mit Abo | teilweise (Navionics-Blog, inzwischen auf garmin.com umgeleitet) |
| Strava: GPX-Export nur auf strava.com („…“ → Export GPX) | belegt: https://support.strava.com/hc/en-us/articles/216918437 |
| Komoot: Touren als GPX exportieren | teilweise: https://support.komoot.com/hc/en-us/articles/10115477099674 |
| Aufzeichnungsrate 1–5 s | Empfehlung des Betreibers, keine Herstellerangabe |

## 26. Diagramm-Großansicht: Zoomen und Verschieben (F-430) → [`docs/concept/26-diagramm-zoom.md`](concept/26-diagramm-zoom.md)

## 27. Verwaltungsbereich und Fahrtenbuch nach Jahren (Phase 8, F-411, F-412, F-418) → [`docs/concept/27-fahrtenbuch-jahre.md`](concept/27-fahrtenbuch-jahre.md)

## 28. Große Gruppen: Publikums-Hinweis und Tageszusammenfassung (F-465 … F-469) → [`docs/concept/28-grosse-gruppen.md`](concept/28-grosse-gruppen.md)

## 29. Umfragen (F-407, F-470 … F-478) → [`docs/concept/29-umfragen.md`](concept/29-umfragen.md)

## 30. Veranstaltungen (F-408, F-410, F-480 … F-489) → [`docs/concept/30-veranstaltungen.md`](concept/30-veranstaltungen.md)

## 31. Galerie-Beiträge: Fotos ohne Törn (Phase 7, F-490 … F-499) → [`docs/concept/31-galerie.md`](concept/31-galerie.md)

## 32. Wertung und Jahresbericht (Phase 9, F-413, F-414, F-418, F-500 … F-507) → [`docs/concept/32-wertung.md`](concept/32-wertung.md)
