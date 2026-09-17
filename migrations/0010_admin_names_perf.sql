-- Admin display names + shop_users blocking + D1 read-performance indexes.
-- Names: owners can rename admins; logs show "name (id)" instead of raw ids.
-- Blocked: blocked shop_users cannot log in; existing sessions die instantly.
-- Indexes: cover the storefront sorts (popularity/price), the periodic
-- cleanup DELETEs and order_events idempotency lookups.

ALTER TABLE admins ADD COLUMN name TEXT NOT NULL DEFAULT '';

-- statement-breakpoint

ALTER TABLE shop_users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0
  CHECK(blocked IN (0, 1));

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS products_sales
ON products(published, sales_count DESC);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS products_price
ON products(published, price);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS admin_logs_created
ON admin_logs(created_at);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS user_otps_expiry
ON user_otps(expires_at);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS rate_limits_expiry
ON rate_limits(expires_at);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS bot_sessions_expiry
ON bot_sessions(expires_at);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS telegram_updates_cleanup
ON telegram_updates(state, updated_at);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS order_events_order
ON order_events(order_id, kind);
