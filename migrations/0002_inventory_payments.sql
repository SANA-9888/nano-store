ALTER TABLE products
ADD COLUMN inventory_mode TEXT NOT NULL DEFAULT 'simple'
CHECK(inventory_mode IN ('simple', 'shared', 'variants'));

-- statement-breakpoint

ALTER TABLE products
ADD COLUMN option_schema TEXT NOT NULL DEFAULT '[]'
CHECK(json_valid(option_schema));

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  options TEXT NOT NULL CHECK(json_valid(options)),
  price INTEGER CHECK(price BETWEEN 0 AND 1000000000000),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock BETWEEN 0 AND 1000000000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  low_stock_threshold INTEGER NOT NULL DEFAULT 0
    CHECK(low_stock_threshold BETWEEN 0 AND 1000000000),
  low_stock_cycle INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(product_id, signature)
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS variants_product
ON variants(product_id, enabled);

-- statement-breakpoint

ALTER TABLE orders
ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'contact'
CHECK(payment_method IN ('contact', 'card'));

-- statement-breakpoint

ALTER TABLE orders
ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
CHECK(payment_status IN ('unpaid', 'review', 'paid'));

-- statement-breakpoint

ALTER TABLE orders
ADD COLUMN access_hash TEXT NOT NULL DEFAULT '';

-- statement-breakpoint

ALTER TABLE orders
ADD COLUMN expires_at INTEGER;

-- statement-breakpoint

ALTER TABLE orders
ADD COLUMN paid_at INTEGER;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS bank_cards (
  id TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  card_number TEXT NOT NULL
    CHECK(length(card_number)=16 AND card_number NOT GLOB '*[^0-9]*'),
  label TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  file_id TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS receipts_order
ON receipts(order_id, uploaded_at DESC);

-- statement-breakpoint

DROP TRIGGER IF EXISTS validate_order_item;

-- statement-breakpoint

DROP TRIGGER IF EXISTS reserve_order_stock;

-- statement-breakpoint

DROP TRIGGER IF EXISTS restore_order_stock;

-- statement-breakpoint

DROP TABLE order_items;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT REFERENCES variants(id),
  name TEXT NOT NULL,
  selection TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(selection)),
  price INTEGER NOT NULL CHECK(price >= 0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
  inventory_mode TEXT NOT NULL
    CHECK(inventory_mode IN ('simple','shared','variants'))
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS order_lines_order
ON order_lines(order_id);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS order_lines_product
ON order_lines(product_id);

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS validate_order_item
BEFORE INSERT ON order_lines
WHEN NOT EXISTS (
  SELECT 1
  FROM products p
  WHERE p.id=NEW.product_id
    AND p.published=1
    AND p.inventory_mode=NEW.inventory_mode
    AND (
      (
        p.inventory_mode IN ('simple','shared')
        AND NEW.variant_id IS NULL
        AND p.stock>=NEW.quantity
        AND p.price=NEW.price
      )
      OR
      (
        p.inventory_mode='variants'
        AND EXISTS (
          SELECT 1
          FROM variants v
          WHERE v.id=NEW.variant_id
            AND v.product_id=p.id
            AND v.enabled=1
            AND v.stock>=NEW.quantity
            AND COALESCE(v.price,p.price)=NEW.price
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Product selection, price or stock changed.');
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS reserve_order_stock
AFTER INSERT ON order_lines
WHEN NEW.inventory_mode IN ('simple','shared')
BEGIN
  UPDATE products
  SET stock=stock-NEW.quantity
  WHERE id=NEW.product_id;
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS reserve_variant_stock
AFTER INSERT ON order_lines
WHEN NEW.inventory_mode='variants'
BEGIN
  UPDATE variants
  SET stock=stock-NEW.quantity
  WHERE id=NEW.variant_id;
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS restore_order_stock
AFTER UPDATE OF status ON orders
WHEN NEW.status='cancelled' AND OLD.status!='cancelled'
BEGIN
  UPDATE products
  SET stock=stock+(
    SELECT SUM(l.quantity)
    FROM order_lines l
    WHERE l.order_id=NEW.id
      AND l.product_id=products.id
      AND l.inventory_mode IN ('simple','shared')
  )
  WHERE id IN (
    SELECT product_id
    FROM order_lines
    WHERE order_id=NEW.id
      AND inventory_mode IN ('simple','shared')
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS restore_cancelled_variants
AFTER UPDATE OF status ON orders
WHEN NEW.status='cancelled' AND OLD.status!='cancelled'
BEGIN
  UPDATE variants
  SET stock=stock+(
    SELECT SUM(l.quantity)
    FROM order_lines l
    WHERE l.order_id=NEW.id
      AND l.variant_id=variants.id
  )
  WHERE id IN (
    SELECT variant_id
    FROM order_lines
    WHERE order_id=NEW.id AND variant_id IS NOT NULL
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS protect_reserved_product_structure
BEFORE UPDATE OF inventory_mode,option_schema ON products
WHEN (
  OLD.inventory_mode!=NEW.inventory_mode
  OR OLD.option_schema!=NEW.option_schema
)
AND EXISTS (
  SELECT 1
  FROM order_lines l
  JOIN orders o ON o.id=l.order_id
  WHERE l.product_id=NEW.id
    AND o.status IN ('new','confirmed')
)
BEGIN
  SELECT RAISE(ABORT, 'This product has active orders. Its option structure cannot change.');
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS protect_paid_order
BEFORE UPDATE OF status ON orders
WHEN NEW.status='cancelled'
AND OLD.status!='cancelled'
AND OLD.payment_status='paid'
BEGIN
  SELECT RAISE(ABORT, 'Paid orders require a separate refund workflow.');
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS protect_cancelled_payment
BEFORE UPDATE OF payment_status ON orders
WHEN NEW.payment_status='paid' AND OLD.status='cancelled'
BEGIN
  SELECT RAISE(ABORT, 'A cancelled order cannot be marked as paid.');
END;

-- statement-breakpoint

DROP TRIGGER IF EXISTS advance_low_stock_cycle;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS advance_low_stock_cycle
AFTER UPDATE OF stock,low_stock_threshold,published ON products
WHEN NEW.inventory_mode IN ('simple','shared')
AND NEW.published=1
AND NEW.low_stock_threshold>0
AND NEW.stock<NEW.low_stock_threshold
AND NOT (
  OLD.published=1
  AND OLD.low_stock_threshold>0
  AND OLD.stock<OLD.low_stock_threshold
)
BEGIN
  UPDATE products
  SET low_stock_cycle=low_stock_cycle+1
  WHERE id=NEW.id;
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS advance_variant_low_stock_cycle
AFTER UPDATE OF stock,low_stock_threshold,enabled ON variants
WHEN NEW.enabled=1
AND NEW.low_stock_threshold>0
AND NEW.stock<NEW.low_stock_threshold
AND NOT (
  OLD.enabled=1
  AND OLD.low_stock_threshold>0
  AND OLD.stock<OLD.low_stock_threshold
)
BEGIN
  UPDATE variants
  SET low_stock_cycle=low_stock_cycle+1
  WHERE id=NEW.id;
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS create_variant_low_stock_notification
AFTER UPDATE OF low_stock_cycle ON variants
WHEN NEW.low_stock_cycle>OLD.low_stock_cycle
BEGIN
  INSERT OR IGNORE INTO notification_jobs(
    id,kind,entity_id,payload,created_at
  )
  SELECT
    'variant-stock:' || NEW.id || ':' || NEW.low_stock_cycle,
    'low_stock',
    p.id,
    json_object(
      'product_id',p.id,
      'variant_id',NEW.id,
      'name',p.name,
      'selection',json(NEW.options),
      'stock',NEW.stock,
      'threshold',NEW.low_stock_threshold
    ),
    unixepoch()*1000
  FROM products p
  WHERE p.id=NEW.product_id
    AND p.published=1
    AND p.inventory_mode='variants';
END;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL,
  actor_id TEXT,
  created_at INTEGER NOT NULL
);