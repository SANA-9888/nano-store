-- Administrator activity log (anti-abuse audit trail).
-- Two human sections: catalog (products/content) and orders.
-- Rows are pruned after 90 days by scheduled maintenance.

CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  section TEXT NOT NULL CHECK(section IN ('catalog', 'orders')),
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS admin_logs_admin
ON admin_logs(admin_id, created_at DESC);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS admin_logs_section
ON admin_logs(section, created_at DESC);
