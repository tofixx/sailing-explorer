-- Kommentare an allen Beiträgen und Benachrichtigung je Verlauf (Konzept 40, F-635 … F-644). Hängt von 0048 ab.
-- Ein Kommentar hängt an genau einem Verlauf: Törn (`share_id`) oder Beitrag ohne Törn (`post_id`) – prüft
-- worker/comments.ts, kein SQL-CHECK (Prinzip Architektur 7).
ALTER TABLE comments ADD COLUMN post_id TEXT REFERENCES posts(id) ON DELETE CASCADE;
CREATE INDEX comments_post ON comments(post_id, created_at);

-- Kommentar-Modus am Beitrag wie `shares.comments_mode`: on | off | hidden
ALTER TABLE posts ADD COLUMN comments_mode TEXT NOT NULL DEFAULT 'on';

-- Glocke je Verlauf: on = benachrichtigen, off = stumm (bleibt gemerkt, auch nach weiteren eigenen Kommentaren).
-- Eigentümer:in bzw. Autor:in ohne Zeile gilt als on. Genau eine der Spalten share_id/post_id ist gesetzt.
CREATE TABLE comment_subscriptions (
  share_id   TEXT REFERENCES shares(id) ON DELETE CASCADE,
  post_id    TEXT REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state      TEXT NOT NULL, -- on | off
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX comment_subs_share ON comment_subscriptions(share_id, user_id) WHERE share_id IS NOT NULL;
CREATE UNIQUE INDEX comment_subs_post ON comment_subscriptions(post_id, user_id) WHERE post_id IS NOT NULL;
CREATE INDEX comment_subs_user ON comment_subscriptions(user_id);

-- Altbestand: wer bisher als Mitkommentierende:r benachrichtigt wurde (nicht ausgeblendeter Kommentar, nicht die
-- Eigentümer:in des Törns), bleibt es – als ausdrückliche Zeile „on“ seit dem ersten Kommentar.
INSERT OR IGNORE INTO comment_subscriptions (share_id, post_id, user_id, state, created_at)
SELECT c.share_id, NULL, c.user_id, 'on', MIN(c.created_at)
FROM comments c JOIN shares s ON s.id = c.share_id
WHERE c.hidden_at IS NULL AND c.user_id <> s.user_id
GROUP BY c.share_id, c.user_id;
