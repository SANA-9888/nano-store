// Integration test: full gateway payment flow over real SQLite + mocked HTTP.
import { DatabaseSync } from "node:sqlite";
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
  BOT_TOKEN: "test-token",
  TURNSTILE_SECRET_KEY: ""
};

const ctx = {
  waitUntil(promise) { queue.push(promise); }
};

const queue = [];
async function drain() {
  while (queue.length) await queue.shift().catch(error => console.error("ctx error:", error.message));
}

// ---------- mock fetch: telegram + zarinpal ----------
const telegramCalls = [];
let zarinpalRequestResponse = () => ({ ok: true, data: { code: 100, authority: "A00000000000000000000000000000000001" } });
let zarinpalVerifyResponse = () => ({ ok: true, data: { code: 100, ref_id: 123456, card_pan: "6219****1234" } });

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);

  if (target.includes("api.telegram.org")) {
    const payload = JSON.parse(options.body || "{}");
    telegramCalls.push({ method: target.split("/bot")[1], text: payload.text });
    return new Response(JSON.stringify({ ok: true, result: { message_id: telegramCalls.length } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (target.includes("zarinpal.com/pg/v4/payment/request.json")) {
    return new Response(JSON.stringify(zarinpalRequestResponse()), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }

  if (target.includes("zarinpal.com/pg/v4/payment/verify.json")) {
    return new Response(JSON.stringify(zarinpalVerifyResponse()), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }

  throw new Error("Unexpected fetch: " + target);
};

// ---------- apply migrations (same splitting as apply-migrations.mjs) ----------
const ORIGIN = "https://shop.example.com";

for (const file of fs.readdirSync("migrations").filter(f => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync("migrations/" + file, "utf8");
  for (const statement of sql.split(/^\s*-- statement-breakpoint\s*$/m).map(s => s.trim()).filter(Boolean)) {
    db.exec(statement);
  }
  console.log("migration applied:", file);
}

// ---------- module imports (after env ready) ----------
const { createOrder } = await import("../src/orders.js");
const { startGatewayPayment, handleGatewayCallback } = await import("../src/payments.js");
const { handleBot } = await import("../src/bot.js");
const { setSetting } = await import("../src/db.js");

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log("PASS -", label); }
  else { failed++; console.log("FAIL -", label); }
}

// ---------- seed: admin + product + settings ----------
db.prepare("INSERT INTO admins(id,created_at) VALUES('111',?)").run(Date.now());
db.prepare(
  "INSERT INTO products(id,name,price,stock,published,inventory_mode,option_schema,created_at,updated_at) " +
  "VALUES('prod1','گیفت کاردستی',150000,100,1,'simple','[]',?,?)"
).run(Date.now(), Date.now());

await setSetting(env, "payment_gateway_enabled", true);
await setSetting(env, "payment_gateway", "zarinpal");
await setSetting(env, "payment_gateway_merchant", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2");

// ---------- 1. create gateway order ----------
const accessKey = "a".repeat(64);
const orderPayload = {
  requestId: crypto.randomUUID(),
  accessKey,
  name: "مشتری تستی",
  phone: "09123456789",
  address: "تهران، خیابان تست، پلاک ۱",
  postal: "",
  note: "",
  coupon: "",
  paymentMethod: "gateway",
  gateway: "zarinpal",
  items: [{ productId: "prod1", variantId: "", selection: {}, quantity: 2 }]
};

const orderRequest = new Request(ORIGIN + "/api/orders", {
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify(orderPayload)
});

const order = await createOrder(orderRequest, env, ctx);
check("order created with gateway method", /^[A-Z0-9-]{3,}$/.test(order.code) && order.total === 300000);

const orderRow = db.prepare("SELECT * FROM orders WHERE id=?").get(order.id);
check("orders.gateway column set", orderRow.gateway === "zarinpal" && orderRow.payment_method === "contact");
check("gateway order has no auto-cancel deadline", orderRow.expires_at === null);
check("stock reserved", db.prepare("SELECT stock FROM products WHERE id='prod1'").get().stock === 98);

// ---------- 2. start payment ----------
function payStartRequest(orderId, key) {
  return new Request(ORIGIN + "/api/pay/start", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-order-key": key
    },
    body: JSON.stringify({ orderId })
  });
}

const startResult = await startGatewayPayment(payStartRequest(order.id, accessKey), env, ctx);
check("start returns Zarinpal StartPay URL", startResult.redirect === "https://www.zarinpal.com/pg/StartPay/A00000000000000000000000000000000001");

const paymentRow = db.prepare("SELECT * FROM gateway_payments WHERE order_id=?").get(order.id);
check("payment row pending", paymentRow?.status === "pending" && paymentRow.amount === 300000);
check("site_url auto-filled", db.prepare("SELECT value FROM settings WHERE key='site_url'").get()?.value === JSON.stringify(ORIGIN));

// start with wrong key must fail
let rejected = false;
try { await startGatewayPayment(payStartRequest(order.id, "b".repeat(64)), env, ctx); } catch { rejected = true; }
check("start with wrong access key rejected", rejected);

// ---------- 3. callback: cancel path ----------
const cancelPage = await handleGatewayCallback(
  new URL(ORIGIN + "/pay/callback?Authority=A00000000000000000000000000000000001&Status=NOK"),
  env, ctx
);
const cancelHTML = await cancelPage.text();
check("cancel renders failure page", cancelHTML.includes("پرداخت انجام نشد"));
check("cancel marks payment failed", db.prepare("SELECT status FROM gateway_payments WHERE order_id=?").get(order.id).status === "failed");
check("cancel leaves order unpaid", db.prepare("SELECT payment_status FROM orders WHERE id=?").get(order.id).payment_status === "unpaid");

// ---------- 4. callback: success path (retry after cancel -> new payment) ----------
zarinpalRequestResponse = () => ({ ok: true, data: { code: 100, authority: "B00000000000000000000000000000000002" } });
const start2 = await startGatewayPayment(payStartRequest(order.id, accessKey), env, ctx);
check("second start returns new authority", start2.redirect.endsWith("B00000000000000000000000000000000002"));

const okPage = await handleGatewayCallback(
  new URL(ORIGIN + "/pay/callback?Authority=B00000000000000000000000000000000002&Status=OK"),
  env, ctx
);
const okHTML = await okPage.text();
check("success page rendered", okHTML.includes("پرداخت موفق") && okHTML.includes("123456"));
check("order marked paid", db.prepare("SELECT payment_status,paid_at FROM orders WHERE id=?").get(order.id).payment_status === "paid");
check("payment verified with ref", db.prepare("SELECT status,ref_id FROM gateway_payments WHERE authority='B00000000000000000000000000000000002'").get().ref_id === "123456");
check("failed attempt kept failed", db.prepare("SELECT COUNT(*) c FROM gateway_payments WHERE order_id=? AND status='failed'").get(order.id).c === 1);
check("order event recorded", db.prepare("SELECT COUNT(*) c FROM order_events WHERE order_id=? AND kind='gateway_payment'").get(order.id).c === 1);
check("stock NOT restored on payment", db.prepare("SELECT stock FROM products WHERE id='prod1'").get().stock === 98);
await drain();
check("admin notified of payment", telegramCalls.some(call => call.text?.includes("پرداخت آنلاین موفق") && call.text?.includes(order.code)));

// ---------- 5. idempotent replay ----------
const replayPage = await handleGatewayCallback(
  new URL(ORIGIN + "/pay/callback?Authority=B00000000000000000000000000000000002&Status=OK"),
  env, ctx
);
check("replay still success page", (await replayPage.text()).includes("پرداخت موفق"));
check("replay does not duplicate events", db.prepare("SELECT COUNT(*) c FROM order_events WHERE order_id=? AND kind='gateway_payment'").get(order.id).c === 1);

// ---------- 6. verify rejection path ----------
await setSetting(env, "payment_gateway_enabled", true);
const order2Payload = { ...orderPayload, requestId: crypto.randomUUID(), paymentMethod: "gateway", gateway: "zarinpal" };
const order2 = await createOrder(new Request(ORIGIN + "/api/orders", {
  method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify(order2Payload)
}), env, ctx);

zarinpalRequestResponse = () => ({ ok: true, data: { code: 100, authority: "C00000000000000000000000000000000003" } });
await startGatewayPayment(payStartRequest(order2.id, "a".repeat(64)), env, ctx);

zarinpalVerifyResponse = () => ({ ok: true, data: { code: 71 }, errors: {} });
const rejectPage = await handleGatewayCallback(
  new URL(ORIGIN + "/pay/callback?Authority=C00000000000000000000000000000000003&Status=OK"),
  env, ctx
);
check("verify rejection page", (await rejectPage.text()).includes("تأیید نشد"));
check("rejected payment marked failed", db.prepare("SELECT status FROM gateway_payments WHERE authority='C00000000000000000000000000000000003'").get().status === "failed");
check("order2 still unpaid", db.prepare("SELECT payment_status FROM orders WHERE id=?").get(order2.id).payment_status === "unpaid");

// ---------- 7. maintainOrders does not cancel gateway orders ----------
const { maintainOrders } = await import("../src/orders.js");
await maintainOrders(env);
check("gateway order not auto-cancelled", db.prepare("SELECT status FROM orders WHERE id=?").get(order2.id).status === "new");

// ---------- 8. disabled gateway rejects checkout ----------
await setSetting(env, "payment_gateway_enabled", false);
let blocked = false;
try {
  await createOrder(new Request(ORIGIN + "/api/orders", {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ ...orderPayload, requestId: crypto.randomUUID() })
  }), env, ctx);
} catch (error) { blocked = error.status === 403; }
check("checkout rejected when gateway disabled", blocked);
await setSetting(env, "payment_gateway_enabled", true);

// ---------- 9. bot gateway panel ----------
// The bot only accepts callbacks pressed on the CURRENT panel message.
function currentPanelMessageId() {
  return db.prepare("SELECT message_id FROM bot_panels WHERE admin_id='111'").get()
    ?.message_id || 1;
}

async function botCallback(data, updateId) {
  await handleBot(env, {
    update_id: updateId,
    callback_query: {
      id: "c" + updateId,
      data,
      message: { message_id: currentPanelMessageId(), chat: { id: "111", type: "private" } },
      from: { id: 111 }
    }
  }, ctx);
  await drain();
}

async function botText(text, updateId) {
  await handleBot(env, {
    update_id: updateId,
    message: { message_id: updateId, chat: { id: "111", type: "private" }, from: { id: 111 }, text }
  }, ctx);
  await drain();
}

telegramCalls.length = 0;
await botCallback("gateway", 9001);
check("bot gateway panel rendered", telegramCalls.some(call => call.text?.includes("درگاه پرداخت آنلاین") && call.text?.includes("زرین‌پال")));

// toggle without merchant (clear merchant first); handleBot renders the error
// into the panel instead of throwing, so verify the DB state stays disabled.
await setSetting(env, "payment_gateway_merchant", "");
await setSetting(env, "payment_gateway_enabled", false);
telegramCalls.length = 0;
await botCallback("gatewaytoggle", 9002);
check("enabling without merchant blocked",
  db.prepare("SELECT value FROM settings WHERE key='payment_gateway_enabled'").get()?.value === "false" &&
  telegramCalls.some(call => call.text?.includes("Error:")));

// set merchant via bot input flow
await botCallback("gatewaymerchant", 9003);
await botText("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2", 9004);
check("merchant saved via bot", db.prepare("SELECT value FROM settings WHERE key='payment_gateway_merchant'").get()?.value === JSON.stringify("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2"));

// now toggle works and enables gateway
telegramCalls.length = 0;
await botCallback("gatewaytoggle", 9005);
check("gateway enabled via bot", db.prepare("SELECT value FROM settings WHERE key='payment_gateway_enabled'").get()?.value === "true");
check("enabled panel shows callback URL", telegramCalls.some(call => call.text?.includes("/pay/callback")));

// activate zibal via the multi-select panel (merchant already set, so it is ready)
await botCallback("gatewayuse:zibal", 9006);
const activeGatewayList = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='payment_gateways'").get()?.value || "[]");
check("zibal activated via multi-select", Array.isArray(activeGatewayList) && activeGatewayList.includes("zibal"));

// ---------- 10. full Zibal cycle (sandbox, no merchant needed) ----------
await setSetting(env, "payment_gateway_sandbox", true);
await setSetting(env, "payment_gateway_merchant", "");
let zibalTrackCounter = 243456788;

globalThis.fetch = (url, options = {}) => {
  const target = String(url);
  const payload = options.body ? JSON.parse(options.body) : {};

  if (target.includes("api.telegram.org")) {
    telegramCalls.push({ text: payload.text });
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 }));
  }

  if (target.includes("gateway.zibal.ir/v1/request")) {
    zibalTrackCounter += 1;
    return Promise.resolve(new Response(JSON.stringify({
      result: 100, message: "success", trackId: String(zibalTrackCounter)
    }), { status: 200 }));
  }

  if (target.includes("gateway.zibal.ir/v1/verify")) {
    return Promise.resolve(new Response(JSON.stringify({
      result: 100, status: 1, refNumber: "9999", cardNumber: "6037******1111"
    }), { status: 200 }));
  }

  return Promise.reject(new Error("Unexpected fetch: " + target));
};

const order3Payload = { ...orderPayload, requestId: crypto.randomUUID(), accessKey: "c".repeat(64), gateway: "zibal" };
const order3 = await createOrder(new Request(ORIGIN + "/api/orders", {
  method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify(order3Payload)
}), env, ctx);

const zibalStart = await startGatewayPayment(payStartRequest(order3.id, "c".repeat(64)), env, ctx);
check("zibal start returns gateway.zibal.ir URL", zibalStart.redirect === "https://gateway.zibal.ir/start/243456789");
const zibalPage = await handleGatewayCallback(
  new URL(ORIGIN + "/pay/callback?trackId=243456789&success=1"),
  env, ctx
);
const zibalHTML = await zibalPage.text();
check("zibal success page", zibalHTML.includes("پرداخت موفق") && zibalHTML.includes("9999"));
check("zibal payment verified", db.prepare(
  "SELECT status FROM gateway_payments WHERE authority='243456789'"
).get().status === "verified");
check("zibal order paid", db.prepare("SELECT payment_status FROM orders WHERE id=?").get(order3.id).payment_status === "paid");
await drain();

// zibal cancel callback uses success=0
const order4Payload = { ...orderPayload, requestId: crypto.randomUUID(), accessKey: "d".repeat(64), gateway: "zibal" };
const order4 = await createOrder(new Request(ORIGIN + "/api/orders", {
  method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
  body: JSON.stringify(order4Payload)
}), env, ctx);
await startGatewayPayment(payStartRequest(order4.id, "d".repeat(64)), env, ctx);
const zibalCancel = await handleGatewayCallback(
  new URL(ORIGIN + "/pay/callback?trackId=243456789&success=0"),
  env, ctx
);
check("zibal cancel handled", (await zibalCancel.text()).includes("پرداخت انجام نشد"));

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
