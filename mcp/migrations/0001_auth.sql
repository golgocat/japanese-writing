CREATE TABLE members (
  id TEXT PRIMARY KEY,
  invited_email TEXT NOT NULL UNIQUE,
  google_sub TEXT UNIQUE,
  last_email TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  skills_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_states (
  id_hash TEXT PRIMARY KEY,
  binding_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('google', 'consent')),
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_states_expiry ON auth_states(expires_at);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
