// Integration test: customer accounts module (src/users.js)
// Real SQLite + mocked Kavenegar HTTP. Covers the OTP flow,
// anti-spam walls, session cookies and the self-service orders list.
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
  USERS_ENABLED: "on"
};

const ctx = { waitUntil() {} };

// ---------- mocked SMS providers ----------
const kavenegarCalls = [];
let kavenegarStatus = 200;
const farazCalls = [];
let farazStatus = 200;
const smsIrCalls = [];
let smsIrStatus = 200;
let smsIrBodyStatus = 1;

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);

  if (target.includes("api.kavenegar.com/v1/") && target.includes("/verify/lookup.json")) {
    kavenegarCalls.push({
      receptor: new URL(target).searchParams.get("receptor"),
      token: new URL(target).searchParams.get("token"),
      template: new URL(target).searchParams.get("template")
    });

    return new Response(JSON.stringify({
      return: { status: kavenegarStatus, message: kavenegarStatus === 200 ? "success" : "failed" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (target.includes("api2.farazsms.com/api/v2/") && target.includes("/verify/lookup/")) {
    const params = new URL(target).searchParams;
    farazCalls.push({
      receptor: params.get("receptor"),
      token: params.get("token"),
      template: params.get("template")
    });

    return new Response(JSON.stringify(
      farazStatus === 200
        ? { status: "success", data: { message: "ok" } }
        : { status: "error", code: 106, message: "template not found" }
    ), { status: farazStatus, headers: { "content-type": "application/json" } });
  }

  if (target.includes("api.sms.ir/v1/send/verify")) {
    const payload = JSON.parse(options.body || "{}");
    smsIrCalls.push({
      mobile: payload.mobile,
      templateId: payload.templateId,
      parameterName: payload.parameters?.[0]?.name,
      parameterValue: payload.parameters?.[0]?.value,
      apiKey: options.headers?.["x-api-key"]
    });

    return new Response(JSON.stringify({
      status: smsIrBodyStatus,
      message: smsIrBodyStatus === 1 ? "موفق" : "خطا",
      data: { packageStatus: "processed" }
    }), { status: smsIrStatus, headers: { "content-type": "application/json" } });
  }

  throw new Error("Unexpected fetch: " + target);
};

// ---------- apply migrations ----------
for (const file of fs.readdirSync("migrations").filter(f => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync("migrations/" + file, "utf8");
  for (const statement of sql.split(/^\s*-- statement-breakpoint\s*$/m).map(s => s.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}
console.log("migrations applied");

// ---------- module imports ----------
const { handleAccountAPI, accountPage } = await import("../src/users.js");
const { setSetting, AppError } = await import("../src/db.js");

let passed = 0, failed = 0;
function check(label, condition) {
  if (condition) { passed++; console.log("PASS -", label); }
  else { failed++; console.log("FAIL -", label); }
}

const ORIGIN = "https://shop.example.com";

function post(path, body, cookie) {
  return handleAccountAPI(new Request(ORIGIN + "/account/api/" + path, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body || {})
  }), env);
}

function get(path, cookie) {
  return handleAccountAPI(new Request(ORIGIN + "/account/api/" + path, {
    method: "GET",
    headers: cookie ? { cookie } : {}
  }), env);
}

function getCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function statusOf(promise) {
  try {
    await promise;
    return 200;
  } catch (error) {
    return error instanceof AppError ? error.status : 500;
  }
}

/*
 * The anti-spam limits (IP/hour, phone/hour, phone/day) are part of the
 * feature under test, but individual scenarios need a clean quota —
 * clearing the buckets keeps each scenario deterministic. The hour-limit
 * scenario below does NOT clear inside its loop.
 */
function clearRateLimits() {
  db.prepare("DELETE FROM rate_limits").run();
}

// ---------- 1. page + guards ----------
{
  const html = accountPage();
  check("account page renders", html.includes("حساب کاربری") && html.includes("دریافت کد تایید"));

  check("unknown route 404", await statusOf(get("nope")) === 404);
  check("me without session 401", await statusOf(get("me")) === 401);
  check("orders without session 401", await statusOf(get("orders")) === 401);
  check("tampered cookie 401", await statusOf(get("me", "account_session=1.2.3")) === 401);
}

// ---------- 2. OTP request needs configured Kavenegar ----------
{
  const status = await statusOf(post("otp/request", { phone: "09123456789" }));
  check("otp request without sms config 503", status === 503);

  await setSetting(env, "sms_api_key", "kavenegar-key-123");
  await setSetting(env, "sms_template", "shop-verify");

  const response = await post("otp/request", { phone: "۰۹۱۲۳۴۵۶۷۸۹" });
  const data = await response.json();
  check("persian digits phone accepted", data.ok === true && data.phone === "09123456789");
  check("kavenegar called with template", kavenegarCalls[0].template === "shop-verify");
  check("kavenegar receptor normalized", kavenegarCalls[0].receptor === "09123456789");
  check("kavenegar code is 6 digits", /^\d{6}$/.test(kavenegarCalls[0].token));
}

// ---------- 3. resend gap (90s) ----------
{
  const status = await statusOf(post("otp/request", { phone: "09123456789" }));
  check("resend within 90s blocked 429", status === 429);
}

// ---------- 4. wrong code attempts then correct ----------
const firstCode = kavenegarCalls[kavenegarCalls.length - 1].token;
{
  const bad1 = await statusOf(post("otp/verify", { phone: "09123456789", code: "000000" }));
  check("wrong code rejected 400", bad1 === 400);

  const attempts = db.prepare("SELECT attempts FROM user_otps WHERE phone='09123456789'").get().attempts;
  check("attempt counter incremented", attempts === 1);

  // simulate the 90s gap passing so a fresh code can be requested
  db.prepare("UPDATE user_otps SET created_at=? WHERE phone='09123456789'").run(Date.now() - 91000);
  clearRateLimits();

  const again = await statusOf(post("otp/request", { phone: "09123456789" }));
  check("resend after gap ok", again === 200);
}

const secondCode = kavenegarCalls[kavenegarCalls.length - 1].token;
check("new code differs", secondCode !== firstCode);

// old code must no longer verify (stored hash replaced)
{
  const status = await statusOf(post("otp/verify", { phone: "09123456789", code: firstCode }));
  check("old code rejected", status === 400);
}

// ---------- 5. five wrong entries lock the code ----------
{
  db.prepare("UPDATE user_otps SET created_at=? WHERE phone='09123456789'").run(Date.now() - 91000);
  clearRateLimits();
  await post("otp/request", { phone: "09123456789" });
  const code = kavenegarCalls[kavenegarCalls.length - 1].token;

  let lastStatus = 0;
  for (let i = 0; i < 6; i++) {
    lastStatus = await statusOf(post("otp/verify", { phone: "09123456789", code: i === 5 ? code : "111111" }));
  }

  check("five wrong entries lock code 429", lastStatus === 429);
  const row = db.prepare("SELECT COUNT(*) c FROM user_otps WHERE phone='09123456789'").get();
  check("locked code cleared", row.c === 0);
}

// ---------- 6. hour limit: 3 codes per phone ----------
{
  // Existing sends: 4 so far (1 + 1 + 1 + 1). The rate-limit window is
  // bucketed by absolute hour, so run requests in a fresh window by
  // shifting stored buckets is not possible — instead verify the 429
  // path fires when the bucket is already full.
  // Simplest deterministic check: three requests in THIS test window
  // started at count 4 for previous buckets; bucket boundary unknown.
  // So we test the hour limit directly: make a brand new phone and
  // request 3 codes then expect 429 on the 4th.
  const phone = "09351112233";

  for (let i = 0; i < 3; i++) {
    db.prepare("DELETE FROM user_otps WHERE phone=?").run(phone);
    db.prepare("UPDATE user_otps SET created_at=? WHERE phone=?").run(Date.now() - 91000, phone);
    // gap guard bypassed by deleting the row first
    const status = await statusOf(post("otp/request", { phone }));
    if (status !== 200) { check("hour limit: 3 sends allowed (got " + status + " on #" + (i + 1) + ")", false); break; }
    if (i === 2) check("hour limit: 3 sends allowed", true);
  }

  const fourth = await statusOf(post("otp/request", { phone }));
  check("4th code within an hour blocked 429", fourth === 429);
}

// ---------- 7. successful login ----------
let sessionCookie = "";
{
  const phone = "09123456789";
  clearRateLimits();
  db.prepare("DELETE FROM user_otps WHERE phone=?").run(phone);
  await post("otp/request", { phone });
  const code = kavenegarCalls[kavenegarCalls.length - 1].token;

  // also verify +98 normalization maps to the same user
  const response = await post("otp/verify", { phone: "+989123456789", code });
  const data = await response.json();
  sessionCookie = getCookie(response);

  check("verify ok with +98 variant", data.ok === true && data.user.phone === "09123456789");
  check("session cookie issued", /account_session=[a-f0-9]{32}\.\d+\.[a-f0-9]{64}/.test(sessionCookie));

  const user = db.prepare("SELECT * FROM shop_users WHERE phone='09123456789'").get();
  check("shop_users row created", Boolean(user?.id));
  check("otp row cleared after login", db.prepare("SELECT COUNT(*) c FROM user_otps WHERE phone='09123456789'").get().c === 0);
}

// ---------- 8. session works + second login reuses user ----------
{
  const me = await (await get("me", sessionCookie)).json();
  check("me returns phone", me.user.phone === "09123456789");
  check("me returns memberSince", Number(me.user.memberSince) > 0);

  clearRateLimits();
  db.prepare("DELETE FROM user_otps WHERE phone='09123456789'").run();
  await post("otp/request", { phone: "09123456789" });
  const code = kavenegarCalls[kavenegarCalls.length - 1].token;
  const response2 = await post("otp/verify", { phone: "09123456789", code });
  await response2.json();

  const users = db.prepare("SELECT COUNT(*) c FROM shop_users WHERE phone='09123456789'").get();
  check("second login does not duplicate user", users.c === 1);
}

// ---------- 9. orders matched by phone ----------
{
  db.prepare(
    "INSERT INTO orders(id,request_id,request_hash,code,name,phone,address,subtotal,shipping,discount,total,status,payment_method,gateway,created_at,updated_at) " +
    "VALUES('o1',?,?,'ABC123','مشتری','09123456789','تهران، خیابان یک، پلاک ۲',200000,0,0,200000,'new','contact','',?,?)"
  ).run("r" + Date.now() + "a", "h" + Date.now(), Date.now(), Date.now());

  db.prepare(
    "INSERT INTO orders(id,request_id,request_hash,code,name,phone,address,subtotal,shipping,discount,total,status,payment_method,gateway,created_at,updated_at) " +
    "VALUES('o2',?,?,'DEF456','مشتری','09120000000','تهران، خیابان یک، پلاک ۲',100000,0,0,100000,'new','contact','',?,?)"
  ).run("r" + Date.now() + "b", "h" + Date.now(), Date.now(), Date.now());

  const data = await (await get("orders", sessionCookie)).json();
  check("only own orders returned", data.orders.length === 1 && data.orders[0].code === "ABC123");
  check("order fields mapped", data.orders[0].paymentMethod === "contact" && data.orders[0].total === 200000);
}

// ---------- 10. logout ----------
{
  const response = await post("logout", {}, sessionCookie);
  const data = await response.json();
  check("logout ok", data.ok === true);
  check("logout clears cookie", (response.headers.get("set-cookie") || "").includes("Max-Age=0"));
}

// ---------- 11. kavenegar failure surfaces 502 ----------
{
  clearRateLimits();
  kavenegarStatus = 418;
  const phone = "09355556666";
  const status = await statusOf(post("otp/request", { phone }));
  check("kavenegar failure 502", status === 502);
  check("failed send does not start resend timer",
    db.prepare("SELECT COUNT(*) c FROM user_otps WHERE phone='09355556666'").get().c === 0);
  kavenegarStatus = 200;
}

// ---------- 12. farazsms provider ----------
{
  clearRateLimits();
  await setSetting(env, "sms_provider", "farazsms");
  farazStatus = 200;

  const phone = "09360001122";
  await post("otp/request", { phone });

  check("farazsms verify lookup called with code + template",
    farazCalls.length === 1 &&
    farazCalls[0].receptor === phone &&
    /^\d{6}$/.test(farazCalls[0].token) &&
    farazCalls[0].template === "shop-verify");

  clearRateLimits();
  farazStatus = 400;
  const failure = await statusOf(post("otp/request", { phone: "09360002233" }));
  check("farazsms failure 502", failure === 502);
  farazStatus = 200;
}

// ---------- 13. sms.ir provider (numeric TemplateId + CODE parameter) ----------
{
  clearRateLimits();
  await setSetting(env, "sms_provider", "smsir");
  await setSetting(env, "sms_template", "1000123");
  smsIrBodyStatus = 1;

  const phone = "09370003344";
  await post("otp/request", { phone });

  check("sms.ir verify called with numeric templateId and CODE param",
    smsIrCalls.length === 1 &&
    smsIrCalls[0].mobile === phone &&
    smsIrCalls[0].templateId === 1000123 &&
    smsIrCalls[0].parameterName === "CODE" &&
    /^\d{6}$/.test(smsIrCalls[0].parameterValue) &&
    smsIrCalls[0].apiKey === "kavenegar-key-123");

  clearRateLimits();
  smsIrBodyStatus = 4;
  const rejected = await statusOf(post("otp/request", { phone: "09370004455" }));
  check("sms.ir status!=1 surfaces 502", rejected === 502);

  clearRateLimits();
  await setSetting(env, "sms_template", "shop-verify");
  const nonNumeric = await statusOf(post("otp/request", { phone: "09370005566" }));
  check("sms.ir non-numeric template rejected 503", nonNumeric === 503);

  await setSetting(env, "sms_template", "shop-verify");
  await setSetting(env, "sms_provider", "kavenegar");
  smsIrBodyStatus = 1;
}

// ---------- 14. blocked users cannot log in or use sessions ----------
{
  clearRateLimits();
  const now = Date.now();
  const phone = "09380006677";

  db.prepare(
    "INSERT INTO shop_users(id,phone,name,blocked,created_at,last_login_at) VALUES(?,?,?,1,?,?)"
  ).run("b1b2c3d4e5f60718293a4b5c6d7e8f91", phone, "مسدود تست", now, now);

  check("blocked phone never receives a code",
    await statusOf(post("otp/request", { phone })) === 403);

  // Unblock, log in normally, then block again — the live session dies.
  db.prepare("UPDATE shop_users SET blocked=0 WHERE phone=?").run(phone);
  clearRateLimits();

  await post("otp/request", { phone });
  const code = kavenegarCalls[kavenegarCalls.length - 1]?.token ||
    farazCalls[farazCalls.length - 1]?.token || "";
  const verifyResponse = await post("otp/verify", { phone, code });
  check("unblocked user can log in", verifyResponse.status === 200);

  const cookie = getCookie(verifyResponse);
  check("session works before block", (await (await get("me", cookie)).json()).user.phone === phone);

  db.prepare("UPDATE shop_users SET blocked=1 WHERE phone=?").run(phone);
  check("blocked user session dies with 403", await statusOf(get("me", cookie)) === 403);
}

console.log("\n========================");
console.log("PASSED: " + passed + " | FAILED: " + failed);
console.log("========================");
process.exit(failed ? 1 : 0);
