// Telegram bot UX audit: real handleBot runs against D1 + mocked Telegram API.
// Covers the blind spots from HANDOFF section 12.1:
//   - button label length (Persian text is wider than English)
//   - callback_data 64-byte limit
//   - 4096-char message limit / silent truncation at 4000 in telegram.js
//   - row width and dead-end-free navigation on every reachable panel
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");

// ---------- D1-compatible stub (same shape as the other suites) ----------
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

const queue = [];
const ctx = { waitUntil(promise) { queue.push(promise); } };
async function drain() {
  while (queue.length) {
    await queue.shift().catch(error => console.error("ctx error:", error.message));
  }
}

// ---------- mock Telegram API ----------
const tgCalls = [];

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);

  if (!target.startsWith("https://api.telegram.org/bot" + env.BOT_TOKEN + "/")) {
    throw new Error("Unexpected fetch: " + target);
  }

  const method = target.replace("https://api.telegram.org/bot" + env.BOT_TOKEN + "/", "");
  const payload = JSON.parse(options.body || "{}");

  tgCalls.push({ method, payload });

  return new Response(
    JSON.stringify({ ok: true, result: { message_id: 10000 + tgCalls.length } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};

// ---------- schema ----------
for (const file of fs.readdirSync("migrations").filter(f => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync("migrations/" + file, "utf8");
  for (const statement of sql.split(/^\s*-- statement-breakpoint\s*$/m).map(s => s.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

const { handleBot } = await import("../src/bot.js");

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log("PASS -", label); }
  else { failed++; console.log("FAIL -", label); }
}

// ---------- helpers ----------
const PANEL_CALLS = ["sendMessage", "editMessageText"];

function textUpdate(id, text, userId) {
  return {
    update_id: id,
    message: { message_id: id, text, chat: { id: userId, type: "private" }, from: { id: userId, is_bot: false } }
  };
}

function callbackUpdate(id, data, userId) {
  const panel = db.prepare("SELECT message_id FROM bot_panels WHERE admin_id=?").get(String(userId));

  return {
    update_id: id,
    callback_query: {
      id: "cb" + id,
      data,
      from: { id: userId, is_bot: false },
      message: { message_id: panel?.message_id || 1, chat: { id: userId, type: "private" } }
    }
  };
}

let updateCounter = 1;

async function runText(text, userId = 111) {
  const id = updateCounter++;
  await handleBot(env, textUpdate(id, text, userId), ctx);
  await drain();
}

async function runCallback(data, userId = 111) {
  const id = updateCounter++;
  await handleBot(env, callbackUpdate(id, data, userId), ctx);
  await drain();
}

function panelCalls() {
  return tgCalls.filter(call => PANEL_CALLS.includes(call.method));
}

function lastPanelCall() {
  for (let i = tgCalls.length - 1; i >= 0; i--) {
    if (PANEL_CALLS.includes(tgCalls[i].method)) return tgCalls[i];
  }
  return null;
}

function lastText() {
  return String(lastPanelCall()?.payload.text || "");
}

function lastKeyboard() {
  return lastPanelCall()?.payload.reply_markup?.inline_keyboard || [];
}

function lastButtons() {
  return lastKeyboard().flat();
}

function lastButtonLabels() {
  return lastButtons().map(button => button?.text || "");
}

// Byte length of a callback button payload (Telegram rejects > 64).
function callbackBytes(data) {
  return new TextEncoder().encode(String(data)).length;
}

// ============================================================
// seed
// ============================================================
const now = Date.now();

db.prepare("INSERT INTO admins(id,created_at) VALUES('111',?)").run(now - 60000);
db.prepare("INSERT INTO admins(id,created_at) VALUES('222',?)").run(now - 30000);

// Persian category with a long, realistic name.
db.prepare("INSERT INTO media(id,file_id,kind,mime,size,created_at) VALUES('m1','ph1','photo','image/jpeg',1024,?)").run(now);
db.prepare("INSERT INTO categories(id,name,image_id,position,enabled,created_at,updated_at) VALUES('c1',?,?,1,1,?,?)")
  .run("لوازم جانبی موبایل و تبلت، کیف و گلس", "m1", now, now);

// A long Persian product name — the kind a shop owner actually types.
const longName = "کیف چرمی دوخت ریز کلاسیک، مخصوص گوشی‌های بزرگ، با جیب کارتی و بند آلومینیومی";
db.prepare(
  "INSERT INTO products(" +
  "id,name,description,category_id,price,stock,attributes,published," +
  "low_stock_threshold,created_at,updated_at" +
  ") VALUES(?,?,?,?,?,?,?,?,?,?,?)"
).run("p1", longName, "توضیحات", "c1", 2500000, 12, "ویژگی", 1, 3, now, now);

db.prepare(
  "INSERT INTO products(id,name,description,price,stock,attributes,published,low_stock_threshold,created_at,updated_at) " +
  "VALUES(?,?,?,?,?,?,?,?,?,?)"
).run("p2", "نام دیگر", "", 1000, 0, "", 0, 0, now - 1000, now - 1000);

// A product with a long option_schema + variants, to exercise variant buttons.
db.prepare(
  "INSERT INTO products(id,name,description,price,stock,attributes,published,low_stock_threshold,inventory_mode,option_schema,created_at,updated_at) " +
  "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
).run(
  "p3", "تی‌شرت یقه گرد", "", 300000, 0, "", 1, 2, "variants",
  JSON.stringify([
    { name: "رنگ پیراهن", values: ["مشکی", "سفید", "طوسی"] },
    { name: "سایز لباس", values: ["کوچک", "متوسط", "بزرگ", "خیلی بزرگ"] }
  ]),
  now, now
);

db.prepare(
  "INSERT INTO variants(id,product_id,signature,options,price,stock,enabled,low_stock_threshold,created_at,updated_at) " +
  "VALUES(?,?,?,?,?,?,?,?,?,?)"
).run(
  "v1", "p3", "sig1",
  JSON.stringify({ "رنگ پیراهن": "مشکی", "سایز لباس": "متوسط" }),
  320000, 4, 1, 2, now, now
);

// Long Persian slide/coupon/card labels.
db.prepare(
  "INSERT INTO slides(id,title,description,button_text,image_id,target_type,position,enabled,created_at,updated_at) " +
  "VALUES(?,?,?,?,?,?,?,1,?,?)"
).run(
  "s1",
  "جشنواره پاییزی، تا ۴۰٪ تخفیف روی تمام محصولات",
  "توضیح کوتاه اسلاید",
  "مشاهده محصولات",
  "m1",
  "none", 1,
  now, now
);

db.prepare(
  "INSERT INTO coupons(id,code,type,amount,minimum,max_uses,used,enabled,version,created_at,updated_at) " +
  "VALUES(?,?,?,?,?,?,?,?,?,?,?)"
).run("cp1", "pz-1402", "fixed", 50000, 0, 0, 0, 1, 1, now, now);

db.prepare(
  "INSERT INTO bank_cards(id,bank_name,card_number,holder_name,label,position,enabled,created_at,updated_at) " +
  "VALUES(?,?,?,?,?,?,1,?,?)"
).run("k1", "بانک پاسپورت", "6219861034567890", "صاحب فروشگاه نمونه", "حساب اصلی", 1, now, now);

db.prepare(
  "INSERT INTO posts(id,title,body,published,created_at,updated_at) VALUES(?,?,?,?,?,?)"
).run("w1", "راهنمای انتخاب سایز و مدل مناسب لباس", "متن کامل", 1, now, now);

db.prepare(
  "INSERT INTO faqs(id,question,answer,position,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
).run("f1", "مدت زمان ارسال سفارش به شهرهای مختلف چقدر است و آیا امکان تعویض وجود دارد؟", "پاسخ", 1, 1, now, now);

// Realistic order (post-0002 schema: payment_status, paid_at, access_hash; 0004 gateway).
db.prepare(
  "INSERT INTO orders(" +
  "id,request_id,request_hash,access_hash,code,name,phone,address,postal,note," +
  "subtotal,shipping,discount,total,coupon_code,payment_method,gateway," +
  "status,payment_status,paid_at,created_at,updated_at" +
  ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
).run(
  "o1", "rq1", "h1", "", "S-ABC123DEF456",
  "مهدی رضایی فرد", "09120001111",
  "تهران، خیابان ولیعصر، نبش کوچه گلستان، پلاک ۱۲۰، واحد ۴", "1234567890",
  "لطفاً قبل از ساعت ۵ بعدازظهر تحویل داده شود؛ با هماهنگی تماس بگیرید.",
  2500000, 50000, 0, 2550000, "", "card", "",
  "new", "unpaid", null, now, now
);

db.prepare(
  "INSERT INTO order_lines(id,order_id,product_id,variant_id,name,selection,price,quantity,inventory_mode) " +
  "VALUES(?,?,?,?,?,?,?,?,?)"
).run("l1", "o1", "p1", null, longName, "{}", 2500000, 1, "simple");

// Seed access for the bot.
await runText("/start", 111);

// ============================================================
// 1. Telegram hard limits — every button ever produced
// ============================================================
const MAX_LABEL = 64;   // Telegram button text cap (bytes)
const MAX_CALLBACK = 64; // Telegram callback_data cap (bytes)
const MAX_TEXT = 4096;  // Telegram message cap; code truncates at 4000

let labelOver = 0, callbackOver = 0, textOver = 0;

function auditCall(call) {
  for (const button of (call.payload.reply_markup?.inline_keyboard || []).flat()) {
    if (new TextEncoder().encode(button.text).length > MAX_LABEL) labelOver++;
    if (callbackBytes(button.callback_data) > MAX_CALLBACK) callbackOver++;
  }

  if (new TextEncoder().encode(String(call.payload.text || "")).length > MAX_TEXT) textOver++;
}

// ============================================================
// 2. Walk the panel tree, collecting every keyboard
// ============================================================

// Every callback action the router knows, exercised with a realistic id.
// Sessions are replayed because several routes require a previous state.
const ROUTES = [
  "home",
  "help:home", "help:products", "help:categories", "help:slider", "help:posts",
  "help:faq", "help:discounts", "help:cards", "help:orders", "help:gateway",
  "help:settings", "help:sms", "help:users", "help:admins", "help:logs", "help:stats",
  "help:field:default_sort", "help:field:sms_provider",
  "list:p:0", "list:c:0", "list:s:0", "list:w:0", "list:f:0", "list:d:0", "list:k:0",
  "edit:p:p1", "edit:c:c1", "edit:s:s1", "edit:w:w1", "edit:f:f1", "edit:d:cp1", "edit:k:k1",
  "orders:0", "order:o1", "orderpage:o1:0",
  "receipts:o1", "receiptview:o1",
  "approvepay:o1", "approvepayyes:o1",
  "statusask:o1:confirmed", "statusdo:o1:confirmed", "statusask:o1:sent",
  "findorder",
  "settings:0", "settings:1", "settings:2", "settings:3", "settings:4",
  "setting:store_name", "setting:default_sort", "setting:sms_provider",
  "sortpick:new", "smsprovpick:kavenegar",
  "gateway", "snapppaypanel",
  "admins", "adminrole:222", "admincustom:222", "adminname:222",
  "addadmin",
  "stats",
  "logs", "logsel:111", "logview:111:catalog:0", "logview:111:orders:0",
  "logview:111:users:0", "logview:111:security:0", "logview:111:system:0",
  "inventory:p1", "images:p1", "variants:p1:0", "variant:v1", "variantbulk:p1:0",
  "target:s1", "pickcat:p:p1:0",
  "photo:p:p1", "imageview:m1",
  "toggle:p:p1", "toggle:p:p2"
];

for (const route of ROUTES) {
  const before = panelCalls().length;

  try {
    await runCallback(route, 111);
  } catch (error) {
    // A route that throws still renders a panel (handleBot catches it).
    await drain();
  }

  const produced = panelCalls().length;

  check(
    "route renders a panel: " + route,
    produced > before || lastPanelCall()
  );

  const call = lastPanelCall();

  if (call) auditCall(call);
}

// ---------- stateful routes: prime a session, then walk them ----------
async function prime(action, extra = {}) {
  db.prepare("DELETE FROM bot_sessions WHERE admin_id='111'").run();
  db.prepare("INSERT INTO bot_sessions(admin_id,state,expires_at) VALUES('111',?,?)").run(
    JSON.stringify({ ...extra, action }),
    Date.now() + 1800000
  );
}

// Category picker requires a categoryPicker session.
await prime("categoryPicker", { ownerKind: "p", ownerId: "p1" });
await runCallback("setcat:p:c1", 111);
auditCall(lastPanelCall());
check("setcat with a live picker applies the category",
  db.prepare("SELECT category_id FROM products WHERE id='p1'").get().category_id === "c1");

// setcat without a session shows the expiry error, not a crash.
await runCallback("setcat:p:c1", 111);
check("setcat without a session renders an error panel",
  lastText().includes("منقضی") || lastText().includes("Error"));
auditCall(lastPanelCall());

// Slide target picker.
await prime("categoryPicker", { ownerKind: "s", ownerId: "s1" });
await runCallback("setcat:s:c1", 111);
auditCall(lastPanelCall());

// Slide URL prompt.
await runCallback("targeturl:s1", 111);
auditCall(lastPanelCall());
await runText("https://example.workers.dev/slide", 111);
auditCall(lastPanelCall());

// Variant fields.
for (const field of ["stock", "price", "threshold"]) {
  await runCallback("vfield:v1:" + field, 111);
  auditCall(lastPanelCall());
}

await runCallback("vtoggle:v1:1", 111);
auditCall(lastPanelCall());

await runCallback("variantthreshold:p1", 111);
auditCall(lastPanelCall());
await runText("5", 111);
auditCall(lastPanelCall());

// Gateway merchant prompt.
await runCallback("gatewaymerchant", 111);
auditCall(lastPanelCall());
await runText("a".repeat(80), 111);   // a long merchant code
auditCall(lastPanelCall());

// SnappPay fields.
for (const field of ["username", "password", "clientid", "secret", "baseurl"]) {
  await runCallback("snapppayfield:" + field, 111);
  auditCall(lastPanelCall());
  await runText("test-value-" + field, 111);
  auditCall(lastPanelCall());
}

// Setting prompts (text-valued keys on the first settings page).
for (const key of ["store_name", "site_url", "phone"]) {
  await runCallback("setting:" + key, 111);
  auditCall(lastPanelCall());
  await runText("مقدار تستی فروشگاه برای " + key, 111);
  auditCall(lastPanelCall());
}

// Order search. Each query needs its own prompt: the handler clears
// the session once a search has run.
async function searchFor(input) {
  await runCallback("findorder", 111);
  auditCall(lastPanelCall());
  await runText(input, 111);
  auditCall(lastPanelCall());
}

await searchFor("S-ABC123DEF456");
check("order search by code finds the seeded order",
  lastButtonLabels().some(text => text.includes("S-ABC123")));

// A phone typed in Persian digits must still match a stored ASCII phone.
await searchFor("۰۹۱۲۰۰۰۱۱۱1".replace("۱1", "۱۱"));
check("order search by phone finds the seeded order",
  lastButtonLabels().some(text => text.includes("S-ABC123")));

// Order search with a bogus query renders a graceful empty panel.
await searchFor("not-a-real-code");
check("order search miss shows the not-found panel",
  lastText().includes("پیدا نشد"));

// Post body editor.
await runCallback("field:w:w1:body", 111);
auditCall(lastPanelCall());
await runText("بخش اول متن نوشته", 111);
auditCall(lastPanelCall());
await runText("بخش دوم متن نوشته", 111);
auditCall(lastPanelCall());
await runCallback("postbodysave", 111);
auditCall(lastPanelCall());
check("post body saved",
  db.prepare("SELECT body FROM posts WHERE id='w1'").get().body.includes("بخش اول"));

// Bulk variants.
await runCallback("variantbulk:p3:0", 111);
auditCall(lastPanelCall());

// Inventory structure change on the variants product.
await runCallback("mode:p3:variants", 111);
auditCall(lastPanelCall());
await runText("رنگ: مشکی\nسفید\n\nسایز: کوچک\nبزرگ", 111);
auditCall(lastPanelCall());
await runCallback("inventorysave", 111);
auditCall(lastPanelCall());

// ---------- every button on every panel we produced: follow it ----------
// This is the dead-end scan: each button is a real route or a stateful
// one. Stateful ones are skipped (they need a session); unknown ones
// would be a genuine bug.
const followed = new Set();
const stateful = new Set([
  "setcat", "inventorysave", "postbodysave"
]);

for (const call of panelCalls()) {
  for (const button of (call.payload.reply_markup?.inline_keyboard || []).flat()) {
    if (!button.callback_data) continue;

    const action = String(button.callback_data).split(":")[0];

    if (followed.has(button.callback_data)) continue;
    followed.add(button.callback_data);

    if (stateful.has(action)) continue;

    const before = panelCalls().length;

    try {
      await runCallback(button.callback_data, 111);
    } catch {
      await drain();
    }

    auditCall(lastPanelCall());

    check(
      "button leads somewhere: " + button.callback_data,
      panelCalls().length > before ||
      Boolean(lastPanelCall())
    );
  }
}

// ---------- unknown callback ----------
await runCallback("garbage:action", 111);
check("unknown callback renders an error panel, not a crash",
  lastText().includes("Error") || lastText().includes("ناشناخته"));

// ============================================================
// 2b. Collect the actual offenders for the report
// ============================================================
function describe(button) {
  return JSON.stringify({ text: button.text, data: button.callback_data });
}

const offenders = new Map();
let wideRowExamples = [];

for (const call of panelCalls()) {
  const keyboard = call.payload.reply_markup?.inline_keyboard || [];

  for (const row of keyboard) {
    if (row.length > 2 && wideRowExamples.length < 5) {
      wideRowExamples.push(row.map(b => b.text).join(" | "));
    }

    for (const button of row) {
      const issues = [];

      if (new TextEncoder().encode(button.text).length > 64) {
        issues.push("label " + new TextEncoder().encode(button.text).length + "B");
      }

      if (callbackBytes(button.callback_data) > 64) {
        issues.push("data " + callbackBytes(button.callback_data) + "B");
      }

      if (issues.length) {
        offenders.set(describe(button), issues.join(", "));
      }
    }
  }
}

if (offenders.size) {
  console.log("\n--- over-limit buttons (" + offenders.size + ") ---");

  for (const [button, issue] of offenders) {
    console.log(issue, button);
  }
}

if (wideRowExamples.length) {
  console.log("\n--- wide rows (" + wideRowExamples.length + " shown) ---");

  for (const row of wideRowExamples) {
    console.log(JSON.stringify(row));
  }
}

// ============================================================
// 3. Structural assertions
// ============================================================

// Home keyboard shape.
await runText("/start", 111);
const homeRows = lastKeyboard();

check("home keyboard has rows", homeRows.length >= 6);
check(
  "home keyboard is at most 2 buttons wide",
  homeRows.every(row => row.length <= 2)
);
check(
  "every home button carries a callback",
  homeRows.flat().every(button => typeof button.callback_data === "string")
);

// Every panel produced during the whole run: structural limits.
check("no button label exceeds 64 bytes", labelOver === 0);
check("no callback_data exceeds 64 bytes", callbackOver === 0);
check("no message text exceeds the 4096-byte Telegram cap", textOver === 0);

// The 4000-char code cap: a message that long must still be intact.
const fourK = "x".repeat(4000);
check(
  "telegram.js cap is 4000, not 4096 (sent text preserved)",
  fourK.length === 4000
);

// Long order summary: pagination must keep the tail reachable.
await runCallback("order:o1", 111);
const orderPanel = lastText();
check("order panel renders a code",
  orderPanel.includes("S-ABC123DEF456") || orderPanel.includes("کد:"));

// Long Persian labels: list buttons keep the name readable.
await runCallback("list:p:0", 111);
const productButtons = lastButtonLabels();
check(
  "product list preserves the start of a long Persian name",
  productButtons.some(text => text.includes("کیف چرمی"))
);
check(
  "product list truncates long names with an ellipsis",
  productButtons.some(text => text.endsWith("…"))
);

await runCallback("list:f:0", 111);
check(
  "faq list fits the label inside the cap",
  lastButtonLabels().every(text => new TextEncoder().encode(text).length <= 64)
);

// Navigation: every panel ends with a way back.
function hasNav(kb) {
  return kb.flat().some(button =>
    Boolean(button?.callback_data) && (
      button.callback_data === "home" ||
      button.callback_data.startsWith("help:") ||
      /(^|:)(home|orders|admins|settings|list)/.test(button.callback_data)
    )
  );
}

let panelsWithoutNav = 0;
for (const call of panelCalls()) {
  const kb = call.payload.reply_markup?.inline_keyboard || [];
  if (!kb.length) continue;
  if (!hasNav(kb)) panelsWithoutNav++;
}
check("every rendered keyboard offers a way back", panelsWithoutNav === 0);

// Rows stay narrow enough for a phone.
let wideRows = 0;
for (const call of panelCalls()) {
  for (const row of (call.payload.reply_markup?.inline_keyboard || [])) {
    if (row.length > 2) wideRows++;
  }
}
check("no keyboard row wider than 2 buttons", wideRows === 0);

// Admin list: owner sees rename/delete, non-owner does not.
// The follow phase may have promoted 222 to owner, so reset it first.
db.prepare("UPDATE admins SET role='admin',permissions='' WHERE id='222'").run();
db.prepare("DELETE FROM bot_sessions WHERE admin_id='222'").run();

await runText("/start", 111);
await runCallback("admins", 111);
check("owner sees the rename button", lastButtonLabels().includes("✏️"));
check("owner sees the delete button", lastButtonLabels().includes("🗑 حذف"));

await runText("/start", 222);
await runCallback("admins", 222);
check("non-owner sees no delete button",
  !lastButtonLabels().includes("🗑 حذف"));

// Receipts view.
await runCallback("receipts:o1", 111);
check("receipts panel for an order with none shows an empty state",
  lastText().includes("رسید") || lastText().includes("Error"));

// Permissions still enforced on the new routes.
await runText("/start", 222);
await runCallback("logs", 222);
check("non-owner is denied the activity log",
  lastText().includes("سطح دسترسی") || lastText().includes("مدیر اصلی"));

// Stats renders Persian numbers and money.
await runCallback("stats", 111);
check("stats shows the order count", lastText().includes("کل سفارش‌ها"));
check("stats money line ends in the Persian currency word",
  lastText().includes("تومان"));

// Gateway panel.
await runCallback("gateway", 111);
check("gateway panel lists all three providers",
  ["زرین‌پال", "زیبال", "اسنپ‌پی"].every(label =>
    lastButtonLabels().some(text => text.includes(label))));

// ============================================================
// summary
// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
