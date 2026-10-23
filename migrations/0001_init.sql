-- Nutzer entstehen erst durch eine verifizierte E-Mail (Magic Link).
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  INTEGER NOT NULL,
  last_login  INTEGER
);

-- Es wird nur der SHA-256-Hash des Session-Tokens gespeichert.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Einmal-Tokens für Magic Links (ebenfalls nur als Hash).
CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX login_tokens_email ON login_tokens(email, created_at);

-- Metadaten geteilter Tracks; die GPX-Daten liegen gzip-komprimiert in R2 unter shares/<id>.
CREATE TABLE shares (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'unlisted' CHECK (visibility IN ('unlisted', 'private')),
  view        TEXT NOT NULL DEFAULT '',
  size_bytes  INTEGER NOT NULL,
  track_count INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX shares_user ON shares(user_id, created_at DESC);
