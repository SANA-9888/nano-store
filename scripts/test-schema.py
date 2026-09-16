from pathlib import Path
import sqlite3
import time

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")

for path in sorted(Path("migrations").glob("*.sql")):
    sql = path.read_text(encoding="utf-8-sig")
    db.executescript(sql)

now = int(time.time() * 1000)

db.execute(
    "INSERT INTO admins(id,created_at) VALUES(?,?)",
    ("123456789", now)
)

db.execute("""
    INSERT INTO products(
      id,name,price,stock,published,
      low_stock_threshold,inventory_mode,
      created_at,updated_at
    ) VALUES('simple','Simple product',100,5,1,3,'simple',?,?)
""", (now, now))

db.execute("""
    INSERT INTO products(
      id,name,price,stock,published,inventory_mode,
      option_schema,created_at,updated_at
    ) VALUES(
      'variable','Variable product',200,0,1,'variants',
      '[{"name":"Color","values":["Red"]}]',?,?
    )
""", (now, now))

db.execute("""
    INSERT INTO variants(
      id,product_id,signature,options,stock,
      low_stock_threshold,created_at,updated_at
    ) VALUES(
      'red','variable','red','{"Color":"Red"}',2,2,?,?
    )
""", (now, now))

db.commit()


def order(order_id, product_id, variant_id, price, qty, mode):
    with db:
        db.execute("""
          INSERT INTO orders(
            id,request_id,request_hash,access_hash,code,
            name,phone,address,subtotal,shipping,discount,total,
            created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            order_id, "request-" + order_id, "hash", "access",
            "CODE-" + order_id, "Test Customer",
            "09123456789", "A complete test address",
            price * qty, 0, 0, price * qty, now, now
        ))

        db.execute("""
          INSERT INTO order_lines(
            id,order_id,product_id,variant_id,name,
            selection,price,quantity,inventory_mode
          ) VALUES(?,?,?,?,?,?,?,?,?)
        """, (
            "line-" + order_id, order_id, product_id, variant_id,
            "Snapshot", "{}", price, qty, mode
        ))


order("one", "simple", None, 100, 3, "simple")

assert db.execute(
    "SELECT stock FROM products WHERE id='simple'"
).fetchone()[0] == 2

assert db.execute(
    "SELECT COUNT(*) FROM notification_jobs WHERE kind='low_stock'"
).fetchone()[0] == 1

with db:
    db.execute("UPDATE orders SET status='cancelled' WHERE id='one'")

assert db.execute(
    "SELECT stock FROM products WHERE id='simple'"
).fetchone()[0] == 5

with db:
    db.execute("UPDATE orders SET status='cancelled' WHERE id='one'")

assert db.execute(
    "SELECT stock FROM products WHERE id='simple'"
).fetchone()[0] == 5

order("two", "variable", "red", 200, 1, "variants")

assert db.execute(
    "SELECT stock FROM variants WHERE id='red'"
).fetchone()[0] == 1

try:
    order("oversell", "variable", "red", 200, 2, "variants")
    raise AssertionError("Overselling was not rejected.")
except sqlite3.IntegrityError:
    pass

assert db.execute(
    "SELECT COUNT(*) FROM orders WHERE id='oversell'"
).fetchone()[0] == 0

assert db.execute(
    "SELECT stock FROM variants WHERE id='red'"
).fetchone()[0] == 1

with db:
    db.execute("UPDATE orders SET status='cancelled' WHERE id='two'")

assert db.execute(
    "SELECT stock FROM variants WHERE id='red'"
).fetchone()[0] == 2

order("paid", "simple", None, 100, 1, "simple")

with db:
    db.execute(
        "UPDATE orders SET payment_status='paid' WHERE id='paid'"
    )

try:
    with db:
        db.execute("UPDATE orders SET status='cancelled' WHERE id='paid'")
    raise AssertionError("Paid order cancellation was not rejected.")
except sqlite3.IntegrityError:
    pass

assert db.execute(
    "SELECT status FROM orders WHERE id='paid'"
).fetchone()[0] == "new"

print("PASS: Simple inventory reservation.")
print("PASS: Variant inventory reservation.")
print("PASS: Low-stock notification creation.")
print("PASS: Overselling rollback.")
print("PASS: Cancellation restores inventory exactly once.")
print("PASS: Paid-order cancellation guard.")
print("These tests do not replace remote D1 and browser integration tests.")

db.close()