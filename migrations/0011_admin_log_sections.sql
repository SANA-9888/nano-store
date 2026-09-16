-- New activity-log sections (users / security / system).
--
-- admin_logs.section carries a CHECK limited to catalog/orders.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt and
-- every stored log row is carried over (INSERT OR IGNORE keeps the
-- migration safely re-runnable if it is interrupted).

CREATE TABLE IF NOT EXISTS admin_logs_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  section TEXT NOT NULL
    CHECK(section IN ('catalog', 'orders', 'users', 'security', 'system')),
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- statement-breakpoint

INSERT OR IGNORE INTO admin_logs_v2(
  id,admin_id,section,action,target,detail,created_at
) SELECT
  id,admin_id,section,action,target,detail,created_at
FROM admin_logs;

-- statement-breakpoint

DROP TABLE admin_logs;

-- statement-breakpoint

ALTER TABLE admin_logs_v2 RENAME TO admin_logs;

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS admin_logs_admin
ON admin_logs(admin_id, created_at DESC);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS admin_logs_section
ON admin_logs(section, created_at DESC);
