-- Einladung an ein bestehendes Konto über den Profilnamen (Konzept 10.1): gebunden an dieses Konto statt an eine
-- Adresse. Die Mail geht an die Adresse des Kontos, die der Einladende nie sieht.
ALTER TABLE invites ADD COLUMN invitee_id TEXT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX invites_invitee ON invites(invitee_id);
CREATE INDEX invites_email ON invites(email);
