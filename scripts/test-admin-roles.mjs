// Integration test: admin access levels + /start fresh panel over real SQLite.
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
  while (queue.length) {
    await queue.shift().catch(error => console.error("ctx error:", error.message));
  }
}

// ---------- mock fetch: telegram only ----------
const tgCalls = [];

/* Minimal PNG signature + slack so imageType() detects a real PNG. */
const FAKE_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const FAKE_FILES = {
  "photos/logo-doc.png": FAKE_PNG
};

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);

  if (target.includes("api.telegram.org")) {
    // File download: https://api.telegram.org/file/bot<TOKEN>/<path>
    const filePrefix = "https://api.telegram.org/file/bot" + env.BOT_TOKEN + "/";

    if (target.startsWith(filePrefix)) {
      const filePath = target.slice(filePrefix.length);

      if (!(filePath in FAKE_FILES)) {
        return new Response(JSON.stringify({ ok: false, error_code: 404 }), { status: 404 });
      }

      return new Response(FAKE_FILES[filePath], { status: 200 });
    }

    const method = target.replace("https://api.telegram.org/bot" + env.BOT_TOKEN + "/", "");
    const payload = JSON.parse(options.body || "{}");
    tgCalls.push({ method, payload });

    const result = method === "getFile"
      ? { file_id: payload.file_id, file_path: "photos/logo-doc.png", file_size: 1024 }
      : { message_id: 10000 + tgCalls.length };

    return new Response(
      JSON.stringify({ ok: true, result }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  throw new Error("Unexpected fetch: " + target);
};

// ---------- apply migrations (same splitting as apply-migrations.mjs) ----------
for (const file of fs.readdirSync("migrations").filter(f => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync("migrations/" + file, "utf8");
  for (const statement of sql.split(/^\s*-- statement-breakpoint\s*$/m).map(s => s.trim()).filter(Boolean)) {
    db.exec(statement);
  }
  console.log("migration applied:", file);
}

// ---------- module imports (after env ready) ----------
const { handleBot } = await import("../src/bot.js");

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log("PASS -", label); }
  else { failed++; console.log("FAIL -", label); }
}

// ---------- helpers ----------
function textUpdate(updateId, text, userId) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text,
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false }
    }
  };
}

function callbackUpdate(updateId, data, userId) {
  const panel = db
    .prepare("SELECT message_id FROM bot_panels WHERE admin_id=?")
    .get(String(userId));

  return {
    update_id: updateId,
    callback_query: {
      id: "cb" + updateId,
      data,
      from: { id: userId, is_bot: false },
      message: {
        message_id: panel?.message_id || 1,
        chat: { id: userId, type: "private" }
      }
    }
  };
}

let updateCounter = 1;
async function run(update) {
  await handleBot(env, update, ctx);
  await drain();
}
async function runText(text, userId) {
  await run(textUpdate(updateCounter++, text, userId));
}
async function runCallback(data, userId) {
  await run(callbackUpdate(updateCounter++, data, userId));
}

function lastText() {
  for (let i = tgCalls.length - 1; i >= 0; i--) {
    if (["sendMessage", "editMessageText"].includes(tgCalls[i].method)) {
      return String(tgCalls[i].payload.text || "");
    }
  }
  return "";
}

function lastKeyboardTexts() {
  for (let i = tgCalls.length - 1; i >= 0; i--) {
    const call = tgCalls[i];
    if (["sendMessage", "editMessageText"].includes(call.method)) {
      return (call.payload.reply_markup?.inline_keyboard || [])
        .flat()
        .map(button => button.text);
    }
  }
  return [];
}

function lastKeyboard() {
  for (let i = tgCalls.length - 1; i >= 0; i--) {
    const call = tgCalls[i];
    if (["sendMessage", "editMessageText"].includes(call.method)) {
      return call.payload.reply_markup?.inline_keyboard || [];
    }
  }
  return [];
}

function countMethod(method) {
  return tgCalls.filter(call => call.method === method).length;
}

function adminRole(id) {
  return db.prepare("SELECT role FROM admins WHERE id=?").get(String(id))?.role;
}

async function runDocument(userId, mime, fileName) {
  const document = {
    file_id: "doc-" + updateCounter,
    file_size: 1024,
    mime_type: mime,
    file_name: fileName
  };

  await run({
    update_id: updateCounter,
    message: {
      message_id: updateCounter,
      document,
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false }
    }
  });
}

// ---------- seed: two admins, both default role (post-migration state) ----------
const now = Date.now();
db.prepare("INSERT INTO admins(id,created_at) VALUES('111',?)").run(now - 1000);
db.prepare("INSERT INTO admins(id,created_at) VALUES('222',?)").run(now);

// ---------- 1. migration + self-heal promotion ----------
check(
  "migration 0005 adds admins.role with default",
  db.prepare("SELECT role FROM admins WHERE id='111'").get().role === "admin"
);

await runText("/start", 111);

check("oldest admin promoted to owner on first interaction", adminRole(111) === "owner");
check("other admin stays regular admin", adminRole(222) === "admin");

// ---------- 2. /start sends a brand-new panel message ----------
const panelBefore = db.prepare("SELECT message_id FROM bot_panels WHERE admin_id='111'").get();
const sendsBefore = countMethod("sendMessage");
const editsBefore = countMethod("editMessageText");

await runText("/start", 111);

const panelAfter = db.prepare("SELECT message_id FROM bot_panels WHERE admin_id='111'").get();
check("/start sends a NEW panel message (not an edit)", countMethod("sendMessage") === sendsBefore + 1);
check("/start does not edit the old panel", countMethod("editMessageText") === editsBefore);
check("/start re-points bot_panels to the new message", Number(panelAfter.message_id) !== Number(panelBefore.message_id));

// ---------- 3. /menu edits the existing panel ----------
const editsBeforeMenu = countMethod("editMessageText");
const panelIdBeforeMenu = Number(panelAfter.message_id);

await runText("/menu", 111);

check("/menu edits the existing panel", countMethod("editMessageText") === editsBeforeMenu + 1);
check(
  "/menu keeps the same panel message",
  Number(db.prepare("SELECT message_id FROM bot_panels WHERE admin_id='111'").get().message_id) === panelIdBeforeMenu
);

// ---------- 4. owner home panel includes admin management ----------
check("owner home shows مدیران", lastKeyboardTexts().some(text => text.includes("مدیران")));
check("owner home shows full catalog", lastKeyboardTexts().some(text => text.includes("محصولات")));

// ---------- 5. owner adds an operator via role picker ----------
await runCallback("addadmin", 111);
check("add-admin prompt stored a session", Boolean(db.prepare("SELECT state FROM bot_sessions WHERE admin_id='111'").get()));

await runText("913000123", 111);
check(
  "role picker offered after entering the ID",
  lastKeyboardTexts().some(text => text.includes("اپراتور"))
);

await runCallback("adminroleset:913000123:operator", 111);
check("new admin inserted with operator role", adminRole(913000123) === "operator");

// ---------- 6. operator home panel is limited ----------
await runText("/start", 913000123);

const operatorButtons = lastKeyboardTexts().join(" | ");
check("operator home shows orders", operatorButtons.includes("سفارش"));
check("operator home hides catalog", !operatorButtons.includes("محصولات"));
check("operator home hides settings", !operatorButtons.includes("تنظیمات"));
check("operator home hides admin management", !operatorButtons.includes("مدیران"));

// ---------- 7. operator permission enforcement ----------
await runCallback("list:p:0", 913000123);
check("operator denied on products", lastText().includes("سطح دسترسی"));

await runCallback("settings:0", 913000123);
check("operator denied on settings", lastText().includes("سطح دسترسی"));

await runCallback("admins", 913000123);
check("operator denied on admin management", lastText().includes("سطح دسترسی"));

await runCallback("deladmin:111", 913000123);
check("operator denied on deleting an admin", lastText().includes("سطح دسترسی"));
check("owner still present after denied delete", Boolean(db.prepare("SELECT id FROM admins WHERE id='111'").get()));

await runCallback("orders:0", 913000123);
check("operator allowed on orders", !lastText().includes("سطح دسترسی"));

await runCallback("stats", 913000123);
check("operator allowed on stats", !lastText().includes("سطح دسترسی"));

// ---------- 8. operator cannot complete forged input steps ----------
db.prepare(
  "INSERT INTO bot_sessions(admin_id,state,expires_at) VALUES('913000123',?,?)"
).run(JSON.stringify({ action: "gatewayMerchant", back: "gateway", help: "gateway" }), Date.now() + 600000);

await runText("some-merchant-code", 913000123);
check("operator denied on forged gateway input", lastText().includes("سطح دسترسی"));
check(
  "forged input session cleared",
  !Boolean(db.prepare("SELECT state FROM bot_sessions WHERE admin_id='913000123'").get())
);

// ---------- 9. regular admin access ----------
await runText("/start", 222);

const adminButtons = lastKeyboardTexts().join(" | ");
check("admin home shows catalog", adminButtons.includes("محصولات"));
check("admin home shows settings", adminButtons.includes("تنظیمات"));
check("admin home hides admin management", !adminButtons.includes("مدیران"));

await runCallback("admins", 222);
check("admin denied on admin management section", lastText().includes("سطح دسترسی"));

await runCallback("settings:0", 222);
check("admin allowed on settings", !lastText().includes("سطح دسترسی"));

await runCallback("admins", 111);
const ownerAdminButtons = lastKeyboardTexts().join(" | ");
check("owner sees admins list with roles",
  lastText().includes("مدیران فروشگاه") &&
  ownerAdminButtons.includes("مدیر اصلی") &&
  ownerAdminButtons.includes("اپراتور"));

// ---------- 10. owner changes an admin's access level ----------
await runCallback("adminrole:913000123", 111);
check("role picker shows current level", lastText().includes("اپراتور سفارش"));

await runCallback("adminroleset:913000123:admin", 111);
check("role changed to admin", adminRole(913000123) === "admin");

await runCallback("admins", 111);
check("admins list no longer shows operator", !lastKeyboardTexts().join(" | ").includes("اپراتور سفارش"));

// ---------- 11. last-owner protection ----------
await runCallback("adminroleset:111:operator", 111);
check("demoting the last owner rejected", lastText().includes("آخرین مدیر اصلی"));

await runCallback("deladminyes:111", 111);
check("deleting the last owner rejected", lastText().includes("قابل حذف نیستند"));
check("last owner still exists", adminRole(111) === "owner");

// last-owner picker offers no other levels
await runCallback("adminrole:111", 111);
check(
  "last-owner picker offers no demotion buttons",
  !lastKeyboardTexts().some(text => ["مدیر", "اپراتور"].includes(text))
);

// ---------- 12. second owner allows owner removal ----------
db.prepare("UPDATE admins SET role='owner' WHERE id='222'").run();

await runCallback("deladminyes:111", 222);
check("owner removed when another owner exists", !Boolean(db.prepare("SELECT id FROM admins WHERE id='111'").get()));
check("remaining owner intact", adminRole(222) === "owner");
check(
  "removed owner panel row cascaded",
  !Boolean(db.prepare("SELECT admin_id FROM bot_panels WHERE admin_id='111'").get())
);

// ---------- 13. non-administrators are ignored ----------
const nonAdminCallsBefore = tgCalls.filter(call => String(call.payload.chat_id) === "999").length;

await runText("/start", 999);
await runCallback("home", 999);

check(
  "non-admin /start and callbacks produce no reply",
  tgCalls.filter(call => String(call.payload.chat_id) === "999").length === nonAdminCallsBefore
);

// ---------- 14. unknown role values fall back safely ----------
db.prepare("UPDATE admins SET role='weird' WHERE id='913000123'").run();

await runText("/start", 913000123);
check(
  "unknown role falls back to regular admin home",
  lastKeyboardTexts().some(text => text.includes("محصولات")) &&
  !lastKeyboardTexts().some(text => text.includes("مدیران"))
);

check(
  "schema keeps exactly one owner at the end",
  db.prepare("SELECT COUNT(*) AS total FROM admins WHERE role='owner'").get().total === 1
);

// ---------- 15. default_sort button picker (no typing) ----------
await runCallback("setting:default_sort", 222);
check("sort picker opens with all four options",
  ["جدیدترین", "محبوب‌ترین", "ارزان‌ترین", "گران‌ترین"].every(label =>
    lastKeyboardTexts().some(text => text.includes(label)))
);

await runCallback("sortpick:pop", 222);
check("sortpick saves pop", JSON.parse(
  db.prepare("SELECT value FROM settings WHERE key='default_sort'").get().value
) === "pop");
check("sort picker marks current choice", lastKeyboardTexts().some(text => text.includes("✅") && text.includes("محبوب‌ترین")));

// per-field contextual help renders the field guide
await runCallback("help:field:default_sort", 222);
check("field help explains default_sort", lastText().includes("مرتب‌سازی اولیه ویترین") && lastText().includes("محبوب‌ترین"));

// ---------- 16. sms provider picker (kavenegar/farazsms/smsir) ----------
await runCallback("setting:sms_provider", 222);
check("sms provider picker opens",
  ["کاوه‌نگار", "فراز اس‌ام‌اس", "SMS.ir"].every(label =>
    lastKeyboardTexts().some(text => text.includes(label)))
);

await runCallback("smsprovpick:farazsms", 222);
check("sms provider saved", JSON.parse(
  db.prepare("SELECT value FROM settings WHERE key='sms_provider'").get().value
) === "farazsms");

// the settings list no longer opens a text prompt for these two fields
await runCallback("setting:default_sort", 222);
check("default_sort opens picker, not text prompt", lastKeyboardTexts().some(text => text.includes("محبوب‌ترین")));

// ---------- 17. admin rename + name shown in admins list and logs ----------
await runCallback("adminname:913000123", 222);
check("rename prompt opens", lastText().includes("نام نمایشی مدیر 913000123"));

await runText("رضا انبار", 222);
check("display name saved",
  db.prepare("SELECT name FROM admins WHERE id='913000123'").get().name === "رضا انبار");

await runCallback("admins", 222);
check("admins list shows name AND numeric id",
  lastKeyboardTexts().some(text => text.includes("رضا انبار") && text.includes("913000123")));

await runCallback("logs", 222);
check("log admin picker shows display name", lastKeyboardTexts().some(text => text.includes("رضا انبار")));

// ---------- 18. compact home keyboard (2 per row) ----------
await runText("/start", 222);
const rows = lastKeyboard().length;
const widest = Math.max(...lastKeyboard().map(row => row.length));
check("home keyboard rows are at most 2 buttons wide", widest <= 2 && rows >= 6);
check("stats and help share one row",
  lastKeyboard().some(row => row.length === 2 &&
    row.some(button => button.text.includes("آمار")) &&
    row.some(button => button.text.includes("راهنما"))));

// ---------- 22. help panel offers a contextual back button ----------
await runCallback("help:settings", 222);
check("help(settings) offers a back button to settings",
  lastKeyboard().flat().some(button => button.callback_data === "settings:0"));

await runCallback("help:orders", 222);
check("help(orders) offers a back button to orders",
  lastKeyboard().flat().some(button => button.callback_data === "orders:0"));

await runCallback("help:field:default_sort", 222);
check("field help offers a back button too",
  lastKeyboard().flat().some(button => button.callback_data === "settings:0"));

await runCallback("help:home", 222);
check("home help shows no back button (already at home)",
  !lastKeyboard().flat().some(button => button.callback_data === "home:"));

// ---------- 23. settings keyboard pairs short labels ----------
await runCallback("settings:0", 222);

const settingsKeyboard = lastKeyboard();
const settingButtonRows = settingsKeyboard.filter(row =>
  row.every(button => !["قبلی", "بعدی"].includes(button.text)));

check("settings keyboard pairs short buttons", settingButtonRows.some(row => row.length === 2));
check("settings long labels keep a full row",
  settingButtonRows.every(row => row.length !== 2 ||
    (row[0].text.length + row[1].text.length) <= 44));

// ---------- 24. new audit sections (users/security/system) ----------
await runCallback("logsel:222", 222);
check("log sections include all five sections",
  ["محصولات و محتوا", "سفارش‌ها", "کاربران", "امنیت و مدیران", "سیستم و تنظیمات"]
    .every(label => lastKeyboardTexts().some(text => text.includes(label))));

await runCallback("logview:222:security:0", 222);
check("security log view opens", lastText().includes("امنیت و مدیران"));

check("admin management ops audited under security",
  db.prepare("SELECT COUNT(*) AS c FROM admin_logs WHERE section='security'").get().c >= 1);

await runCallback("setting:store_name", 222);
await runText("فروشگاه نو", 222);
check("settings change audited under system",
  db.prepare("SELECT COUNT(*) AS c FROM admin_logs WHERE section='system'").get().c >= 1);

// ---------- 25. logo accepts PNG documents (transparency preserved) ----------
await runCallback("setting:logo", 222);
check("logo prompt mentions document formats",
  lastText().includes("PNG") && lastText().includes("Document"));

await runDocument(222, "image/png", "logo-doc.png");

const logoMedia = db.prepare(
  "SELECT id,mime FROM media WHERE kind='photo' AND mime='image/png' ORDER BY created_at DESC LIMIT 1"
).get();
check("PNG document stored with image/png mime", Boolean(logoMedia));
check("logo setting points at the new media row",
  logoMedia && JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key='logo'").get().value
  ) === logoMedia.id);

// An unsupported document mime is rejected with the Persian guidance
await runCallback("setting:logo", 222);
const beforeDocCalls = tgCalls.length;
await runDocument(222, "application/pdf", "not-an-image.pdf");
check("non-image document rejected with guidance",
  tgCalls.length > beforeDocCalls &&
  lastText().includes("PNG") && !lastText().startsWith("Error: Send"));

// ---------- summary ----------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
