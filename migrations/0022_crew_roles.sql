-- Rollen am Törn und Bestätigung durch den Skipper (Konzept 15, F-275 … F-280).
-- Rollen skipper | co | crew | guest prüft src/domain/crew-roles.ts, kein SQL-CHECK (Prinzip Architektur 7).
-- Bestätigungen behalten ihren Zeitpunkt, wenn das bestätigende Konto gelöscht wird (confirmed_by → NULL).

-- Rolle eines Crew-Mitglieds und ob der Skipper sie bestätigt hat.
ALTER TABLE share_crew ADD COLUMN role TEXT NOT NULL DEFAULT 'crew';
ALTER TABLE share_crew ADD COLUMN confirmed_at INTEGER;
ALTER TABLE share_crew ADD COLUMN confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
-- Sicherheitsnetz zu „höchstens ein Skipper“ (geprüft wird in worker/crew-roles.ts in derselben Anweisung).
CREATE UNIQUE INDEX share_crew_one_skipper ON share_crew(share_id) WHERE role = 'skipper';

-- Rolle des Eigentümers (NULL = nicht angegeben) und ihre Bestätigung, wenn ein Crew-Mitglied Skipper ist.
ALTER TABLE shares ADD COLUMN owner_role TEXT;
ALTER TABLE shares ADD COLUMN role_confirmed_at INTEGER;
ALTER TABLE shares ADD COLUMN role_confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Rolle, die beim Annehmen einer Crew-Einladung gesetzt wird (NULL = crew).
ALTER TABLE invites ADD COLUMN role TEXT;
