CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK(json_valid(value))
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS bot_panels (
  admin_id TEXT PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS bot_sessions (
  admin_id TEXT PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(json_valid(state)),
  expires_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS telegram_updates (
  id INTEGER PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'processing'
    CHECK(state IN ('processing', 'done')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 1 CHECK(hits >= 1),
  expires_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('photo', 'font')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 4194304),
  created_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  image_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS categories_display
ON categories(enabled, position, created_at);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'محصول جدید'
    CHECK(length(name) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT ''
    CHECK(length(description) <= 6000),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  price INTEGER NOT NULL DEFAULT 0
    CHECK(price BETWEEN 0 AND 1000000000000),
  stock INTEGER NOT NULL DEFAULT 0
    CHECK(stock BETWEEN 0 AND 1000000000),
  attributes TEXT NOT NULL DEFAULT ''
    CHECK(length(attributes) <= 6000),
  published INTEGER NOT NULL DEFAULT 0
    CHECK(published IN (0, 1)),
  low_stock_threshold INTEGER NOT NULL DEFAULT 0
    CHECK(low_stock_threshold BETWEEN 0 AND 1000000000),
  low_stock_cycle INTEGER NOT NULL DEFAULT 0
    CHECK(low_stock_cycle >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS products_catalog
ON products(published, created_at DESC);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS products_category
ON products(category_id, published, created_at DESC);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS product_images (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(product_id, media_id)
);

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS product_image_limit
BEFORE INSERT ON product_images
WHEN (
  SELECT COUNT(*)
  FROM product_images
  WHERE product_id = NEW.product_id
) >= 6
BEGIN
  SELECT RAISE(ABORT, 'Maximum 6 images per product.');
END;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS slides (
  id TEXT PRIMARY KEY,
  image_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT ''
    CHECK(length(title) <= 200),
  description TEXT NOT NULL DEFAULT ''
    CHECK(length(description) <= 500),
  button_text TEXT NOT NULL DEFAULT ''
    CHECK(length(button_text) <= 80),
  target_type TEXT NOT NULL DEFAULT 'none'
    CHECK(target_type IN ('none', 'category', 'url')),
  target_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  target_url TEXT NOT NULL DEFAULT ''
    CHECK(length(target_url) <= 2000),
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0
    CHECK(enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS slides_display
ON slides(enabled, position, created_at);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'نوشته جدید'
    CHECK(length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL DEFAULT ''
    CHECK(length(body) <= 12000),
  image_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  published INTEGER NOT NULL DEFAULT 0
    CHECK(published IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS posts_display
ON posts(published, created_at DESC);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS faqs (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL DEFAULT 'پرسش جدید'
    CHECK(length(question) BETWEEN 1 AND 250),
  answer TEXT NOT NULL DEFAULT ''
    CHECK(length(answer) <= 6000),
  position INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0
    CHECK(published IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE
    CHECK(length(code) BETWEEN 3 AND 32),
  type TEXT NOT NULL DEFAULT 'percent'
    CHECK(type IN ('percent', 'fixed')),
  amount INTEGER NOT NULL DEFAULT 10
    CHECK(amount BETWEEN 0 AND 1000000000000),
  minimum INTEGER NOT NULL DEFAULT 0
    CHECK(minimum BETWEEN 0 AND 1000000000000),
  max_uses INTEGER NOT NULL DEFAULT 0
    CHECK(max_uses >= 0),
  used INTEGER NOT NULL DEFAULT 0
    CHECK(used >= 0),
  expires_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 0
    CHECK(enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(type != 'percent' OR amount <= 100)
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
  phone TEXT NOT NULL,
  address TEXT NOT NULL CHECK(length(address) BETWEEN 10 AND 1500),
  postal TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 2000),
  subtotal INTEGER NOT NULL CHECK(subtotal >= 0),
  shipping INTEGER NOT NULL CHECK(shipping >= 0),
  discount INTEGER NOT NULL CHECK(discount BETWEEN 0 AND subtotal),
  total INTEGER NOT NULL
    CHECK(total = subtotal + shipping - discount),
  coupon_id TEXT REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_code TEXT NOT NULL DEFAULT '',
  coupon_version INTEGER,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new', 'confirmed', 'sent', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS orders_created
ON orders(created_at DESC);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS orders_status
ON orders(status, created_at);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS orders_phone
ON orders(phone, created_at DESC);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price >= 0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
  PRIMARY KEY(order_id, product_id)
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS notification_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL
    CHECK(kind IN ('order_new', 'order_reminder', 'low_stock')),
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  created_at INTEGER NOT NULL
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS notification_deliveries (
  job_id TEXT NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  PRIMARY KEY(job_id, admin_id)
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS notifications_pending
ON notification_deliveries(sent_at, next_attempt_at, lease_until);

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS validate_order_coupon
BEFORE INSERT ON orders
WHEN NEW.coupon_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1
  FROM coupons
  WHERE id = NEW.coupon_id
    AND enabled = 1
    AND version = NEW.coupon_version
    AND minimum <= NEW.subtotal
    AND (
      expires_at IS NULL
      OR expires_at > unixepoch() * 1000
    )
    AND (
      max_uses = 0
      OR used < max_uses
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Coupon is no longer available.');
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS reserve_order_coupon
AFTER INSERT ON orders
WHEN NEW.coupon_id IS NOT NULL
BEGIN
  UPDATE coupons
  SET used = used + 1
  WHERE id = NEW.coupon_id;
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS validate_order_item
BEFORE INSERT ON order_items
WHEN NOT EXISTS (
  SELECT 1
  FROM products
  WHERE id = NEW.product_id
    AND published = 1
    AND price = NEW.price
    AND stock >= NEW.quantity
)
BEGIN
  SELECT RAISE(ABORT, 'Product price or stock changed.');
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS reserve_order_stock
AFTER INSERT ON order_items
BEGIN
  UPDATE products
  SET stock = stock - NEW.quantity
  WHERE id = NEW.product_id;
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS validate_order_status
BEFORE UPDATE OF status ON orders
WHEN OLD.status != NEW.status
AND NOT (
  (
    OLD.status = 'new'
    AND NEW.status IN ('confirmed', 'cancelled')
  )
  OR
  (
    OLD.status = 'confirmed'
    AND NEW.status IN ('sent', 'cancelled')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid order status transition.');
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS restore_order_stock
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'cancelled'
AND OLD.status != 'cancelled'
BEGIN
  UPDATE products
  SET stock = stock + (
    SELECT quantity
    FROM order_items
    WHERE order_id = NEW.id
      AND product_id = products.id
  )
  WHERE id IN (
    SELECT product_id
    FROM order_items
    WHERE order_id = NEW.id
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS restore_order_coupon
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'cancelled'
AND OLD.status != 'cancelled'
AND NEW.coupon_id IS NOT NULL
BEGIN
  UPDATE coupons
  SET used = MAX(0, used - 1)
  WHERE id = NEW.coupon_id;
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS advance_low_stock_cycle
AFTER UPDATE OF stock, low_stock_threshold, published ON products
WHEN NEW.published = 1
AND NEW.low_stock_threshold > 0
AND NEW.stock < NEW.low_stock_threshold
AND NOT (
  OLD.published = 1
  AND OLD.low_stock_threshold > 0
  AND OLD.stock < OLD.low_stock_threshold
)
BEGIN
  UPDATE products
  SET low_stock_cycle = low_stock_cycle + 1
  WHERE id = NEW.id;
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS create_low_stock_notification
AFTER UPDATE OF low_stock_cycle ON products
WHEN NEW.low_stock_cycle > OLD.low_stock_cycle
BEGIN
  INSERT OR IGNORE INTO notification_jobs(
    id,
    kind,
    entity_id,
    payload,
    created_at
  )
  VALUES(
    'low-stock:' || NEW.id || ':' || NEW.low_stock_cycle,
    'low_stock',
    NEW.id,
    json_object(
      'product_id', NEW.id,
      'name', NEW.name,
      'stock', NEW.stock,
      'threshold', NEW.low_stock_threshold
    ),
    unixepoch() * 1000
  );
END;

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS create_notification_deliveries
AFTER INSERT ON notification_jobs
BEGIN
  INSERT OR IGNORE INTO notification_deliveries(
    job_id,
    admin_id,
    next_attempt_at
  )
  SELECT NEW.id, id, 0
  FROM admins;
END;