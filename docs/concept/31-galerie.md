# 31. Galerie-Beiträge: Fotos ohne Törn (Phase 7, F-490 … F-499, 03.11.2026)

Teil des Konzepts (`docs/CONCEPT.md`, Abschnitt 31). Grundlage: Konzept 21.2 (Art `gallery`), 21.3.3 (Löschkonzept),
21.3.4 (Neubau `photos`, Kontingent), 21.4 (Plus-Knopf), 21.10 (Werte 10/200 Fotos je Monat). Leitlinie: „Weniger ist
mehr, ein Weg nach Rom“ – ein Galerie-Beitrag ist ein Text-Beitrag mit Fotos statt eines eigenen Objekts.

## 31.1 Architektur-Skizze (CLAUDE.md „Vor dem ersten Code“)

| Punkt | Entscheidung |
| --- | --- |
| Datenmodell | Neue Art `gallery` in `posts` (keine neue Inhaltstabelle). `photos` bekommt `post_id` (genau eins von `share_id`/`post_id`, geprüft im Worker). **Zwei Migrationen (R 4):** `0038_photos_rebuild.sql` baut `photos` nur neu (`share_id` nullable, sonst Spalten, Werte und Indizes unverändert, `PRAGMA defer_foreign_keys`); `0039_gallery.sql` ergänzt `photos.post_id → posts ON DELETE CASCADE`, Index `photos_post` und den Monatszähler `photo_log (user_id → users ON DELETE CASCADE, created_at)` |
| R2 | Gleiches Präfix, gleiche Schlüssel-Funktion: `photos/<postId>/<photoId>.webp` bzw. `_t.webp` (`photoKey(parentId, …)`, Eltern = Törn oder Beitrag). Gelöscht wird über die D1-Liste der Foto-IDs (wie bei Törns), nie über R2-`list` |
| Kontingent | `GALLERY_LIMITS` (`src/domain/limits.ts`): kostenlos **10**, Unterstützer **200** Galerie-Fotos je Kalendermonat (UTC), gezählt in `photo_log` – gelöschte geben nicht frei; höchstens **30** Fotos je Beitrag; kostenlos höchstens **25 MB** Galerie-Fotos. Speicher gemeinsam mit Törns und Törn-Fotos (`USER_BYTES_SQL` zählt alle Fotos des Kontos), Notbremse gilt. Fotos an Törns bleiben Unterstützern vorbehalten (E3). Grenzen atomar im `INSERT … SELECT … WHERE` (R 10) |
| Querschnitte | **Sichtbarkeit:** ein Galerie-Foto ist so sichtbar wie sein Beitrag (`visiblePost`, min(Beitrag, Verlauf)) und nicht ausgeblendet; Stream, Einzelkarte und Pins lesen die Fotos mit der Zeile (`GALLERY_PHOTOS_SQL` in `worker/stream.ts`, `publicSql()`), also vor dem Formen und nicht in `attachKindData` – eine Galerie ohne Foto ist keine Karte; die Fotos sind für alle gleich. **Cache:** Bild öffentlich 5 min nur, wenn ein Gast den Beitrag sehen dürfte, sonst `private, no-cache`; Streams wie bisher (60 s nur ohne Betrachter, „Nur Mitglieder“ nie). **Zähler:** `addPhotoStmt`/`subtractPhotoStmt` wie bei Törn-Fotos, Sammel-Abzug beim Löschen über den Beitrag. **Benachrichtigungen:** „neuer Beitrag“ erst beim ersten Foto (vorher ist die Karte leer). **Einbettung:** Link-Vorschau `/p/<id>` mit dem ersten Foto nur bei effektiv öffentlich. **Moderation:** Foto melden/ausblenden/löschen wie bei Törn-Fotos, Beitrag wie Text-Beiträge. **Zusammenführen:** Konten (`photos.user_id`, `photo_log`), Häfen (Beiträge wandern samt Fotos) |
| Komponenten | Erweiterungspunkte der Beitragsarten (Konzept 29), je eine Zeile: `COMPOSE_LIMITS` (Text optional: `bodyOptional`), `POST_KIND_LABEL`, `COMPOSE_KINDS.gallery.view` (Fotos aus der Zeile → `post.gallery`, ohne Foto keine Karte), `KINDS` in `sx-compose`, `KIND_FORMS` in `sx-compose-dialog` mit dem Formularteil `sx-gallery-picker` (Fotoauswahl, Kontingent, `sx-payload`), `kindPayload` in `sx-stream` → `sx-gallery-post` (Raster, Großansicht `sx-photo-lightbox` im Modus `post`), `POST_KIND_ICON`. „Mein Verlauf“ und Profil verlinken die Karte (`kindCardLink`, `hasKindCard`); `/p/<id>` im Profil öffnet die einzelne Karte. Hochladen im `ComposeController`: Beitrag anlegen, Fotos nacheinander verarbeiten (`processPhoto`) und hochladen; ohne ein einziges Foto wird der Beitrag wieder gelöscht. Mobil: Raster in voller Breite (2 Spalten), Tippziele ≥ 44 px |
| Parallele Arbeit | Umfragen (Konzept 29) sind gemergt und haben die Erweiterungspunkte geschaffen; `feature/veranstaltungen` ergänzt dieselben Stellen – je Art eine Zeile, Konflikte nur dort |

## 31.2 Löschwege (gespeichert → entfernt auf welchem Weg)

| Gespeichert | einzeln | Beitrag gelöscht | Gruppe gelöscht | Hafen / Boot gelöscht | Konto gelöscht / inaktiv | Zusammenführen | Moderation | Frist |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Galerie-Beitrag (`posts`, `kind = 'gallery'`) | `removePost` (Autor:in, Verwalter des Verlaufs) | – | `removeGroup` | `removeHarbor` / `removeBoat` (`channelPostsCleanup`) | `purgeUserGroups` | Konten: Autor:in wandert; Häfen: Verlauf wandert | `removePost` | ohne Fotos nach 24 h (`sweepEmptyGalleries`), sonst keine (wie Text, 21.11) |
| Foto-Zeile (`photos.post_id`) | `removePhoto` | `galleryPhotoCleanup` vor dem Löschen, sonst Cascade `post_id` | `galleryPhotoCleanup` | `galleryPhotoCleanup` | `purgeUser` (`photos.user_id`), fremde Fotos in eigenen Gruppen/Booten über deren Weg | `user_id` wandert | `removePhotoById` / Beitrag | mit dem Beitrag |
| R2 `photos/<postId>/…` | `removePhoto` | `galleryPhotoCleanup` | `galleryPhotoCleanup` | `galleryPhotoCleanup` | `purgeUser` (`photoKeysForUser`) | bleibt (Schlüssel enthält keine Konto-ID) | wie einzeln | mit dem Beitrag |
| Speicherzähler | `subtractPhotoStmt` | Sammel-Abzug in `galleryPhotoCleanup` | dito | dito | `subtractUserStmt` | unverändert | wie einzeln | nächtlich neu berechnet (`recomputeStorage`) |
| Reaktionen/Meldungen an Fotos | `removePhoto` | `galleryPhotoCleanup` | dito | dito | `userReactionCleanup`, `purgeUserReports` | – | – | Waisen nächtlich |
| Monatszähler `photo_log` | bleibt (gelöschte geben nicht frei) | bleibt | bleibt | bleibt | Cascade `users` + `purgeUser` | `mergeUsers` (wandert) | – | nach 32 Tagen |

Ein Test je Weg (F-494); Altbestand der Migration mit Test (F-490). Das Lösch-Register (`worker/cleanup-registry.ts`)
nennt `photo_log`, die Kaskade `photos → posts` und die neuen Wege für `photos/`.

## 31.3 Wer sieht es wo

| Wo | Wer sieht die Karte und ihre Fotos |
| --- | --- |
| Heimatverlauf (Profil, Gruppe, Hafen, Boot) | wie Text-Beiträge (F-402): „Öffentlich“ alle, die den Verlauf sehen; „Nur Mitglieder“ nur Mitglieder; „Nur mit Link“ nur mit Schlüssel (`/p/<id>/<schlüssel>`, Bilder mit `?k=`); „Nur ich“ die Autor:in |
| Ausbreitung (Verein, Hafen, Community) | nur öffentlich und bis „Sichtbar bis“ (F-409) |
| Bilder `GET /api/photos/<id>` | dieselbe Prüfung wie die Karte; öffentlicher Cache nur, wenn ein Gast sie sehen dürfte |
| „Mein Verlauf“ | die Autor:in immer, mit Link „Fotos öffnen“ zur Karte (dort auch „Foto löschen“) |
| Profil für Besucher | sichtbare Galerie-Beiträge (ohne Foto nicht) mit Link „Fotos öffnen“ zur einzelnen Karte |
| Galerien an Person, Boot, Gruppe (13.1) | unverändert nur Törn-Fotos |

## 31.4 Festlegungen

- **Ein Weg zum Anlegen:** „+ Neu → Fotos“. Die Galerie entsteht in zwei Schritten (Beitrag, dann Fotos) – ein
  Beitrag ohne Foto erscheint nirgends und benachrichtigt nicht; „neuer Beitrag“ geht genau einmal mit dem ersten Foto
  hinaus (Merker `notified` in `posts.data`, atomar gesetzt). Der nächtliche Lauf löscht Galerie-Beiträge
  ohne ein einziges Foto, die älter als 24 h sind (`emptyGalleries` in `worker/post-photos.ts` → `removePost`).
- **Text optional:** Galerie-Beiträge brauchen keinen Text; Bildunterschriften je Foto gibt es beim Anlegen nicht.
- **Einzelne Fotos löschen:** die Autor:in in der Großansicht der Karte („Foto löschen“, `DELETE /api/photos/:id`,
  derselbe Weg `removePhoto` wie bei Törn-Fotos), außerdem die Moderation. Das letzte Foto geht nur mit dem Beitrag
  (sonst bliebe eine leere Karte). Andere sehen statt „Foto löschen“ „Melden“ – entschieden nach Autor:in, nicht danach,
  wer den Beitrag löschen darf (Gruppen-Admins löschen den ganzen Beitrag).
- **Keine Ablauffrist** für Galerie-Beiträge in dieser Phase (Konzept 21.3.3 schlug „wie Fotos am Törn“ vor): ein Ablauf
  bräuchte Warn-Mails wie bei Törns; begrenzt sind Galerien durch das Monatskontingent und den Speicherdeckel. Offene
  Entscheidung des Betreibers.
- **Kalendermonat in UTC** wie die Saison (`seasonOf`).
- **Ort:** Galerie-Fotos haben keinen Ort (`placement = 'none'`, EXIF wird wie immer entfernt); die Aufnahmezeit bleibt.
- **Neubau `photos` (R 4):** Nichts verweist per Fremdschlüssel auf `photos` (`comments.photo_id`, Reaktionen und
  Meldungen sind polymorph). Der Neubau kopiert alle Zeilen unverändert; Speicherzähler und R2 bleiben unberührt
  (Test mit Altbestand: Zeilen, Spalten, Indizes, Zähler, Schlüssel, Kaskaden). Die Vorschau-Pipeline wendet beide
  Migrationen auf die gemeinsame Vorschau-Datenbank an.
