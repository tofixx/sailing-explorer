-- Umfragen, Phase 4 (Konzept 21.5, 29, F-407, F-470 … F-478): eine Umfrage ist eine Art von `posts` (`kind = 'poll'`,
-- Frage im `body`, Antworten und Einstellungen in `data.poll`, geprüft vom Worker – kein CHECK). Neu sind nur die
-- Stimmen: eine Zeile je Konto und gewählter Antwort. Sie fallen per ON DELETE CASCADE mit dem Beitrag (jeder Löschweg
-- des Beitrags) und mit dem Konto der Wählenden. Additiv, ohne Altbestand.
CREATE TABLE poll_votes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id, choice)
);
-- Konto löschen (Cascade) und Zusammenführen lesen nach Konto
CREATE INDEX poll_votes_user ON poll_votes(user_id);
