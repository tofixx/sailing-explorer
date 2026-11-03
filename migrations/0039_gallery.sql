-- Galerie-Beiträge (Konzept 31, Phase 7, F-490 … F-499): Fotos ohne Törn hängen an einem Beitrag (`posts.kind =
-- 'gallery'`). Genau eins von share_id/post_id ist gesetzt – geprüft im Worker (worker/post-photos.ts), kein CHECK
-- (Architektur 7). R2: photos/<postId>/<photoId>.webp bzw. _t.webp (worker/photo-keys.ts). Mit dem Beitrag fallen
-- die Zeilen per ON DELETE CASCADE; Dateien und Speicherzähler räumt vorher galleryPhotoCleanup auf.
ALTER TABLE photos ADD COLUMN post_id TEXT REFERENCES posts(id) ON DELETE CASCADE;
CREATE INDEX photos_post ON photos(post_id, created_at) WHERE post_id IS NOT NULL;

-- Monatskontingent (GALLERY_LIMITS): eine Zeile je hochgeladenem Galerie-Foto. Gelöschte Fotos geben nicht frei,
-- damit niemand rotiert; nächtlich nach 32 Tagen gelöscht, mit dem Konto per Cascade.
CREATE TABLE photo_log (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX photo_log_user ON photo_log(user_id, created_at);
