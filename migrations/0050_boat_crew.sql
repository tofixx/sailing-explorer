-- Stammcrew eines Boots (Konzept 41, F-270 … F-274). Eigene Tabelle statt einer Stufe in boat_admins: boat_admins
-- heißt an über 20 Stellen „darf verwalten“ – eine Stufe dort gäbe der Stammcrew still Verwalterrechte (fail closed).
-- Werte von crew_assign prüft src/domain/boat-crew.ts, kein CHECK (Architektur 7).
CREATE TABLE boat_crew (
  boat_id    TEXT NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',          -- frei benannter Titel ohne Rechte („Vorschoterin“, ≤ 40 Zeichen)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (boat_id, user_id)
);
CREATE INDEX boat_crew_user ON boat_crew(user_id);

-- Schalter des Eigners für die Stammcrew: Beiträge am Boot, weitere einladen, wer eigene Törns zuordnen darf.
ALTER TABLE boats ADD COLUMN crew_post INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boats ADD COLUMN crew_invite INTEGER NOT NULL DEFAULT 0;
-- crew_assign: crew | clubs | anyone
ALTER TABLE boats ADD COLUMN crew_assign TEXT NOT NULL DEFAULT 'crew';
