-- Passkeys (Konzept 14.7): Anmeldung per Fingerabdruck, Face ID oder Geräte-PIN ohne Mail. Gespeichert wird nur der
-- öffentliche Schlüssel; die Mail bleibt für das erste Gerät und als Rückfallweg.
CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,           -- Credential-ID (base64url)
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL,              -- COSE-Schlüssel (base64url)
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT NOT NULL DEFAULT '',   -- kommagetrennt (internal, hybrid, usb …)
  name         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys(user_id);

-- Einmalige Challenges (5 min) für Registrieren und Anmelden.
CREATE TABLE webauthn_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  kind       TEXT NOT NULL,                -- register | login
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX webauthn_challenges_expires ON webauthn_challenges(expires_at);
