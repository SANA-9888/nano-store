// ============================================================
// Persian Store V2 — Optional customer accounts (mobile + OTP)
// Self-contained module: registration/login with a Verify SMS
// code (Kavenegar, FarazSMS or SMS.ir), plus a small self-service
// panel that shows the customer's own orders and their statuses.
//
// Isolation contract (same pattern as src/miniapp.js):
//   - the whole feature lives in this single file plus routes
//     15/16 of worker.js and migration 0009_user_accounts.sql
//   - set USERS_ENABLED=off / false / 0 (var) to disable it
//   - deleting this file + the two routes + the migration
//     removes the feature with no side effects
//
// Anti-spam (standard policy):
//   - 90 seconds between two SMS codes for the same phone
//   - max 3 codes per phone per hour, 10 per day
//   - max 10 code requests per IP per hour
//   - max 5 wrong entries per code, code expires after 5 minutes
// ============================================================

import {
  AppError,
  responseJSON,
  readJSON,
  rows,
  one,
  execute,
  getSettings,
  requireOrigin,
  rateLimit,
  ipKey,
  sha256,
  uid
} from "./db.js";

import {
  SMS_PROVIDERS,
  smsProviderLabel,
  digits as faDigits
} from "./defaults.js";

const OTP_TTL = 5 * 60 * 1000;
const OTP_RESEND_GAP = 90 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const SESSION_COOKIE = "account_session";
const ORDERS_LIMIT = 60;

/* Accepts Persian/Arabic digits, +98 / 98 / 0098 prefixes; returns 09xxxxxxxxx. */
function normalizePhone(value) {
  const digits = String(value || "")
    .replace(/[۰-۹]/g, ch => "۰۱۲۳۴۵۶۷۸۹".indexOf(ch))
    .replace(/[٠-٩]/g, ch => "٠١٢٣٤٥٦٧٨٩".indexOf(ch))
    .replace(/\D/g, "");

  const local = digits
    .replace(/^0098/, "0")
    .replace(/^98(?=9\d{9}$)/, "0");

  if (!/^9\d{9}$/.test(local.replace(/^0/, "")) && !/^9\d{9}$/.test(local)) {
    throw new AppError(400, "شماره موبایل معتبر نیست؛ با ۰۹ وارد کنید.");
  }

  const normalized = local.startsWith("0") ? local : "0" + local;

  if (!/^09\d{9}$/.test(normalized)) {
    throw new AppError(400, "شماره موبایل معتبر نیست؛ با ۰۹ وارد کنید.");
  }

  return normalized;
}

// ------------------------------------------------------------
// Session tokens: payload.userId.expiry + HMAC signature.
// The signing secret derives from the bot token, so every shop
// gets an independent secret without extra settings.
// ------------------------------------------------------------

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return [...new Uint8Array(signature)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function issueSessionToken(env, userId) {
  const secret = await sha256("persian-store-account:" + String(env.BOT_TOKEN || ""));
  const payload = userId + "." + (Date.now() + SESSION_TTL);
  return payload + "." + await hmacHex(secret, payload);
}

async function verifySessionToken(env, token) {
  const parts = String(token || "").split(".");

  if (parts.length !== 3) return null;

  const [userId, expiry, signature] = parts;

  if (!/^[a-f0-9]{32}$/.test(userId || "") || !/^\d{13,16}$/.test(expiry || "")) {
    return null;
  }

  if (Number(expiry) < Date.now()) return null;

  const secret = await sha256("persian-store-account:" + String(env.BOT_TOKEN || ""));
  const expected = await hmacHex(secret, userId + "." + expiry);

  if (signature !== expected) return null;

  return userId;
}

function sessionCookie(token) {
  return SESSION_COOKIE + "=" + token +
    "; Path=/; Max-Age=" + Math.floor(SESSION_TTL / 1000) +
    "; HttpOnly; Secure; SameSite=Lax";
}

function clearedCookie() {
  return SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

function readSessionCookie(request) {
  const header = request.headers.get("cookie") || "";

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }

  return "";
}

/* Resolves the logged-in customer or throws 401. */
async function requireUser(request, env) {
  const userId = await verifySessionToken(env, readSessionCookie(request));

  if (!userId) {
    throw new AppError(401, "وارد حساب خود نشده‌اید.");
  }

  const user = await one(
    env,
    "SELECT id,phone,name,blocked,created_at,last_login_at FROM shop_users WHERE id=?",
    [userId]
  );

  if (!user) {
    throw new AppError(401, "حساب پیدا نشد؛ دوباره وارد شوید.");
  }

  // A blocked customer loses access immediately, even with a live cookie.
  if (user.blocked) {
    throw new AppError(403, "دسترسی این حساب توسط مدیر فروشگاه مسدود شده است.");
  }

  return user;
}

// ------------------------------------------------------------
// SMS OTP delivery — Kavenegar / FarazSMS / SMS.ir (Verify templates)
// ------------------------------------------------------------

function providerDetail(data) {
  const raw = data?.message || data?.return?.message || data?.data?.message || "";

  return raw ? " (" + String(raw).slice(0, 80) + ")" : "";
}

async function sendKavenegar(apiKey, phone, code, template) {
  const url =
    "https://api.kavenegar.com/v1/" + encodeURIComponent(apiKey) +
    "/verify/lookup.json?receptor=" + encodeURIComponent(phone) +
    "&token=" + encodeURIComponent(code) +
    "&template=" + encodeURIComponent(template);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json().catch(() => null);

  // Kavenegar responds { return: { status: 200, message: ... } }
  if (!data || !data.return || Number(data.return.status) !== 200) {
    throw new Error(providerDetail(data) || " پاسخ نامعتبر درگاه.");
  }
}

async function sendFarazSMS(apiKey, phone, code, template) {
  // FarazSMS (IPPanel) v2 verify lookup — API key rides in the path.
  const url =
    "https://api2.farazsms.com/api/v2/" + encodeURIComponent(apiKey) +
    "/verify/lookup/?receptor=" + encodeURIComponent(phone) +
    "&token=" + encodeURIComponent(code) +
    "&template=" + encodeURIComponent(template);

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json().catch(() => null);

  // 2xx with status != "error" counts as accepted.
  if (!response.ok || (data && String(data.status).toLowerCase() === "error")) {
    throw new Error(providerDetail(data) || " HTTP " + response.status);
  }
}

async function sendSmsIr(apiKey, phone, code, template) {
  // SMS.ir needs a numeric TemplateId whose parameter is named CODE.
  const templateId = faDigits(template).trim();

  if (!/^\d{1,12}$/.test(templateId)) {
    throw new AppError(
      503,
      "قالب SMS.ir باید شناسه عددی (TemplateId) باشد؛ مثال: 1000123"
    );
  }

  const response = await fetch("https://api.sms.ir/v1/send/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      mobile: phone,
      templateId: Number(templateId),
      parameters: [{ name: "CODE", value: code }]
    }),
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json().catch(() => null);

  // SMS.ir responds { status: 1, message: "موفق", data: {...} }
  if (!data || Number(data.status) !== 1) {
    throw new Error(providerDetail(data) || " پاسخ نامعتبر درگاه.");
  }
}

async function sendOtpSms(config, phone, code) {
  const provider = SMS_PROVIDERS.includes(config.sms_provider)
    ? config.sms_provider
    : "kavenegar";
  const apiKey = String(config.sms_api_key || "").trim();
  const template = String(config.sms_template || "").trim();

  if (!apiKey || !template) {
    throw new AppError(
      503,
      "ثبت‌نام با کد تایید هنوز فعال نشده است؛ مدیر باید سرویس پیامک، کلید API و قالب را در تنظیمات وارد کند."
    );
  }

  try {
    if (provider === "farazsms") {
      await sendFarazSMS(apiKey, phone, code, template);
    } else if (provider === "smsir") {
      await sendSmsIr(apiKey, phone, code, template);
    } else {
      await sendKavenegar(apiKey, phone, code, template);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new AppError(
      502,
      "ارسال پیامک با " + smsProviderLabel(provider) + " ناموفق بود" +
      (error instanceof Error ? providerDetail({ message: error.message }) : "") +
      "؛ کمی بعد دوباره تلاش کنید."
    );
  }
}

// ------------------------------------------------------------
// OTP request / verify
// ------------------------------------------------------------

export async function handleOtpRequest(request, env) {
  await requireOrigin(request);
  const body = await readJSON(request);
  const phone = normalizePhone(body?.phone);

  // Standard anti-spam walls; each returns a Persian 429 when tripped.
  await rateLimit(env, ipKey(request, "acc-otp-ip"), 10, 3600);
  await rateLimit(env, "acc-otp-hour:" + phone, 3, 3600);
  await rateLimit(env, "acc-otp-day:" + phone, 10, 86400);

  const previous = await one(
    env,
    "SELECT created_at FROM user_otps WHERE phone=?",
    [phone]
  );

  if (previous && Date.now() - previous.created_at < OTP_RESEND_GAP) {
    const wait = Math.ceil(
      (OTP_RESEND_GAP - (Date.now() - previous.created_at)) / 1000
    );

    throw new AppError(429, "برای ارسال کد جدید " + wait + " ثانیه دیگر تلاش کنید.");
  }

  // Blocked customers never receive codes in the first place.
  const known = await one(
    env,
    "SELECT blocked FROM shop_users WHERE phone=?",
    [phone]
  );

  if (known?.blocked) {
    throw new AppError(403, "دسترسی این شماره توسط مدیر فروشگاه مسدود شده است.");
  }

  const config = await getSettings(env);
  const code = String(Math.floor(100000 + Math.random() * 900000));

  // Send BEFORE storing: a failed SMS must not start the resend timer.
  await sendOtpSms(config, phone, code);

  const codeHash = await sha256("otp:" + phone + ":" + code);
  const now = Date.now();

  await execute(
    env,
    "INSERT INTO user_otps(phone,code_hash,attempts,expires_at,created_at) " +
    "VALUES(?,?,0,?,?) " +
    "ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,attempts=0," +
    "expires_at=excluded.expires_at,created_at=excluded.created_at",
    [phone, codeHash, now + OTP_TTL, now]
  );

  return {
    ok: true,
    phone,
    expiresInSeconds: Math.floor(OTP_TTL / 1000),
    resendInSeconds: Math.ceil(OTP_RESEND_GAP / 1000)
  };
}

export async function handleOtpVerify(request, env) {
  await requireOrigin(request);
  const body = await readJSON(request);
  const phone = normalizePhone(body?.phone);

  const code = String(body?.code || "")
    .replace(/[۰-۹]/g, ch => "۰۱۲۳۴۵۶۷۸۹".indexOf(ch))
    .replace(/[٠-٩]/g, ch => "٠١٢٣٤٥٦٧٨٩".indexOf(ch))
    .replace(/\D/g, "");

  await rateLimit(env, ipKey(request, "acc-verify-ip"), 20, 3600);

  if (!/^\d{6}$/.test(code)) {
    throw new AppError(400, "کد تایید ۶ رقمی را وارد کنید.");
  }

  const record = await one(
    env,
    "SELECT code_hash,attempts,expires_at FROM user_otps WHERE phone=?",
    [phone]
  );

  if (!record) {
    throw new AppError(400, "ابتدا کد تایید بگیرید.");
  }

  if (record.expires_at < Date.now()) {
    await execute(env, "DELETE FROM user_otps WHERE phone=?", [phone]);
    throw new AppError(400, "کد تایید منقضی شده است؛ کد جدید بگیرید.");
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await execute(env, "DELETE FROM user_otps WHERE phone=?", [phone]);
    throw new AppError(429, "تلاش‌های ناموفق زیاد بود؛ کد جدید بگیرید.");
  }

  const codeHash = await sha256("otp:" + phone + ":" + code);

  if (codeHash !== record.code_hash) {
    await execute(
      env,
      "UPDATE user_otps SET attempts=attempts+1 WHERE phone=?",
      [phone]
    );

    const left = OTP_MAX_ATTEMPTS - record.attempts - 1;
    throw new AppError(
      400,
      "کد اشتباه است؛ " + left + " تلاش باقی مانده است."
    );
  }

  await execute(env, "DELETE FROM user_otps WHERE phone=?", [phone]);

  const now = Date.now();
  const existing = await one(
    env,
    "SELECT id,blocked FROM shop_users WHERE phone=?",
    [phone]
  );

  if (existing?.blocked) {
    throw new AppError(403, "دسترسی این حساب توسط مدیر فروشگاه مسدود شده است.");
  }

  let userId;

  if (existing?.id) {
    userId = existing.id;
    await execute(
      env,
      "UPDATE shop_users SET last_login_at=? WHERE id=?",
      [now, userId]
    );
  } else {
    userId = uid();
    await execute(
      env,
      "INSERT INTO shop_users(id,phone,name,created_at,last_login_at) VALUES(?,?, '', ?, ?)",
      [userId, phone, now, now]
    );
  }

  const token = await issueSessionToken(env, userId);
  const response = responseJSON({
    ok: true,
    user: { phone }
  });

  response.headers.append("set-cookie", sessionCookie(token));
  return response;
}

// ------------------------------------------------------------
// Session endpoints
// ------------------------------------------------------------

async function handleMe(request, env) {
  const user = await requireUser(request, env);

  return {
    user: {
      phone: user.phone,
      name: user.name || "",
      memberSince: user.created_at,
      lastLogin: user.last_login_at
    }
  };
}

async function handleMyOrders(request, env) {
  const user = await requireUser(request, env);

  const records = await rows(
    env,
    "SELECT code,status,payment_status,payment_method,gateway," +
    "subtotal,shipping,discount,total,created_at " +
    "FROM orders WHERE phone=? ORDER BY created_at DESC,id DESC LIMIT " + ORDERS_LIMIT,
    [user.phone]
  );

  return {
    orders: records.map(order => ({
      code: order.code,
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMethod: order.gateway ? "gateway" : order.payment_method,
      gateway: order.gateway || "",
      subtotal: order.subtotal,
      shipping: order.shipping,
      discount: order.discount,
      total: order.total,
      createdAt: order.created_at
    }))
  };
}

async function handleLogout(request, env) {
  await requireOrigin(request);
  await requireUser(request, env);

  const response = responseJSON({ ok: true });
  response.headers.append("set-cookie", clearedCookie());
  return response;
}

// ------------------------------------------------------------
// Router for /account/api/*
// ------------------------------------------------------------

export async function handleAccountAPI(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.slice("/account/api/".length).replace(/\/+$/, "");

  if (request.method === "POST" && route === "otp/request") {
    return responseJSON(await handleOtpRequest(request, env));
  }

  if (request.method === "POST" && route === "otp/verify") {
    return handleOtpVerify(request, env);
  }

  if (request.method === "POST" && route === "logout") {
    return handleLogout(request, env);
  }

  if (request.method === "GET" && route === "me") {
    return responseJSON(await handleMe(request, env));
  }

  if (request.method === "GET" && route === "orders") {
    return responseJSON(await handleMyOrders(request, env));
  }

  throw new AppError(404, "Endpoint not found.");
}

// ============================================================
// accountPage() — the customer-facing panel
// ============================================================

export function accountPage() {
  return String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#637c68">
<meta name="robots" content="noindex">
<title>حساب کاربری</title>

<link rel="stylesheet"
 href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">

<style>
:root{
 --brand:#637c68;
 --bg:#fafbf9;
 --surface:#fff;
 --text:#24332a;
 --muted:#718077;
 --line:#e5ebe5;
 --soft:#f0f4ef;
 --danger:#b73747;
 --shadow:0 12px 36px #26382b09;
 --radius:24px;
 --font:Vazirmatn,Tahoma,sans-serif;
 color-scheme:light;
}
*{box-sizing:border-box}
body{
 margin:0;background:var(--bg);color:var(--text);
 font-family:var(--font);line-height:1.9;
 min-height:100vh;
 padding-bottom:calc(30px + env(safe-area-inset-bottom));
}
button,input{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
button{
 min-height:46px;border:1px solid var(--line);border-radius:14px;
 padding:9px 15px;background:var(--surface);cursor:pointer;
 transition:background .16s,transform .16s;
}
button:hover{background:var(--soft)}
button:active{transform:scale(.98)}
button:disabled{opacity:.5;cursor:not-allowed}
button:disabled:active{transform:none}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
input{
 width:100%;min-height:48px;padding:11px 14px;
 border:1px solid var(--line);border-radius:14px;background:var(--surface);
}
label{display:grid;gap:7px;font-size:.9rem}
[hidden]{display:none!important}
.wrap{width:min(560px,calc(100% - 28px));margin-inline:auto}
.topbar{
 position:sticky;top:0;z-index:10;
 background:var(--surface);border-bottom:1px solid var(--line);
 padding:14px 0;
 box-shadow:0 5px 22px #20312505;
}
.topbar .wrap{display:flex;align-items:center;justify-content:space-between;gap:10px}
.topbar h1{margin:0;font-size:1.08rem}
.topbar a{font-size:.85rem}
.panel{
 background:var(--surface);border:1px solid var(--line);
 border-radius:var(--radius);padding:22px;
 box-shadow:var(--shadow);margin-top:18px;
}
h2{margin:0 0 6px;font-size:1.12rem}
h3{margin:0 0 10px;font-size:.98rem}
.muted{color:var(--muted)}
.small{font-size:.82rem}
.pre{white-space:pre-wrap;overflow-wrap:anywhere}
.error{
 color:var(--danger);font-size:.87rem;
 white-space:pre-wrap;overflow-wrap:anywhere;
}
.row{display:flex;align-items:center;gap:10px}
.between{justify-content:space-between}
.wide{width:100%}
.primary{background:var(--brand);color:#fff;border-color:transparent}
.primary:hover{background:var(--brand);filter:brightness(1.07)}
.danger{color:var(--danger);border-color:var(--danger)}
.field{margin-bottom:14px}
.chip{
 display:inline-flex;align-items:center;gap:6px;
 border:1px solid var(--line);border-radius:999px;
 padding:4px 13px;font-size:.78rem;background:var(--soft);
}
.order-line{
 border:1px solid var(--line);border-radius:16px;
 padding:13px 15px;margin-bottom:11px;background:var(--bg);
}
.order-line .code{font-weight:800;letter-spacing:.4px}
.badge{
 display:inline-flex;align-items:center;border-radius:999px;
 padding:2px 11px;font-size:.72rem;border:1px solid var(--line);
}
.badge.g{color:#2e7d4f;border-color:#bfe3cd;background:#effaf3}
.badge.y{color:#8a6116;border-color:#f0dcae;background:#fdf7e7}
.badge.r{color:var(--danger);border-color:#f2c7cd;background:#fdeff1}
.badge.x{color:var(--muted)}
.totals{display:grid;gap:2px;font-size:.85rem}
.totals div{display:flex;justify-content:space-between;gap:12px}
.totals .grand{border-top:1px dashed var(--line);padding-top:5px;font-weight:800}
.empty{text-align:center;padding:34px 12px;color:var(--muted)}
#toast{
 position:fixed;inset:0;margin:auto;margin-bottom:110px;
 width:max-content;max-width:calc(100% - 40px);
 background:#24332a;color:#fff;border-radius:14px;
 padding:11px 20px;font-size:.87rem;
 box-shadow:0 14px 34px #0005;opacity:0;
 pointer-events:none;transition:opacity .2s;
}
#toast.show{opacity:1}
#toast.err{background:var(--danger)}
</style>
</head>
<body>

<header class="topbar">
 <div class="wrap">
  <h1>حساب کاربری</h1>
  <a href="/">بازگشت به فروشگاه ←</a>
 </div>
</header>

<main class="wrap">

 <!-- ورود / ثبت‌نام -->
 <section id="auth-card" class="panel" hidden>
  <div id="step-phone">
   <h2>ورود یا ثبت‌نام</h2>
   <p class="muted small">
    شماره موبایل خود را وارد کنید؛ یک کد ۶ رقمی برای شما پیامک می‌شود.
    اگر قبلاً ثبت‌نام کرده باشید، مستقیماً وارد حساب‌تان می‌شوید.
   </p>
   <div class="field">
    <label>شماره موبایل
     <input id="phone" type="tel" inputmode="tel" maxlength="13" dir="ltr"
      placeholder="09123456789" autocomplete="tel">
    </label>
   </div>
   <div id="phone-error" class="error" role="alert"></div>
   <button id="send-otp" class="primary wide">دریافت کد تایید</button>
   <p class="muted small" style="margin-bottom:0">
    با ورود، شماره شما برای پیگیری سفارش‌ها در این فروشگاه ثبت می‌شود.
   </p>
  </div>

  <div id="step-code" hidden>
   <h2>کد تایید را وارد کنید</h2>
   <p class="muted small">
    کد ۶ رقمی به شماره <b id="phone-echo" dir="ltr"></b> پیامک شد.
    <span id="code-timer" class="muted"></span>
   </p>
   <div class="field">
    <label>کد تایید
     <input id="code" inputmode="numeric" maxlength="6" dir="ltr"
      placeholder="- - - - - -" autocomplete="one-time-code">
    </label>
   </div>
   <div id="code-error" class="error" role="alert"></div>
   <button id="verify-otp" class="primary wide">تایید و ورود</button>
   <div class="row" style="margin-top:10px">
    <button id="resend-otp" class="small" disabled>ارسال مجدد کد</button>
    <button id="change-phone" class="small">تغییر شماره</button>
   </div>
  </div>
 </section>

 <!-- پنل کاربر -->
 <section id="panel" hidden>
  <div class="panel">
   <div class="row between">
    <div>
     <h2>خوش آمدید 👋</h2>
     <span class="chip" id="user-phone" dir="ltr"></span>
     <span class="muted small" id="member-since"></span>
    </div>
    <button id="logout" class="danger small">خروج</button>
   </div>
   <p class="muted small" style="margin-bottom:0">
    سفارش‌هایی که با همین شماره ثبت شده‌اند در فهرست زیر دیده می‌شوند.
   </p>
  </div>

  <div class="panel">
   <div class="row between" style="margin-bottom:12px">
    <h3 style="margin:0">🧾 سفارش‌های من</h3>
    <button id="refresh-orders" class="small">تازه‌سازی</button>
   </div>
   <div id="orders-error" class="error" role="alert" style="margin-bottom:10px"></div>
   <div id="orders-list"><div class="empty">در حال دریافت…</div></div>
  </div>
 </section>

 <!-- حالت بررسی نشست -->
 <section id="boot" class="panel">
  <div class="empty">در حال بررسی حساب شما…</div>
 </section>
</main>

<div id="toast" role="status"></div>

<script>
(function () {
"use strict";

var currentPhone = "";
var countdownTimer = null;

function $(id) { return document.getElementById(id); }

function fa(value) {
  return Number(value || 0).toLocaleString("fa-IR");
}

function money(value) {
  return fa(value) + " تومان";
}

function dateFa(ts) {
  try {
    return new Date(Number(ts)).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
  } catch (e) { return "—"; }
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

var toastTimer = null;

function toast(message, isError) {
  var el = $("toast");
  clearTimeout(toastTimer);
  el.className = isError ? "err" : "";
  el.classList.add("show");
  el.textContent = message;
  toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3800);
}

function api(path, options) {
  options = options || {};
  return fetch("/account/api/" + path, options).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok) {
        throw new Error(data && data.error ? data.error : "خطای نامشخص (" + response.status + ")");
      }
      return data;
    });
  });
}

var STATUS_LABELS = {
  "new": "ثبت اولیه",
  "confirmed": "تأییدشده",
  "sent": "ارسال‌شده",
  "cancelled": "لغوشده"
};

var PAYMENT_LABELS = {
  unpaid: "پرداخت تأیید نشده",
  review: "رسید در انتظار بررسی",
  paid: "پرداخت تأیید شده"
};

var GATEWAY_NAMES = {
  zarinpal: "زرین‌پال",
  zibal: "زیبال",
  snapppay: "اسنپ‌پی"
};

function statusBadge(status) {
  var cls = status === "sent" ? "g" : status === "cancelled" ? "r" : status === "confirmed" ? "g" : "y";
  var label = STATUS_LABELS[status] || status;
  return '<span class="badge ' + cls + '">' + esc(label) + "</span>";
}

function paymentBadge(order) {
  var label = PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus;
  var cls = order.paymentStatus === "paid" ? "g" : order.paymentStatus === "review" ? "y" : "x";
  var method = order.paymentMethod === "gateway"
    ? "آنلاین (" + (GATEWAY_NAMES[order.gateway] || order.gateway || "") + ")"
    : order.paymentMethod === "card" ? "کارت‌به‌کارت" : "هماهنگی با مدیر";

  return '<span class="badge ' + cls + '">' + esc(label) + "</span>" +
    '<span class="badge">' + esc(method) + "</span>";
}

function showAuth() {
  $("boot").hidden = true;
  $("panel").hidden = true;
  $("auth-card").hidden = false;
  $("step-phone").hidden = false;
  $("step-code").hidden = true;
  $("phone-error").textContent = "";
  $("code-error").textContent = "";
  $("code").value = "";
}

function showPanel(user) {
  $("boot").hidden = true;
  $("auth-card").hidden = true;
  $("panel").hidden = false;
  $("user-phone").textContent = user.phone || "";
  $("member-since").textContent = user.memberSince
    ? "· عضو از " + dateFa(user.memberSince) : "";
  loadOrders();
}

function showCodeStep(phone, meta) {
  currentPhone = phone;
  $("phone-echo").textContent = phone;
  $("step-phone").hidden = true;
  $("step-code").hidden = false;
  $("code-error").textContent = "";
  $("code").value = "";
  $("code").focus();
  startCountdown(meta && meta.resendInSeconds ? meta.resendInSeconds : 90);
}

function startCountdown(seconds) {
  clearInterval(countdownTimer);
  var left = Number(seconds) || 90;
  var button = $("resend-otp");
  var label = $("code-timer");

  button.disabled = true;

  countdownTimer = setInterval(function () {
    left -= 1;
    if (left > 0) {
      label.textContent = "· ارسال مجدد تا " + fa(left) + " ثانیه دیگر";
      button.disabled = true;
    } else {
      clearInterval(countdownTimer);
      label.textContent = "";
      button.disabled = false;
    }
  }, 1000);
}

function requestOtp() {
  var phone = $("phone").value.trim();
  $("phone-error").textContent = "";

  $("send-otp").disabled = true;

  api("otp/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: phone })
  }).then(function (result) {
    toast("کد تایید پیامک شد.");
    showCodeStep(result.phone || phone, result);
  }).catch(function (error) {
    $("phone-error").textContent = error.message;
  }).finally(function () {
    $("send-otp").disabled = false;
  });
}

function verifyOtp() {
  var code = $("code").value.trim();
  $("code-error").textContent = "";

  $("verify-otp").disabled = true;

  api("otp/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: currentPhone, code: code })
  }).then(function () {
    toast("خوش آمدید!");
    return api("me").then(function (data) { showPanel(data.user); });
  }).catch(function (error) {
    $("code-error").textContent = error.message;
  }).finally(function () {
    $("verify-otp").disabled = false;
  });
}

function loadOrders() {
  $("orders-error").textContent = "";
  $("orders-list").innerHTML = '<div class="empty">در حال دریافت…</div>';

  api("orders").then(function (data) {
    var orders = data.orders || [];

    if (!orders.length) {
      $("orders-list").innerHTML =
        '<div class="empty">هنوز سفارشی با این شماره ثبت نشده است.<br>' +
        '<a href="/">رفتن به فروشگاه</a></div>';
      return;
    }

    $("orders-list").innerHTML = orders.map(function (order) {
      return '<article class="order-line">' +
        '<div class="row between"><span class="code">' + esc(order.code) + "</span>" +
        statusBadge(order.status) + "</div>" +
        '<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">' +
        paymentBadge(order) + "</div>" +
        '<div class="totals" style="margin-top:8px">' +
        "<div><span class='muted'>کالاها</span><span>" + money(order.subtotal) + "</span></div>" +
        "<div><span class='muted'>ارسال</span><span>" + money(order.shipping) + "</span></div>" +
        (order.discount
          ? "<div><span class='muted'>تخفیف</span><span>-" + money(order.discount) + "</span></div>"
          : "") +
        '<div class="grand"><span>مبلغ نهایی</span><span>' + money(order.total) + "</span></div>" +
        "</div>" +
        '<div class="muted small" style="margin-top:6px">ثبت: ' + dateFa(order.createdAt) + "</div>" +
        "</article>";
    }).join("");
  }).catch(function (error) {
    $("orders-list").innerHTML = "";
    $("orders-error").textContent = error.message;
  });
}

$("send-otp").onclick = requestOtp;
$("verify-otp").onclick = verifyOtp;

$("resend-otp").onclick = function () {
  $("code-error").textContent = "";
  $("resend-otp").disabled = true;

  api("otp/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: currentPhone })
  }).then(function (result) {
    toast("کد جدید پیامک شد.");
    startCountdown(result.resendInSeconds || 90);
  }).catch(function (error) {
    $("code-error").textContent = error.message;
    $("resend-otp").disabled = false;
  });
};

$("change-phone").onclick = function () {
  clearInterval(countdownTimer);
  showAuth();
};

$("refresh-orders").onclick = loadOrders;

$("logout").onclick = function () {
  api("logout", { method: "POST" }).catch(function () {}).finally(function () {
    toast("از حساب خود خارج شدید.");
    showAuth();
  });
};

$("phone").addEventListener("keydown", function (event) {
  if (event.key === "Enter") requestOtp();
});

$("code").addEventListener("keydown", function (event) {
  if (event.key === "Enter") verifyOtp();
});

/* Boot: restore an existing session if the cookie is still valid. */
api("me").then(function (data) {
  showPanel(data.user);
}).catch(function () {
  showAuth();
});

})();
</script>
</body>
</html>`;
}
