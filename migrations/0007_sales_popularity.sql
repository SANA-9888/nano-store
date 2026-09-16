-- Sales counter per product for the "most popular" sorting option.
-- The counter is incremented once per order when its payment becomes
-- paid (manual approval or gateway settlement) and never decreases.

ALTER TABLE products
ADD COLUMN sales_count INTEGER NOT NULL DEFAULT 0
CHECK(sales_count >= 0);

-- statement-breakpoint

-- Backfill from existing paid, non-cancelled orders (re-runnable:
-- it always writes the absolute value, never an increment).
UPDATE products
SET sales_count = COALESCE((
  SELECT SUM(l.quantity)
  FROM order_lines l
  JOIN orders o ON o.id = l.order_id
  WHERE l.product_id = products.id
    AND o.payment_status = 'paid'
    AND o.status != 'cancelled'
), 0);
