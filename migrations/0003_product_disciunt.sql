ALTER TABLE products
ADD COLUMN original_price INTEGER
CHECK(
  original_price IS NULL
  OR (
    original_price BETWEEN 0 AND 1000000000000
    AND original_price >= price
  )
);

-- statement-breakpoint

ALTER TABLE settings
ADD COLUMN dummy_keep INTEGER NOT NULL DEFAULT 0;