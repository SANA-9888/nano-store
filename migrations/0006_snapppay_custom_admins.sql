-- Snapppay gateway support + per-admin custom permissions.
--
-- gateway_payments.gateway had a CHECK limited to zarinpal/zibal.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt and
-- every stored payment row is carried over (INSERT OR IGNORE keeps the
-- migration safely re-runnable if it is interrupted).

CREATE TABLE IF NOT EXISTS gateway_payments_v2 (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  gateway TEXT NOT NULL CHECK(gateway IN ('zarinpal','zibal','snapppay')),
  authority TEXT NOT NULL CHECK(length(authority) BETWEEN 4 AND 256),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1000 AND 1000000000000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','verified','failed')),
  ref_id TEXT NOT NULL DEFAULT '',
  card_pan TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

INSERT OR IGNORE INTO gateway_payments_v2(
  id,order_id,gateway,authority,amount,status,ref_id,card_pan,created_at,updated_at
) SELECT
  id,order_id,gateway,authority,amount,status,ref_id,card_pan,created_at,updated_at
FROM gateway_payments;

-- statement-breakpoint

DROP TABLE gateway_payments;

-- statement-breakpoint

ALTER TABLE gateway_payments_v2 RENAME TO gateway_payments;

-- statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS gateway_payments_authority
ON gateway_payments(gateway, authority);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS gateway_payments_order
ON gateway_payments(order_id, created_at DESC);

-- statement-breakpoint

-- Custom permission sets: a JSON array of permission keys. An empty
-- value means the legacy role defaults still apply; role='custom'
-- means only the keys stored here are granted.
ALTER TABLE admins
ADD COLUMN permissions TEXT NOT NULL DEFAULT '';
