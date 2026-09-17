ALTER TABLE orders
ADD COLUMN gateway TEXT NOT NULL DEFAULT '';

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS gateway_payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  gateway TEXT NOT NULL CHECK(gateway IN ('zarinpal','zibal')),
  authority TEXT NOT NULL CHECK(length(authority) BETWEEN 4 AND 128),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1000 AND 1000000000000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','verified','failed')),
  ref_id TEXT NOT NULL DEFAULT '',
  card_pan TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS gateway_payments_authority
ON gateway_payments(gateway, authority);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS gateway_payments_order
ON gateway_payments(order_id, created_at DESC);
