-- Optional customer accounts (mobile + SMS OTP).
-- The whole feature lives in src/users.js and can be removed by
-- setting USERS_ENABLED=off; these tables stay harmless when unused.

CREATE TABLE IF NOT EXISTS shop_users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS user_otps (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS shop_users_login
ON shop_users(last_login_at DESC);
