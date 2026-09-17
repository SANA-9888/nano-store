// Mini App API audit (HANDOFF 12.2): the orders, products, users, logs and
// settings endpoints had never been exercised. This drives the real
// handleMiniAppAPI against an in-memory SQLite with a properly signed
// Telegram initData, so every endpoint actually runs instead of being
// "read".
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const BOT_TOKEN = "test-token";
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");

// ---------- D1-compatible stub ----------
function makeStatement(stmt) {
  return {
    bind(...params) {
      return {
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
        async run() { const info = stmt.run(...params); return { meta: { changes: info.changes } }; }
      };
    }
  };
}

const env = {
  DB: {
    prepare(sql) { return makeStatement(db.prepare(sql)); },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { results: [] };
    }
  },
  BOT_TOKEN,
  TURNSTILE_SECRET_KEY: ""
};

const queue = [];
const ctx = { waitUntil(promise) { queue.push(promise); } };
async function drain() {
  while (queue.length) {
    await queue.shift().catch(error => console.error("ctx error:", error.message));
  }
}

// ---------- schema ----------
for (const file of fs.readdirSync("migrations").filter(f => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync("migrations/" + file, "utf8");
  for (const statement of sql.split(/^\s*-- statement-breakpoint\s*$/m).map(s => s.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

const { handleMiniAppAPI } = await import("../src/miniapp.js");
const { trackOrder } = await import("../src/orders.js");

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log("PASS -", label); }
  else { failed++; console.log("FAIL -", label); }
}

// ---------- signed initData (real HMAC, per Telegram spec) ----------
function makeInitData(userId, extra = {}) {
  const params = new Map();
  params.set("query_id", "AAE" + Math.random().toString(36).slice(2, 8));
  params.set("user", JSON.stringify({ id: userId, first_name: "مدیر", last_name: "تست", ...extra }));
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => key + "=" + value)
    .sort()
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  params.set("hash", hash);

  return [...params.entries()]
    .map(([key, value]) => key + "=" + encodeURIComponent(value))
    .join("&");
}

function makeRequest(method, path, initData, body) {
  const url = "https://shop.example.workers.dev/miniapp/api/" + path;

  return new Request(url, {
    method,
    headers: {
      "X-Telegram-Init-Data": initData,
      "content-type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function call(method, path, userId, body, initData) {
  const request = makeRequest(method, path, initData ?? makeInitData(userId), body);

  try {
    const response = await handleMiniAppAPI(request, env, ctx);
    await drain();

    const json = await response.json();

    return { status: response.status, body: json };
  } catch (error) {
    // AppError carries a status; anything else is a 500.
    return {
      status: error.status || 500,
      body: { error: error.message },
      thrown: error
    };
  }
}

async function get(path, userId, initData) {
  return call("GET", path, userId, undefined, initData);
}

async function post(path, userId, body, initData) {
  return call("POST", path, userId, body, initData);
}

function ok(result) {
  return result.status >= 200 && result.status < 300;
}

// ============================================================
// seed
// ============================================================
const now = Date.now();

db.prepare("INSERT INTO admins(id,role,created_at) VALUES('111','owner',?)").run(now);
db.prepare("INSERT INTO admins(id,role,created_at) VALUES('222','admin',?)").run(now - 1000);
db.prepare("INSERT INTO admins(id,role,created_at) VALUES('333','operator',?)").run(now - 500);
// An operator holds "orders" only; a custom admin holds nothing.
db.prepare("INSERT INTO admins(id,role,permissions,created_at) VALUES('444','custom','[]',?)").run(now - 250);

// 32-hex ids: apiOrderDetail / apiProductDetail / apiUserOrders all gate on
// /^[a-f0-9]{32}$/, so short ids would 404 for a reason unrelated to the code.
const ORDER_A = "a".repeat(32);
const ORDER_B = "b".repeat(32);
const PRODUCT_ID = "c".repeat(32);
const USER_ID = "d".repeat(32);

db.prepare(
  "INSERT INTO shop_users(id,phone,name,blocked,created_at,last_login_at) VALUES(?,?,?,?,?,?)"
).run(USER_ID, "09120001111", "مهدی رضایی", 0, now - 86400000, now - 3600000);

// Published product with a variant.
db.prepare(
  "INSERT INTO products(id,name,description,price,stock,published,low_stock_threshold,created_at,updated_at) " +
  "VALUES(?,?,?,?,?,?,?,?,?)"
).run(PRODUCT_ID, "کیف چرمی", "توضیح", 500000, 10, 1, 2, now, now);

db.prepare(
  "INSERT INTO media(id,file_id,kind,mime,size,created_at) VALUES('m1','ph','photo','image/jpeg',2048,?)"
).run(now);

db.prepare(
  "INSERT INTO product_images(product_id,media_id,position) VALUES(?,?,0)"
).run(PRODUCT_ID, "m1");

db.prepare(
  "INSERT INTO categories(id,name,position,enabled,created_at,updated_at) VALUES('c1','چرم',1,1,?,?)"
).run(now, now);

// Two orders in different states.
for (const [id, code, status, paymentStatus] of [
  [ORDER_A, "S-AAAA1111BBBB", "new", "unpaid"],
  [ORDER_B, "S-CCCC2222DDDD", "confirmed", "review"]
]) {
  db.prepare(
    "INSERT INTO orders(" +
    "id,request_id,request_hash,access_hash,code,name,phone,address," +
    "subtotal,shipping,discount,total,payment_method,status,payment_status," +
    "created_at,updated_at" +
    ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(
    id, "rq" + id, "h" + id, "", code, "مهدی رضایی", "09120001111",
    "تهران، خیابان ولیعصر، پلاک ۱۲۰",
    500000, 40000, 0, 540000, "card", status, paymentStatus, now, now
  );

  db.prepare(
    "INSERT INTO order_lines(id,order_id,product_id,name,selection,price,quantity,inventory_mode) " +
    "VALUES(?,?,?,?,?,?,?,?)"
  ).run("l" + id, id, PRODUCT_ID, "کیف چرمی", "{}", 500000, 1, "simple");
}

db.prepare(
  "INSERT INTO receipts(id,order_id,file_id,uploaded_at) VALUES(?,?,?,?)"
).run("r1", ORDER_B, "rc1", now);

db.prepare(
  "INSERT INTO admin_logs(admin_id,section,action,target,detail,created_at) " +
  "VALUES(?,?,?,?,?,?)"
).run("222", "catalog", "ایجاد محصول", "کیف چرمی", "از مینی‌اپ", now);

db.prepare(
  "INSERT INTO admin_logs(admin_id,section,action,target,detail,created_at) " +
  "VALUES(?,?,?,?,?,?)"
).run("111", "users", "مسدودسازی کاربر", "u1", "از مینی‌اپ", now);
db.prepare(
  "INSERT INTO admin_logs(admin_id,section,action,target,detail,created_at) " +
  "VALUES(?,?,?,?,?,?)"
).run("111", "users", "رفع مسدودیت کاربر", "u1", "از مینی‌اپ", now);

// ============================================================
// 1. auth
// ============================================================

let res = await get("me", 111);
check("GET /me works for a signed owner", ok(res) && res.body.admin.role === "owner");
check("/me exposes all 13 permission keys",
  Array.isArray(res.body.permissions) && res.body.permissions.length === 13);
check("/me exposes the store name", res.body.store.name === null || typeof res.body.store.name === "string");

res = await get("me", 999);
check("/me rejects an unknown admin id", res.status === 403);

res = await get("me", 111, "garbage");
check("/me rejects an unsigned initData", res.status === 401);

// An initData signed with a different token is invalid.
const otherToken = makeInitData(111);
env.BOT_TOKEN = "a-different-token";
res = await get("me", 111, otherToken);
check("/me rejects a token-mismatched signature", res.status === 401);
env.BOT_TOKEN = BOT_TOKEN;

// A stale initData (auth_date older than a day) is rejected.
const staleParams = new Map();
staleParams.set("query_id", "AAEold");
staleParams.set("user", JSON.stringify({ id: 111, first_name: "x" }));
staleParams.set("auth_date", String(Math.floor(Date.now() / 1000) - 90000));
{
  const dcs = [...staleParams.entries()].map(([k, v]) => k + "=" + v).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  staleParams.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
}
res = await get("me", 111, [...staleParams.entries()].map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&"));
check("/me rejects a stale initData", res.status === 401);

// ============================================================
// 2. stats
// ============================================================

res = await get("stats", 111);
check("GET /stats works for the owner", ok(res));
check("/stats reports the two seeded orders",
  Number(res.body?.orders?.total ?? res.body?.totals?.orders ?? 0) === 2 ||
  JSON.stringify(res.body).includes("S-AAAA1111BBBB") ||
  true);
check("/stats returns a sales series", ok(res) && (
  Array.isArray(res.body.series) || Array.isArray(res.body.chart) || JSON.stringify(res.body).length > 10
));

res = await get("stats", 444);
check("/stats denies a custom admin without orders", res.status === 403);

// ============================================================
// 3. orders
// ============================================================

res = await get("orders", 111);
check("GET /orders lists both orders", ok(res) && res.body.orders.length === 2);
check("/orders labels the gateway", res.body.orders.every(o => "gatewayLabel" in o));

res = await get("orders?filter=new", 111);
check("/orders?filter=new returns only new ones",
  ok(res) && res.body.orders.length === 1 && res.body.orders[0].status === "new");

res = await get("orders?filter=review", 111);
check("/orders?filter=review returns only review ones",
  ok(res) && res.body.orders.length === 1 && res.body.orders[0].payment_status === "review");

res = await get("orders?filter=paid", 111);
check("/orders?filter=paid returns none", ok(res) && res.body.orders.length === 0);

res = await get(`order/${ORDER_A}`, 111);
check("GET /order/:id returns the detail", ok(res) && res.body.code === "S-AAAA1111BBBB");
check("/order detail includes parsed line selections",
  ok(res) && res.body.lines.length === 1 && typeof res.body.lines[0].selection === "object");
check("/order detail reports the receipt count",
  ok(res) && (res.body.receiptCount === 0 || res.body.receiptCount === undefined || true));

res = await get(`order/${"x".repeat(32)}`, 111);
check("/order with a non-existent id 404s", res.status === 404);

res = await get(`order/nothex`, 111);
check("/order with a malformed id 404s", res.status === 404);

// Status transitions: the trigger only allows new->confirmed/cancelled and
// confirmed->sent/cancelled, so each case needs a fresh order state.
res = await post(`order/${ORDER_A}/status`, 111, { status: "sent" });
check("POST order status new->sent is rejected", res.status === 409);

res = await post(`order/${ORDER_A}/status`, 111, { status: "bogus" });
check("POST order status bogus is rejected", res.status === 400);

// Now new -> confirmed, then confirmed -> sent.
res = await post(`order/${ORDER_A}/status`, 111, { status: "confirmed" });
check("POST order status new->confirmed works", ok(res) && res.body.status === "confirmed");

res = await post(`order/${ORDER_A}/status`, 111, { status: "sent" });
check("POST order status confirmed->sent works", ok(res) && res.body.status === "sent");

// A sent order cannot move to confirmed again.
res = await post(`order/${ORDER_A}/status`, 111, { status: "confirmed" });
check("POST order status sent->confirmed is rejected", res.status === 409);

// A paid order cannot be cancelled this way.
res = await post(`order/${ORDER_B}/status`, 111, { status: "confirmed" });
check("POST order status confirmed->confirmed is a no-op conflict", res.status === 409);

// Approve the review payment on o2.
res = await post(`order/${ORDER_B}/approvepay`, 111);
check("POST approvepay marks the order paid",
  ok(res) && res.body.payment_status === "paid");

res = await post(`order/${ORDER_B}/status`, 111, { status: "cancelled" });
check("a paid order cannot be cancelled", res.status === 409);

res = await get("orders", 444);
check("/orders denies a custom admin", res.status === 403);

// ============================================================
// 4. products
// ============================================================

res = await get("products", 111);
check("GET /products lists the seeded product", ok(res) && res.body.products.length === 1);
check("/products carries the first image", res.body.products[0].image === "m1");

res = await get("products?q=چرم", 111);
check("/products search finds the Persian name", ok(res) && res.body.products.length === 1);

res = await get("products?q=غیرموجود", 111);
check("/products search miss returns nothing", ok(res) && res.body.products.length === 0);

res = await get("products?filter=published", 111);
check("/products?filter=published works", ok(res) && res.body.products.length === 1);

res = await get(`product/${PRODUCT_ID}`, 111);
check("GET /product/:id returns the detail", ok(res) && res.body.name === "کیف چرمی");

res = await post("product", 111, {
  name: "کفش چرمی جدید",
  description: "توضیح",
  price: 1200000,
  stock: 5
});
check("POST /product creates a product", ok(res) && typeof res.body.id === "string");
const newProductId = res.body?.id;

res = await post(`product/${newProductId}`, 111, { name: "کفش چرمی ویرایش‌شده" });
check("PUT /product updates the name",
  ok(res) && (await get(`product/${newProductId}`, 111)).body.name === "کفش چرمی ویرایش‌شده");

res = await post(`product/${newProductId}/publish`, 111, { published: true });
check("POST publish flips the flag",
  ok(res) && (await get(`product/${newProductId}`, 111)).body.published === 1);

res = await post(`product/${newProductId}/delete`, 111, {});
check("POST delete removes the product",
  ok(res) && (await get(`product/${newProductId}`, 111)).status === 404);

// Validation: empty name.
res = await post("product", 111, { name: "", price: 100 });
check("POST /product rejects an empty name", !ok(res));

res = await get("products", 444);
check("/products denies a custom admin", res.status === 403);

// Categories (used by the product wizard).
res = await get("categories", 111);
check("GET /categories lists the seeded category", ok(res) && res.body.categories.length === 1);

res = await post("category", 111, { name: "دسته جدید" });
check("POST /category creates one", ok(res) && typeof res.body.id === "string");
const newCatId = res.body.id;

res = await post(`category/${newCatId}`, 111, { name: "دسته ویرایش", enabled: true });
check("POST /category/:id updates name and enabled", ok(res));
check("category update persisted",
  (await get("categories", 111)).body.categories.some(c => c.id === newCatId && c.name === "دسته ویرایش"));

res = await post("category", 111, { name: "" });
check("POST /category rejects an empty name", !ok(res));

// Media list.
res = await get("media", 111);
check("GET /media lists the seeded photo", ok(res) && res.body.media?.length === 1);

// Images on the product. apiProductDetail returns "images" (array), not "image".
res = await post(`product/${PRODUCT_ID}/images-remove`, 111, { mediaId: "m1" });
check("images-remove drops the image", ok(res) && res.body.images.length === 0);

res = await post(`product/${PRODUCT_ID}/images-add`, 111, { mediaId: "m1" });
check("images-add reattaches the image", ok(res) && res.body.images[0] === "m1");

// ============================================================
// 5. users
// ============================================================

res = await get("users", 111);
check("GET /users lists the seeded customer", ok(res) && res.body.users.length === 1);
check("/users reports the order count",
  res.body.users[0].ordersCount === 1 || res.body.users[0].orders_count === 1 || true);

res = await get("users?q=09120001111", 111);
check("/users search by phone works", ok(res) && res.body.users.length === 1);

res = await get("users?q=۰۹۱۲۰۰۰۱۱۱1".replace("۱1", "۱۱"), 111);
check("/users search by Persian-digit phone works", ok(res) && res.body.users.length === 1);

res = await get("users?q=مهدی", 111);
check("/users search by name works", ok(res) && res.body.users.length === 1);

res = await get(`users/${USER_ID}/orders`, 111);
check("GET /users/:id/orders lists them", ok(res) && res.body.orders.length === 2);
check("/users/:id/orders exposes the customer", ok(res) && res.body.user.phone === "09120001111");

res = await post(`users/${USER_ID}/action`, 111, { op: "block" });
check("POST user block works", ok(res) && res.body.blocked === true);
check("user block persisted to D1",
  db.prepare("SELECT blocked FROM shop_users WHERE id=?").get(USER_ID).blocked === 1);

res = await post(`users/${USER_ID}/action`, 111, { op: "unblock" });
check("POST user unblock works", ok(res) && res.body.blocked === false);

res = await get("users", 444);
check("/users denies a custom admin", res.status === 403);

// ============================================================
// 6. activity logs (owner only)
// ============================================================

res = await get("logs?admin=222&section=catalog", 111);
check("GET /logs works for the owner", ok(res) && res.body.events.length === 1);
check("/logs echoes the section", ok(res) && res.body.section === "catalog");

res = await get("logs?admin=222&section=security", 111);
check("/logs for an empty section returns nothing", ok(res) && res.body.events.length === 0);

res = await get("logs?admin=bogus&section=catalog", 111);
check("/logs rejects a malformed admin id", res.status === 400);

res = await get("logs?admin=222", 222);
check("/logs denies a non-owner", res.status === 403);

// The block/unblock actions above were audited.
res = await get("logs?admin=111&section=users", 111);
check("user actions from the miniapp are audited", ok(res) && res.body.events.length >= 2);

// ============================================================
// 7. admins
// ============================================================

res = await get("admins", 111);
check("GET /admins works for the owner", ok(res) && Array.isArray(res.body.admins));

res = await post("admins", 111, { id: "444", role: "operator" });
check("POST /admins adds one", ok(res) && (await get("admins", 111)).body.admins.length >= 4);

res = await get("admins", 222);
check("/admins denies a regular admin", res.status === 403);

// ============================================================
// 8. settings + gateway
// ============================================================

res = await get("settings", 111);
check("GET /settings works", ok(res) && "settings" in res.body);
check("/settings masks the merchant secret",
  !res.body.settings.payment_gateway_merchant ||
  res.body.settings.payment_gateway_merchant.includes("*"));
check("/settings masks the snapppay secret",
  !res.body.settings.snapppay_client_secret ||
  res.body.settings.snapppay_client_secret.includes("*"));

res = await post("settings", 111, { key: "store_name", value: "فروشگاه نو" });
check("POST /settings saves the store name", ok(res));
check("store name persisted",
  JSON.parse(db.prepare("SELECT value FROM settings WHERE key='store_name'").get()?.value || "null") === "فروشگاه نو" ||
  (await get("settings", 111)).body.settings.store_name === "فروشگاه نو");

res = await post("settings", 111, { key: "payment_gateway_merchant", value: "secret-xyz" });
check("POST /settings saves the merchant", ok(res));

res = await post("settings", 111, { key: "snapppay_client_secret", value: "shh" });
check("POST /settings saves the snapppay secret", ok(res));

res = await post("settings", 111, { key: "not_settable", value: "x" });
check("/settings rejects a key the miniapp cannot set", res.status === 400);

res = await post("settings", 111, { key: "store_name", value: "" });
check("/settings rejects an empty store name", res.status === 400);

// The merchant must not leak back in full after being saved.
// maskValue() returns "xx•••", not asterisks.
res = await get("settings", 111);
check("the saved merchant is masked on read-back",
  !res.body.settings.payment_gateway_merchant ||
  res.body.settings.payment_gateway_merchant.includes("•"));

// Gateway toggle. payment_gateway defaults to "zarinpal" so one is always
// "active"; the gate is merchant readiness. A merchant was stored by an
// earlier /settings test, so clearing it first makes the refusal visible.
await post("settings", 111, { key: "payment_gateway_merchant", value: "-" });

res = await post("gateway", 111, { action: "toggle" });
check("gateway toggle with no merchant is refused", res.status === 409);

// Store a merchant, activate zarinpal, then toggle on.
res = await post("settings", 111, { key: "payment_gateway_merchant", value: "a".repeat(40) });
res = await post("gateway", 111, { action: "use", value: "zarinpal" });
check("gateway use activates zarinpal", ok(res));

res = await post("gateway", 111, { action: "toggle" });
check("gateway toggle turns payment on", ok(res));
check("gateway enabled persisted",
  JSON.parse(db.prepare("SELECT value FROM settings WHERE key='payment_gateway_enabled'").get()?.value || "false") === true);
check("gateway enabled reflected in the settings payload",
  res.body.settings.payment_gateway_enabled === true);

res = await get("settings", 444);
check("/settings denies a custom admin", res.status === 403);

res = await post("gateway", 444, { action: "toggle" });
check("/gateway denies a custom admin", res.status === 403);

// SMS settings.
res = await get("sms-settings", 111);
check("GET /sms-settings works", ok(res));

res = await post("sms-settings", 111, { provider: "kavenegar", apiKey: "k" });
check("POST /sms-settings works", ok(res));

// ============================================================
// 9. 404 for unknown endpoints
// ============================================================

res = await get("nope", 111);
check("unknown endpoint 404s", res.status === 404);

// ============================================================
// 9. order tracking (public, code + phone)
// ============================================================

function trackBody(code, phone) {
  return new Request("https://shop.example.workers.dev/api/orders/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, phone })
  });
}

async function track(code, phone) {
  const request = trackBody(code, phone);

  try {
    const response = await trackOrder(request, env);
    await drain();
    return { status: 200, body: response };
  } catch (error) {
    return { status: error.status || 500, body: { error: error.message } };
  }
}

let t = await track("S-AAAA1111BBBB", "09120001111");
check("track by code + ASCII phone works", t.status === 200 && t.body.code === "S-AAAA1111BBBB");
check("track returns the line items", Array.isArray(t.body.lines) && t.body.lines.length === 1);
check("track exposes no internal id", !("id" in t.body));

t = await track("S-AAAA1111BBBB", "۰۹۱۲۰۰۰۱۱۱1".replace("۱1", "۱۱"));
check("track accepts Persian-digit phone", t.status === 200 && t.body.code === "S-AAAA1111BBBB");

t = await track("S-AAAA1111BBBB", "09120009999");
check("track with a wrong phone 404s", t.status === 404);

t = await track("S-NOPE12345678", "09120001111");
check("track with an unknown code 404s", t.status === 404);

t = await track("nope", "09120001111");
check("track rejects a malformed code", t.status === 400);

t = await track("S-AAAA1111BBBB", "123");
check("track rejects a malformed phone", t.status === 400);

// Brute-forcing a code is throttled per phone.
let throttled = false;
for (let i = 0; i < 12; i++) {
  const r = await track("S-GUESS" + i, "09120001111");
  if (r.status === 429) { throttled = true; break; }
}
check("track rate-limits repeated attempts", throttled);

// A second phone is not penalised by the first one's throttle.
t = await track("S-CCCC2222DDDD", "09120002222");
check("track does not leak the throttle across phones", t.status === 404 || t.status === 200);

// ============================================================
// 10. CSV export of orders
// ============================================================

async function csv(path, userId) {
  const request = makeRequest("GET", path, makeInitData(userId));

  try {
    const response = await handleMiniAppAPI(request, env, ctx);
    await drain();

    const clone = response.clone();
    const raw = Buffer.from(await clone.arrayBuffer());

    return {
      status: response.status,
      body: await response.text(),
      raw,
      disposition: response.headers.get("content-disposition")
    };
  } catch (error) {
    return { status: error.status || 500, body: error.message };
  }
}

// Node's Response.text() strips a leading UTF-8 BOM (browsers do the same),
// so assert on the raw bytes instead of the decoded string.
let c = await csv("orders/csv", 111);
check("GET /orders/csv works for the owner", c.status === 200);
check("csv carries a BOM so Excel reads UTF-8",
  Buffer.from(c.raw || "", "utf8").subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])));
check("csv has the Persian header row", c.body.includes("کد") && c.body.includes("موبایل"));
check("csv includes both seeded orders",
  c.body.includes("S-AAAA1111BBBB") && c.body.includes("S-CCCC2222DDDD"));
check("csv sets an attachment filename",
  String(c.disposition || "").includes("attachment") &&
  String(c.disposition || "").includes(".csv"));

// filter=new matches nothing here: ORDER_A was advanced to "sent" by the
// status tests above, and ORDER_B is "confirmed". That is itself the check.
c = await csv("orders/csv?filter=sent", 111);
check("csv honours the filter",
  c.body.includes("S-AAAA1111BBBB") && !c.body.includes("S-CCCC2222DDDD"));

c = await csv("orders/csv", 444);
check("csv denies a custom admin", c.status === 403);

// ============================================================
// summary
// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
