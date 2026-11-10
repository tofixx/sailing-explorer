-- Neubau von `comments` (Konzept 40, wie 0038 bei `photos`) – nur der Neubau, ohne neue Spalten: `share_id` wird
-- nullable, damit Kommentare an Beiträgen ohne Törn möglich werden (0049 ergänzt `post_id`). Spalten, Werte und
-- Indizes bleiben wie in 0009; alle Zeilen werden unverändert kopiert. Nichts verweist per Fremdschlüssel auf
-- `comments` (Meldungen polymorph). D1 erzwingt Fremdschlüssel, deshalb für den Neubau aufschieben (wie 0038).
PRAGMA defer_foreign_keys = true;

CREATE TABLE comments_new (
  id         TEXT PRIMARY KEY,
  share_id   TEXT REFERENCES shares(id) ON DELETE CASCADE,
  photo_id   TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  hidden_at  INTEGER,
  created_at INTEGER NOT NULL
);

INSERT INTO comments_new (id, share_id, photo_id, user_id, body, hidden_at, created_at)
SELECT id, share_id, photo_id, user_id, body, hidden_at, created_at FROM comments;

DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;

-- Indizes wie 0009
CREATE INDEX comments_share ON comments(share_id, created_at);
CREATE INDEX comments_user ON comments(user_id, created_at);
