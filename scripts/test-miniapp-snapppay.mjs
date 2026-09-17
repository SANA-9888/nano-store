// Integration test: SnappPay gateway + admin Mini App API + custom permissions.
// Runs on real SQLite (node:sqlite) with a D1-compatible mock and mocked HTTP.
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");

// ---------- D1-compatible mock ----------
function makeStatement(stmt) {
  return {
    bind(...params) {
      return {
        async first() {
          return stmt.get(...params) ?? null;
        },
        async all() {
          return { results: stmt.all(...params) };
        },
        async run() {
          const info = stmt.run(...params);
          return { meta: { changes: info.changes } };
        }
      };
    }
  };
}

const sentMessages = [];

// Mirrors the bot_panels table: last panel message id per chat. The mock
// updates it on every sendMessage/editMessageText for that chat.
const panelIds = {};

const env = {
  DB: {
    prepare(sql) {
      return makeStatement(db.prepare(sql));
    },
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
  BOT_TOKEN: "123456:ABC-DEF_testtoken",
  TURNSTILE_SECRET_KEY: ""
};

const ctx = {
  waitUntil(promise) { queue.push(promise); }
};

const queue = [];
async function drain() {
  while (queue.length) await queue.shift().catch(error => console.error("ctx error:", error.message));
}

// ---------- mock fetch ----------
let snapTokenCalls = 0;
let snapInitResponse = () => ({ ok: true, paymentToken: "SNAPPTOKEN1234567890", paymentPageUrl: "https://pay.snapp-pay.ir/start/xyz" });
let snapVerifyResponse = () => ({ http: 200, body: { transactionId: "TRX-8899", amount: 3000000 } });

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  const body = options.body ? String(options.body) : "";

  if (target.includes("api.telegram.org")) {
    // URL shape: https://api.telegram.org/bot<TOKEN>/<Method>[?query]
    const method = target.split("/bot")[1].split("/").slice(1).join("/");
    let payload = {};
    try { payload = JSON.parse(body || "{}"); } catch {}

    // editMessageText returns the EDITED message (same id); sends get new ids.
    const isEdit = method.startsWith("editMessageText");
    const responseId = isEdit
      ? Number(payload.message_id || 0)
      : sentMessages.length + 100;

    if (method.startsWith("sendMessage") || method.startsWith("editMessageText")) {
      sentMessages.push({
        method: method.split("?")[0],
        chat_id: String(payload.chat_id ?? ""),
        text: String(payload.text ?? ""),
        message_id: responseId,
        keyboard: payload.reply_markup?.inline_keyboard || []
      });

      if (responseId) panelIds[String(payload.chat_id)] = responseId;
    }

    const result = method.startsWith("sendPhoto")
      ? { message_id: responseId, photo: [{ file_id: "small" }, { file_id: "agg-photo-" + responseId }] }
      : { message_id: responseId };

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (target.includes("/api/online/v1/oauth/token")) {
    snapTokenCalls++;
    if (!options.headers || !String(options.headers.authorization || "").startsWith("Basic ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    return new Response(JSON.stringify({ access_token: "SNAP-OAUTH-" + snapTokenCalls, expires_in: 1800 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (target.includes("/api/online/payment/v1/token")) {
    return new Response(JSON.stringify(snapInitResponse()), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (target.includes("/api/online/payment/v1/verify")) {
    const verdict = snapVerifyResponse();
    return new Response(JSON.stringify(verdict.body), {
      status: verdict.http,
      headers: { "content-type": "application/json" }
    });
  }

  if (target.includes("/api/online/payment/v1/settle")) {
    return new Response(JSON.stringify({ transactionId: "TRX-8899" }), { status: 200 });
  }

  throw new Error("Unexpected fetch: " + target);
};

// ---------- apply migrations ----------
const ORIGIN = "https://shop.example.com";

for (const file of fs.readdirSync("migrations").filter(f => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync("migrations/" + file, "utf8");
  for (const statement of sql.split(/^\s*-- statement-breakpoint\s*$/m).map(s => s.trim()).filter(Boolean)) {
    db.exec(statement);
  }
  console.log("migration applied:", file);
}

// ---------- imports ----------
const { createOrder } = await import("../src/orders.js");
const { startGatewayPayment, handleGatewayCallback } = await import("../src/payments.js");
const { setSetting } = await import("../src/db.js");
const { deliverNotifications } = await import("../src/telegram.js");
const { handleBot } = await import("../src/bot.js");
const { handleMiniAppAPI } = await import("../src/miniapp.js");

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log("PASS -", label); }
  else { failed++; console.log("FAIL -", label); }
}

// ---------- initData builder (Telegram WebAppData HMAC) ----------
function makeInitData(botToken, userId, firstName) {
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(Date.now() / 1000)));
  params.set("query_id", "AAF" + userId);
  params.set("user", JSON.stringify({ id: userId, first_name: firstName, added_to_attachment_menu: false }));

  const dataCheck = [...params.entries()]
    .map(([key, value]) => key + "=" + value)
    .sort()
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  params.set("hash", hash);

  return params.toString();
}

const OWNER_ID = 111;
const CUSTOM_ORDERS_ID = 222;
const CATALOG_ONLY_ID = 333;

function miniRequest(path, initData, options = {}) {
  const headers = { "X-Telegram-Init-Data": initData };
  if (options.body) headers["content-type"] = "application/json";
  if (options.raw) headers["content-type"] = options.rawType || "image/jpeg";

  return new Request(ORIGIN + "/miniapp/api/" + path, {
    method: options.method || "GET",
    headers,
    body: options.raw ? options.raw : options.body ? JSON.stringify(options.body) : undefined
  });
}

async function callAPI(path, initData, options) {
  // Mirror worker.js: AppError thrown by the handler is converted to a
  // JSON error response at the edge, so do the same in the harness.
  try {
    return await handleMiniAppAPI(miniRequest(path, initData, options), env, ctx);
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { "content-type": "application/json" }
      });
    }

    throw error;
  }
}

// ---------- seed ----------
const now = Date.now();

db.prepare("INSERT INTO admins(id,role,permissions,created_at) VALUES('111','owner','',?)").run(now);
db.prepare("INSERT INTO admins(id,role,permissions,created_at) VALUES('222','custom','[\"orders\"]',?)").run(now);

db.prepare(
  "INSERT INTO products(id,name,price,stock,published,inventory_mode,option_schema,created_at,updated_at) " +
  "VALUES('prod1','گیفت کاردستی',150000,100,1,'simple','[]',?,?)"
).run(now, now);

await setSetting(env, "site_url", ORIGIN);
await setSetting(env, "payment_gateway_enabled", true);
await setSetting(env, "payment_gateway", "snapppay");
await setSetting(env, "snapppay_username", "shop-user");
await setSetting(env, "snapppay_password", "shop-pass");
await setSetting(env, "snapppay_client_id", "shop-client");
await setSetting(env, "snapppay_client_secret", "shop-secret");

const initDataOwner = makeInitData(env.BOT_TOKEN, OWNER_ID, "Owner");
const initDataOrders = makeInitData(env.BOT_TOKEN, CUSTOM_ORDERS_ID, "Orders");
const initDataStranger = makeInitData(env.BOT_TOKEN, 999, "Stranger");

// ---------- 1. Mini App auth ----------
{
  const me = await (await callAPI("me", initDataOwner)).json();
  check("me: owner recognized with full perms", me.admin.id === "111" && me.admin.isOwner === true && me.admin.perms.length === 13);

  const stranger = await callAPI("me", initDataStranger);
  check("me: non-admin rejected 403", stranger.status === 403);

  const bad = await callAPI("me", makeInitData("wrong:token", OWNER_ID, "X"));
  check("me: wrong bot token signature rejected 401", bad.status === 401);
}

// ---------- 2. Snapppay full payment cycle ----------
const accessKey = "a".repeat(64);

const order = await createOrder(new Request(ORIGIN + "/api/orders", {
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify({
    requestId: crypto.randomUUID(),
    accessKey,
    name: "مشتری اسنپی",
    phone: "09121110000",
    address: "تهران، خیابان مینی‌اپ، پلاک ۶",
    postal: "",
    note: "",
    coupon: "",
    paymentMethod: "gateway",
    gateway: "snapppay",
    items: [{ productId: "prod1", variantId: "", selection: {}, quantity: 2 }]
  })
}), env, ctx);

check("snapppay order created", Boolean(order.id) && order.total === 300000);

const payStart = await startGatewayPayment(new Request(ORIGIN + "/api/pay/start", {
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json", "X-Order-Key": accessKey },
  body: JSON.stringify({ orderId: order.id, accessKey })
}), env, ctx);

check("snapppay start returns payment page url", payStart.redirect === "https://pay.snapp-pay.ir/start/xyz");
check("oauth token was requested", snapTokenCalls >= 1);

const paymentRow = db.prepare("SELECT * FROM gateway_payments WHERE order_id=?").get(order.id);
check("payment row stored with snapppay gateway + token authority",
  paymentRow && paymentRow.gateway === "snapppay" && paymentRow.authority === "SNAPPTOKEN1234567890" &&
  paymentRow.status === "pending");

// The return URL supplied to SnappPay must carry the row id.
const initBody = {};
// (captured indirectly through the callback below)

const callbackURL = new URL(ORIGIN + "/pay/callback?snapp=" + paymentRow.id);
const callbackResponse = await handleGatewayCallback(callbackURL, env, ctx);
const callbackHTML = await callbackResponse.text();

check("callback verified + success page", callbackHTML.includes("پرداخت موفق"));
check("verify used server-to-server call and settle ran", snapVerifyResponse().body.transactionId === "TRX-8899");

const settledRow = db.prepare("SELECT * FROM gateway_payments WHERE id=?").get(paymentRow.id);
check("payment verified with ref id", settledRow.status === "verified" && settledRow.ref_id === "TRX-8899");

const orderRow = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
check("order marked paid automatically", orderRow.payment_status === "paid");

await drain();
const settleNotify = [...sentMessages].reverse().find(message => message.text.includes("پرداخت آنلاین موفق"));
check("payment notification delivered", Boolean(settleNotify));
check("payment notification has mini app deep-link button",
  settleNotify && settleNotify.keyboard.some(row =>
    row.some(button => button.web_app && button.web_app.url.includes("/miniapp?order=" + order.id))));

// Replay is idempotent
const replay = await handleGatewayCallback(callbackURL, env, ctx);
check("callback replay renders success again", (await replay.text()).includes("قبلاً با موفقیت تأیید شده"));

// ---------- 3. New-order notification deep link ----------
await drain();
const orderNotify = sentMessages.find(message => message.text.includes("🛍 سفارش جدید"));
check("new order notification contains مشاهده سفارش web_app button",
  orderNotify && orderNotify.keyboard.some(row =>
    row.some(button => button.web_app && button.web_app.url.includes("/miniapp?order=" + order.id))));

// ---------- 4. Mini App order management (owner) ----------
{
  const list = await (await callAPI("orders?filter=all", initDataOwner)).json();
  check("orders list includes the order", list.orders.some(item => item.id === order.id));

  const detail = await (await callAPI("order/" + order.id, initDataOwner)).json();
  check("order detail has lines + receipt count", detail.code && detail.lines.length === 1 && detail.receiptCount === 0);

  const stats = await (await callAPI("stats", initDataOwner)).json();
  check("stats endpoint works", stats.orders.total >= 1 && stats.paidTotal === 300000);
}

// ---------- 5. Permission matrix over the Mini App ----------
{
  const products = await callAPI("products", initDataOrders);
  check("orders-only admin blocked from products (403)", products.status === 403);

  const orders = await (await callAPI("orders", initDataOrders)).json();
  check("orders-only admin can list orders", Array.isArray(orders.orders));

  const publish = await callAPI("product/prod1/publish", initDataOrders, { method: "POST", body: { published: true } });
  check("orders-only admin blocked from publish", publish.status === 403);

  const adminList = await callAPI("admins", initDataOrders);
  check("orders-only admin blocked from admins section", adminList.status === 403);

  const forbiddenGrant = await callAPI("admins", initDataOrders, {
    method: "POST", body: { id: "333", permissions: ["orders"] }
  });
  check("orders-only admin cannot create admins via API", forbiddenGrant.status === 403);
}

// Owner creates a catalog-only admin through the API (checkbox result)
{
  const created = await callAPI("admins", initDataOwner, {
    method: "POST", body: { id: CATALOG_ONLY_ID, permissions: ["products", "categories", "slider", "posts", "faq"] }
  });
  check("owner creates catalog-only admin", created.status === 200);

  const row = db.prepare("SELECT * FROM admins WHERE id=?").get("333");
  check("admin stored as custom with permissions json", row.role === "custom" && JSON.parse(row.permissions).join(",") === "products,categories,slider,posts,faq");

  const catalogProducts = await (await callAPI("products", makeInitData(env.BOT_TOKEN, CATALOG_ONLY_ID, "Cat"))).json();
  check("catalog-only admin can list products", Array.isArray(catalogProducts.products));

  const catalogOrders = await callAPI("orders", makeInitData(env.BOT_TOKEN, CATALOG_ONLY_ID, "Cat"));
  check("catalog-only admin blocked from orders", catalogOrders.status === 403);
}

// ---------- 6. Product wizard API (create → options → images → publish) ----------
{
  const created = await (await callAPI("product", initDataOwner, {
    method: "POST",
    body: { name: "شال مینی‌اپ", price: 98000, stock: 5, description: "توضیح", categoryId: null }
  })).json();

  check("product created as draft", /^[a-f0-9]{32}$/.test(created.id));

  const draftRow = db.prepare("SELECT published FROM products WHERE id=?").get(created.id);
  check("new product is unpublished", draftRow.published === 0);

  const updated = await (await callAPI("product/" + created.id, initDataOwner, {
    method: "POST", body: { price: 120000, name: "شال مینی‌اپ ویژه" }
  })).json();
  check("product update applies", updated.price === 120000);

  const withOptions = await (await callAPI("product/" + created.id + "/options", initDataOwner, {
    method: "POST", body: { mode: "variants", optionsText: "رنگ: سرمه‌ای\nکرم\n\nسایز: فری‌سایز" }
  })).json();
  check("options applied (variants schema)", withOptions.inventory_mode === "variants" && withOptions.option_schema.length === 2);
  check("variants generated with zero stock", withOptions.variants.length === 2 && withOptions.variants.every(v => v.stock === 0));

  // Variants with enabled combos (even at zero stock) publish — the same
  // rule as the bot toggle (shared validateProductPublish).
  const publishVariants = await callAPI("product/" + created.id + "/publish", initDataOwner, {
    method: "POST", body: { published: true }
  });
  check("variants product publishes with enabled combos", publishVariants.status === 200);

  // Blocked path: variants mode with an EMPTY options schema -> 409 Persian
  // error (state built directly in DB because the options API rejects it).
  db.prepare("UPDATE products SET inventory_mode='variants',option_schema='[]',published=0 WHERE id=?").run(created.id);
  const publishBlocked = await callAPI("product/" + created.id + "/publish", initDataOwner, {
    method: "POST", body: { published: true }
  });
  check("publish blocked for variants mode without options (409)", publishBlocked.status === 409);
  check("publish error is Persian guidance", (await publishBlocked.json()).error.includes("انتشار"));

  // Simple mode again → publish allowed
  await callAPI("product/" + created.id + "/options", initDataOwner, {
    method: "POST", body: { mode: "simple", optionsText: "" }
  });

  // Image upload through the media endpoint (mocked sendPhoto)
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const upload = await (await callAPI("media/upload", initDataOwner, {
    method: "POST", raw: jpeg
  })).json();
  check("image upload returns media id", /^[a-f0-9]{32}$/.test(upload.id));

  const withImage = await (await callAPI("product/" + created.id + "/images-add", initDataOwner, {
    method: "POST", body: { mediaId: upload.id }
  })).json();
  check("image attached to product", withImage.images.length === 1);

  const published = await (await callAPI("product/" + created.id + "/publish", initDataOwner, {
    method: "POST", body: { published: true }
  })).json();
  check("product published after full wizard", published.published === true);
}

// ---------- 6b. Per-variant stock editor API ----------
{
  const created = await (await callAPI("product", initDataOwner, {
    method: "POST",
    body: { name: "شال ترکیبی", price: 98000, stock: 0 }
  })).json();

  const withOptions = await (await callAPI("product/" + created.id + "/options", initDataOwner, {
    method: "POST", body: { mode: "variants", optionsText: "رنگ: سبز\nآبی" }
  })).json();

  const ids = withOptions.variants.map(v => v.id);
  check("two variants generated", ids.length === 2);

  const saved = await (await callAPI("product/" + created.id + "/variant-stock", initDataOwner, {
    method: "POST",
    body: { stocks: [{ id: ids[0], stock: 5 }, { id: ids[1], stock: 7 }] }
  })).json();

  const stocks = saved.variants.map(v => v.stock).sort((a, b) => a - b);
  check("per-variant stocks saved (dono-dono)", JSON.stringify(stocks) === JSON.stringify([5, 7]));

  const badStock = await callAPI("product/" + created.id + "/variant-stock", initDataOwner, {
    method: "POST",
    body: { stocks: [{ id: ids[0], stock: -3 }] }
  });
  check("negative variant stock rejected 400", badStock.status === 400);

  const logged = db.prepare(
    "SELECT COUNT(*) c FROM admin_logs WHERE admin_id=? AND section='catalog' AND target=''"
  ).get(String(OWNER_ID));
  check("variant stock edit recorded in audit log", logged.c >= 1);
}

// ---------- 6c. Owner-only activity log API ----------
{
  const now = Date.now();
  db.prepare(
    "INSERT INTO admin_logs(admin_id,section,action,target,detail,created_at) VALUES(?,?,?,?,?,?)"
  ).run(String(OWNER_ID), "catalog", "ایجاد محصول", "شال ترکیبی", "", now);
  db.prepare(
    "INSERT INTO admin_logs(admin_id,section,action,target,detail,created_at) VALUES(?,?,?,?,?,?)"
  ).run(String(CUSTOM_ORDERS_ID), "orders", "تایید پرداخت (دستی)", "TEST", "", now);

  const url = "logs?section=catalog&admin=" + OWNER_ID + "&page=0";
  const ownerView = await (await callAPI(url, initDataOwner)).json();
  // Catalog events for the owner include the wizard's create/publish
  // audits plus the 6b variant-stock edit and this one.
  check("owner reads catalog log", ownerView.events && ownerView.events.length >= 2 &&
    ownerView.events.some(e => e.action === "ایجاد محصول") &&
    ownerView.events.some(e => e.action.includes("موجودی ترکیب")) &&
    ownerView.hasMore === false);

  const ordersView = await (await callAPI("logs?section=orders&admin=" + CUSTOM_ORDERS_ID + "&page=0", initDataOwner)).json();
  check("owner reads orders log of other admin", ordersView.events.length === 1 && ordersView.events[0].action === "تایید پرداخت (دستی)");

  const denied = await callAPI("logs?section=catalog&admin=" + OWNER_ID + "&page=0", initDataOrders);
  check("non-owner blocked from logs 403", denied.status === 403);

  const badAdmin = await callAPI("logs?section=catalog&admin=abc&page=0", initDataOwner);
  check("invalid admin id rejected 400", badAdmin.status === 400);
}

// ---------- 7. Gateway settings via Mini App ----------
{
  // Disable gateway
  const toggled = await (await callAPI("gateway", initDataOwner, {
    method: "POST", body: { action: "toggle" }
  })).json();
  check("gateway disabled via API", toggled.settings.payment_gateway_enabled === false);

  // Re-enable (creds present)
  const reToggled = await (await callAPI("gateway", initDataOwner, {
    method: "POST", body: { action: "toggle" }
  })).json();
  check("gateway re-enabled with snapppay creds", reToggled.settings.payment_gateway_enabled === true);

  // Turn off first, then clear creds → enabling must be rejected with 409
  await callAPI("gateway", initDataOwner, { method: "POST", body: { action: "toggle" } });
  await setSetting(env, "snapppay_password", "");
  const enableBlocked = await callAPI("gateway", initDataOwner, { method: "POST", body: { action: "toggle" } });
  check("enabling snapppay without creds rejected", enableBlocked.status === 409);
  await setSetting(env, "snapppay_password", "shop-pass");

  await callAPI("gateway", initDataOwner, { method: "POST", body: { action: "toggle" } });
  check("gateway restored to enabled", (await (await callAPI("settings", initDataOwner)).json()).settings.payment_gateway_enabled === true);

  // Secret masking in the settings payload
  const settingsData = (await (await callAPI("settings", initDataOwner)).json()).settings;
  check("snapppay secrets masked", settingsData.snapppay_password.includes("••") && !settingsData.snapppay_password.includes("shop-pass"));
  check("client secret masked", !settingsData.snapppay_client_secret.includes("shop-secret"));

  // Settings whitelisting
  const settable = await callAPI("settings", initDataOwner, { method: "POST", body: { key: "turnstile_site_key", value: "x" } });
  check("non-whitelisted setting rejected", settable.status === 400);

  const named = await callAPI("settings", initDataOwner, { method: "POST", body: { key: "store_name", value: "فروشگاه مینی‌اپ" } });
  check("store_name updated via API", named.status === 200);
}

// ---------- 8. Order actions: transitions + guards ----------
{
  const accessKey2 = "b".repeat(64);
  const order2 = await createOrder(new Request(ORIGIN + "/api/orders", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      requestId: crypto.randomUUID(), accessKey: accessKey2,
      name: "مشتری دوم", phone: "09122220000", address: "اصفهان، تست، پلاک ۲",
      postal: "", note: "", coupon: "", paymentMethod: "contact",
      items: [{ productId: "prod1", variantId: "", selection: {}, quantity: 1 }]
    })
  }), env, ctx);

  const confirmed = await (await callAPI("order/" + order2.id + "/status", initDataOwner, {
    method: "POST", body: { status: "confirmed" }
  })).json();
  check("order confirmed via mini app", confirmed.status === "confirmed");

  const cancelled = await callAPI("order/" + order2.id + "/status", initDataOwner, {
    method: "POST", body: { status: "cancelled" }
  });
  check("cancel allowed for unpaid confirmed order", cancelled.status === 200);

  // Paid order cannot be cancelled
  const cancelPaid = await callAPI("order/" + order.id + "/status", initDataOwner, {
    method: "POST", body: { status: "cancelled" }
  });
  check("paid order cancel blocked (409)", cancelPaid.status === 409);

  // Invalid transition
  const badJump = await callAPI("order/" + order.id + "/status", initDataOwner, {
    method: "POST", body: { status: "sent" }
  });
  check("invalid transition rejected", badJump.status === 409);
}

// ---------- 9. Bot: owner-only deletion + subset rules ----------
let updateId = 1000;

function callbackUpdate(adminId, data, messageId) {
  return {
    update_id: ++updateId,
    callback_query: {
      id: "cb" + updateId,
      data,
      from: { id: adminId, is_bot: false, first_name: "Admin" },
      message: {
        message_id: messageId ?? panelIds[String(adminId)] ?? 1,
        chat: { id: adminId, type: "private" }
      }
    }
  };
}

function textUpdate(adminId, text) {
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      chat: { id: adminId, type: "private" },
      from: { id: adminId, is_bot: false, first_name: "Admin" },
      text
    }
  };
}

function lastBotMessage(adminId) {
  for (let index = sentMessages.length - 1; index >= 0; index--) {
    if (sentMessages[index].chat_id === String(adminId)) return sentMessages[index];
  }
  return null;
}

// Fresh panels so message ids line up
await handleBot(env, textUpdate(OWNER_ID, "/start"), ctx);
await drain();

// Custom orders-only admin taps the admins section
await handleBot(env, callbackUpdate(CUSTOM_ORDERS_ID, "admins"), ctx);
await drain();
check("bot blocks admins section for orders-only admin",
  lastBotMessage(CUSTOM_ORDERS_ID)?.text.includes("سطح دسترسی شما این بخش را شامل نمی‌شود") === true);

// Owner opens admins, tries to delete the only other admin (333) — allowed (2 admins exist)
await handleBot(env, callbackUpdate(OWNER_ID, "admins"), ctx);
await drain();

await handleBot(env, callbackUpdate(OWNER_ID, "deladmin:333"), ctx);
await drain();
check("owner sees delete confirmation", lastBotMessage(OWNER_ID)?.text.includes("حذف شود؟") === true);

// Non-owner taps the delete-confirm callback from their own panel — the
// permission gate blocks it before the owner-only handler can run.
await handleBot(env, callbackUpdate(CUSTOM_ORDERS_ID, "deladminyes:333"), ctx);
await drain();
check("non-owner delete attempt rejected", lastBotMessage(CUSTOM_ORDERS_ID)?.text.includes("سطح دسترسی شما این بخش را شامل نمی‌شود") === true);
check("admin 333 still exists", Boolean(db.prepare("SELECT id FROM admins WHERE id='333'").get()));

// Owner confirms deletion
await handleBot(env, callbackUpdate(OWNER_ID, "deladminyes:333"), ctx);
await drain();
check("owner deletes admin", !db.prepare("SELECT id FROM admins WHERE id='333'").get());

// Subset rule: custom orders-only admin cannot grant catalog via adminperm
await handleBot(env, textUpdate(CUSTOM_ORDERS_ID, "/start"), ctx);
await drain();

// Tapping their own checklist is blocked: the permission gate denies the
// "admins" section entirely for an orders-only admin.
await handleBot(env, callbackUpdate(CUSTOM_ORDERS_ID, "admincustom:222"), ctx);
await drain();
check("custom checklist opens for self-edit blocked", lastBotMessage(CUSTOM_ORDERS_ID)?.text.includes("سطح دسترسی شما این بخش را شامل نمی‌شود") === true);

// Owner opens custom checklist for admin 222 and grants catalog through adminperm
await handleBot(env, callbackUpdate(OWNER_ID, "admincustom:222"), ctx);
await drain();
check("owner sees custom checklist", lastBotMessage(OWNER_ID)?.text.includes("دسترسی سفارشی مدیر") === true);

await handleBot(env, callbackUpdate(OWNER_ID, "adminperm:222:products"), ctx);
await drain();
const granted = db.prepare("SELECT * FROM admins WHERE id='222'").get();
check("adminperm toggle persists custom grant", JSON.parse(granted.permissions).includes("products") && granted.role === "custom");

// Revoke again via the same toggle
await handleBot(env, callbackUpdate(OWNER_ID, "adminperm:222:products"), ctx);
await drain();
const revoked = db.prepare("SELECT * FROM admins WHERE id='222'").get();
check("adminperm toggle revokes", !JSON.parse(revoked.permissions).includes("products"));

// Owner-only: last owner demotion guard still active
await handleBot(env, callbackUpdate(OWNER_ID, "adminroleset:111:admin"), ctx);
await drain();
check("last owner cannot be demoted", lastBotMessage(OWNER_ID)?.text.includes("آخرین مدیر اصلی") === true);

// ---------- 10. Mini App disabled mode (notification fallback) ----------
{
  env.MINIAPP_ENABLED = "off";

  const accessKey3 = "c".repeat(64);
  const order3 = await createOrder(new Request(ORIGIN + "/api/orders", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      requestId: crypto.randomUUID(), accessKey: accessKey3,
      name: "مشتری سوم", phone: "09133330000", address: "شیراز، تست، پلاک ۳",
      postal: "", note: "", coupon: "", paymentMethod: "contact",
      items: [{ productId: "prod1", variantId: "", selection: {}, quantity: 1 }]
    })
  }), env, ctx);

  await drain();
  const fallbackNotify = [...sentMessages].reverse().find(message =>
    message.text.includes("🛍 سفارش جدید") && message.text.includes("S-"));

  const hasWebApp = fallbackNotify?.keyboard.some(row => row.some(button => button.web_app));
  const hasPanelButton = fallbackNotify?.keyboard.some(row =>
    row.some(button => button.callback_data === "home" && button.text.includes("پنل مدیریت")));

  check("disabled mini app: no web_app button", hasWebApp === false);
  check("disabled mini app: fallback پنل مدیریت button present", hasPanelButton === true);
  check("disabled order still created", Boolean(order3.id));

  delete env.MINIAPP_ENABLED;
}

// ---------- 11. Shop-users management API (permission: users) ----------
{
  const userId = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

  db.prepare(
    "INSERT INTO shop_users(id,phone,name,created_at,last_login_at) VALUES(?,?,?,?,?)"
  ).run(userId, "09122223344", "زهرا مشتری", now, now);

  // An order for this phone exists from section 2 (09121110000); create one
  // for this user's phone so the aggregate fields are non-zero.
  await createOrder(new Request(ORIGIN + "/api/orders", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      requestId: crypto.randomUUID(), accessKey: "d".repeat(64),
      name: "زهرا مشتری", phone: "09122223344", address: "اصفهان، تست، پلاک ۴",
      postal: "", note: "", coupon: "", paymentMethod: "contact",
      items: [{ productId: "prod1", variantId: "", selection: {}, quantity: 1 }]
    })
  }), env, ctx);

  const list = await (await callAPI("users", initDataOwner)).json();
  const listed = list.users.find(user => user.id === userId);
  check("users list includes seeded user with order stats",
    Boolean(listed) && listed.ordersCount >= 1);

  const search = await (await callAPI("users?q=09122223344", initDataOwner)).json();
  check("users search by phone works", search.users.length === 1 && search.users[0].phone === "09122223344");

  const deniedList = await callAPI("users", initDataOrders);
  check("users list denied without users perm 403", deniedList.status === 403);

  const blocked = await (await callAPI("users/" + userId + "/action", initDataOwner, {
    method: "POST", body: { op: "block" }
  })).json();
  check("user blocked", blocked.blocked === true);

  const afterBlock = await (await callAPI("users", initDataOwner)).json();
  check("blocked flag visible in list", afterBlock.users.find(user => user.id === userId).blocked === true);

  const orders = await (await callAPI("users/" + userId + "/orders", initDataOwner)).json();
  check("user orders endpoint returns profile + orders",
    orders.user.phone === "09122223344" && Array.isArray(orders.orders) && orders.orders.length >= 1);

  const badId = await callAPI("users/not-hex/orders", initDataOwner);
  check("invalid user id rejected 400", badId.status === 400);

  const unblocked = await (await callAPI("users/" + userId + "/action", initDataOwner, {
    method: "POST", body: { op: "unblock" }
  })).json();
  check("user unblocked", unblocked.blocked === false);

  const del = await (await callAPI("users/" + userId + "/action", initDataOwner, {
    method: "POST", body: { op: "delete" }
  })).json();
  check("user deleted", del.deleted === true);

  const gone = await (await callAPI("users", initDataOwner)).json();
  check("deleted user removed from list", !gone.users.some(user => user.id === userId));

  // The user actions were audited (section catalog, actions prefixed کاربران:)
  const audit = await (await callAPI(
    "logs?section=security&admin=" + OWNER_ID + "&page=0", initDataOwner
  )).json();
  check("user actions written to audit log",
    audit.events.some(event => event.action.includes("مسدودسازی کاربر")) &&
    audit.events.some(event => event.action.includes("حذف کاربر")));
}

// ---------- 12. SMS settings API (permission: sms) ----------
{
  const get = await (await callAPI("sms-settings", initDataOwner)).json();
  check("sms settings defaults to kavenegar", get.provider === "kavenegar" && get.providers.length === 3);

  const saved = await (await callAPI("sms-settings", initDataOwner, {
    method: "POST",
    body: { provider: "smsir", apiKey: "secret-sms-key", template: "1000123" }
  })).json();
  check("sms provider switched to sms.ir", saved.provider === "smsir");
  check("sms api key masked", saved.apiKeyMasked.includes("••") && !saved.apiKeyMasked.includes("secret-sms-key"));
  check("sms numeric template accepted", saved.template === "1000123");

  // Re-saving the masked placeholder must not destroy the real key.
  await callAPI("sms-settings", initDataOwner, {
    method: "POST", body: { apiKey: saved.apiKeyMasked }
  });

  const stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='sms_api_key'").get().value);
  check("masked save is a no-op", stored === "secret-sms-key");

  const badProvider = await callAPI("sms-settings", initDataOwner, {
    method: "POST", body: { provider: "unknown" }
  });
  check("unknown sms provider rejected 400", badProvider.status === 400);

  const denied = await callAPI("sms-settings", initDataOrders);
  check("sms settings denied without sms perm 403", denied.status === 403);
}

// ---------- 13. Stats sales chart + receipt auto-confirm + notification gating ----------
{
  const stats = await (await callAPI("stats", initDataOwner)).json();
  check("stats returns chart series for all ranges",
    Array.isArray(stats.chart.daily) && Array.isArray(stats.chart.weekly) &&
    Array.isArray(stats.chart.monthly));
  check("daily chart includes the paid snapppay sale",
    stats.chart.daily.some(item => item.amount >= 300000));
}

{
  // A card order with a pending receipt, already confirmed, gets shipped.
  const cardOrderId = crypto.randomUUID().replaceAll("-", "");
  const nowMs = Date.now();

  db.prepare(
    "INSERT INTO orders(id,request_id,request_hash,code,name,phone,address,subtotal,shipping,discount,total," +
    "status,payment_method,payment_status,created_at,updated_at) " +
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(cardOrderId, crypto.randomUUID(), "h".repeat(64), "AB12", "مشتری رسید",
    "09124440000", "تهران، خیابان رسید، پلاک ۳", 300000, 0, 0, 300000,
    "confirmed", "card", "review", nowMs, nowMs);

  db.prepare(
    "INSERT INTO order_lines(id,order_id,product_id,name,selection,price,quantity,inventory_mode) " +
    "VALUES(?,?,?,?,?,?,?,?)"
  ).run(crypto.randomUUID().replaceAll("-", ""), cardOrderId, "prod1",
    "گیفت کاردستی", "{}", 150000, 2, "simple");

  db.prepare(
    "INSERT INTO receipts(id,order_id,file_id,uploaded_at) VALUES(?,?,?,?)"
  ).run(crypto.randomUUID().replaceAll("-", ""), cardOrderId, "file-test-1", nowMs);

  const salesBefore = db.prepare("SELECT sales_count FROM products WHERE id='prod1'").get().sales_count;

  const shipped = await (await callAPI("order/" + cardOrderId + "/status", initDataOwner, {
    method: "POST", body: { status: "sent" }
  })).json();

  check("shipped card order auto-confirms the pending receipt",
    shipped.status === "sent" && shipped.payment_status === "paid");

  check("auto-confirm recorded in order_events",
    db.prepare("SELECT COUNT(*) AS c FROM order_events WHERE order_id=? AND kind='receipt_auto_confirmed'")
      .get(cardOrderId).c === 1);

  const salesAfter = db.prepare("SELECT sales_count FROM products WHERE id='prod1'").get().sales_count;
  check("auto-confirmed order counts towards sales", salesAfter === salesBefore + 2);

  // A non-card review order must NOT auto-confirm on ship.
  // (Gateway orders keep payment_method='contact' with the gateway column set.)
  const gwOrderId = crypto.randomUUID().replaceAll("-", "");
  db.prepare(
    "INSERT INTO orders(id,request_id,request_hash,code,name,phone,address,subtotal,shipping,discount,total," +
    "status,payment_method,gateway,payment_status,created_at,updated_at) " +
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(gwOrderId, crypto.randomUUID(), "g".repeat(64), "CD34", "مشتری درگاه",
    "09124440001", "تهران، خیابان درگاه، پلاک ۵", 150000, 0, 0, 150000,
    "confirmed", "contact", "zibal", "review", nowMs, nowMs);

  const shippedGateway = await (await callAPI("order/" + gwOrderId + "/status", initDataOwner, {
    method: "POST", body: { status: "sent" }
  })).json();
  check("gateway review order does not auto-confirm on ship",
    shippedGateway.status === "sent" && shippedGateway.payment_status === "review");
}

{
  // Notification gating: a new order's order_new message goes only to
  // admins holding the "orders" key (111 owner + 222 orders-only).
  const before = sentMessages.filter(m => m.text.includes("🛍 سفارش جدید") && m.chat_id === String(CATALOG_ONLY_ID)).length;

  await createOrder(new Request(ORIGIN + "/api/orders", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      requestId: crypto.randomUUID(), accessKey: "c".repeat(64),
      name: "مشتری گیت", phone: "09123330000", address: "تهران، خیابان گیت، پلاک ۱",
      postal: "", note: "", coupon: "", paymentMethod: "contact",
      items: [{ productId: "prod1", variantId: "", selection: {}, quantity: 1 }]
    })
  }), env, ctx);
  await drain();

  const gated = sentMessages.filter(m => m.text.includes("🛍 سفارش جدید") && m.chat_id === String(CATALOG_ONLY_ID));
  check("order notification NOT sent to admin without orders perm", gated.length === before);

  const ownerGot = sentMessages.some(m => m.text.includes("🛍 سفارش جدید") && m.chat_id === String(OWNER_ID));
  check("order notification reaches the owner", ownerGot);
}

// ---------- summary ----------
console.log("\n========================");
console.log("PASSED:", passed, "| FAILED:", failed);
console.log("========================");
process.exit(failed ? 1 : 0);
