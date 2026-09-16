// ============================================================
// Persian Store V2 — Online payment gateways (Zarinpal / Zibal / SnappPay)
// Managed entirely from the Telegram admin panel and the Mini App.
// ============================================================

import {
  AppError,
  uid,
  rows,
  one,
  execute,
  getSettings,
  setSetting,
  readJSON,
  requireOrigin,
  requireOrderAccess,
  rateLimit,
  ipKey
} from "./db.js";

import { activeGateways, gatewayReady } from "./defaults.js";

import { recordSalesForOrder } from "./orders.js";

import { notifyAdminsBestEffort, miniAppOrderKeyboard } from "./telegram.js";

// Both gateways refuse amounts below this in Toman.
const MIN_AMOUNT = 10000;

async function postJSON(url, body) {
  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new AppError(502, "ارتباط با درگاه پرداخت برقرار نشد. لطفاً دوباره تلاش کنید.");
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new AppError(502, "پاسخ نامعتبر از درگاه پرداخت دریافت شد.");
  }

  return data;
}

// ------------------------------------------------------------
// Gateway adapters
// ------------------------------------------------------------

function zarinpalAdapter(config) {
  const sandbox = Boolean(config.payment_gateway_sandbox);
  const apiBase = sandbox
    ? "https://sandbox.zarinpal.com"
    : "https://api.zarinpal.com";
  const startBase = sandbox
    ? "https://sandbox.zarinpal.com/pg/StartPay/"
    : "https://www.zarinpal.com/pg/StartPay/";

  function fail(data) {
    const code = data?.errors?.code || data?.data?.code;
    const message = data?.errors?.message || data?.message;
    return new AppError(
      502,
      "خطای درگاه زرین‌پال" + (code ? " (کد " + code + ")" : "") +
      (message ? ": " + message : ".")
    );
  }

  return {
    label: "زرین‌پال",

    async request(amount, callbackURL, code, mobile) {
      const data = await postJSON(
        apiBase + "/pg/v4/payment/request.json",
        {
          merchant_id: config.payment_gateway_merchant,
          amount: amount * 10, // Zarinpal expects Rial.
          callback_url: callbackURL,
          description: "پرداخت سفارش " + code,
          metadata: { order_id: code, mobile: mobile || "" }
        }
      );

      const authority = String(data?.data?.authority || "");

      if (data?.data?.code !== 100 || !/^[A-Za-z0-9]{16,128}$/.test(authority)) {
        throw fail(data);
      }

      return { authority };
    },

    startURL(authority) {
      return startBase + authority;
    },

    verifyURL: apiBase + "/pg/v4/payment/verify.json",

    verifyParams(payment) {
      return {
        merchant_id: config.payment_gateway_merchant,
        amount: payment.amount * 10,
        authority: payment.authority
      };
    },

    parseVerify(data) {
      const code = data?.data?.code;

      // 100 = verified now, 101 = verified before (idempotent replay).
      if (code === 100 || code === 101) {
        return {
          ok: true,
          refId: String(data?.data?.ref_id ?? ""),
          cardPan: String(data?.data?.card_pan ?? "")
        };
      }

      return { ok: false };
    },

    callback(url) {
      return {
        authority: String(
          url.searchParams.get("Authority") ||
          url.searchParams.get("authority") ||
          ""
        ),
        success: String(
          url.searchParams.get("Status") ||
          url.searchParams.get("status") ||
          ""
        ).toUpperCase() === "OK"
      };
    }
  };
}

function zibalAdapter(config) {
  const sandbox = Boolean(config.payment_gateway_sandbox);
  const merchant = sandbox && !config.payment_gateway_merchant
    ? "zibal"
    : config.payment_gateway_merchant;

  function fail(data) {
    return new AppError(
      502,
      "خطای درگاه زیبال: " + (data?.message || "کد " + (data?.result ?? "نامشخص"))
    );
  }

  return {
    label: "زیبال",

    async request(amount, callbackURL, code) {
      const data = await postJSON("https://gateway.zibal.ir/v1/request", {
        merchant,
        amount, // Zibal expects Toman.
        callbackUrl: callbackURL,
        description: "پرداخت سفارش " + code,
        orderId: code
      });

      const trackId = String(data?.trackId ?? "");

      if (data?.result !== 100 || !/^\d{6,24}$/.test(trackId)) {
        throw fail(data);
      }

      return { authority: trackId };
    },

    startURL(authority) {
      return "https://gateway.zibal.ir/start/" + authority;
    },

    verifyURL: "https://gateway.zibal.ir/v1/verify",

    verifyParams(payment) {
      return {
        merchant,
        trackId: payment.authority
      };
    },

    parseVerify(data) {
      // result 100 = paid, 201 = already verified (idempotent replay).
      if (data?.result === 100 || data?.result === 201) {
        return {
          ok: true,
          refId: String(data?.refNumber ?? ""),
          cardPan: String(data?.cardNumber ?? "")
        };
      }

      return { ok: false };
    },

    callback(url) {
      return {
        authority: String(url.searchParams.get("trackId") || ""),
        success: url.searchParams.get("success") === "1"
      };
    }
  };
}

function snapppayAdapter(config) {
  const sandbox = Boolean(config.payment_gateway_sandbox);

  const base = String(config.snapppay_base_url || "").trim().replace(/\/+$/, "") ||
    (sandbox
      ? "https://fms-gateway-staging.apps.public.teh-1.snappcloud.io"
      : "https://api.snapp-pay.ir");

  const username = String(config.snapppay_username || "");
  const password = String(config.snapppay_password || "");
  const clientId = String(config.snapppay_client_id || "");
  const clientSecret = String(config.snapppay_client_secret || "");

  function fail(message) {
    return new AppError(502, "خطای درگاه اسنپ‌پی: " + message);
  }

  // SnappPay uses the OAuth password grant with HTTP Basic client
  // authentication (official merchant integration flow).
  async function bearerToken() {
    let response;

    try {
      response = await fetch(
        base + "/api/online/v1/oauth/token",
        {
          method: "POST",
          signal: AbortSignal.timeout(20000),
          headers: {
            authorization: "Basic " +
              btoa(clientId + ":" + clientSecret),
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json"
          },
          body: new URLSearchParams({
            grant_type: "password",
            scope: "online-merchant",
            username,
            password
          }).toString()
        }
      );
    } catch {
      throw fail("ارتباط با سرویس برقرار نشد.");
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.access_token) {
      throw fail(
        "دریافت توکن احراز هویت ناموفق بود" +
        (data?.error_description ? " (" + data.error_description + ")" : ".")
      );
    }

    return String(data.access_token);
  }

  async function bearerPost(path, body) {
    const token = await bearerToken();

    let response;

    try {
      response = await fetch(base + path, {
        method: "POST",
        signal: AbortSignal.timeout(25000),
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch {
      throw fail("ارتباط با سرویس برقرار نشد.");
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw fail(
        "درخواست پذیرفته نشد (کد " + response.status + ")" +
        (data?.message ? ": " + data.message : ".")
      );
    }

    return data;
  }

  const toRial = value => Math.round(Number(value || 0) * 10);

  return {
    label: "اسنپ‌پی",

    /*
     * details: { rowId, discount, shipping, lines:[{name,price,quantity}] }
     * The store operates in Toman; SnappPay expects Rial amounts.
     */
    async request(amount, callbackURL, code, mobile, details = {}) {
      const items = (details.lines || []).slice(0, 40);

      const cartItems = items.map((line, index) => ({
        id: index + 1,
        name: String(line.name || "کالا").slice(0, 80),
        count: Number(line.quantity || 1),
        amount: toRial(line.price),
        category: "default",
        commissionType: 1
      }));

      const cartAmount = items.reduce(
        (sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0),
        0
      );

      const body = {
        amount: toRial(amount),
        paymentMethodTypeDto: "INSTALLMENT",
        returnURL: callbackURL + "?snapp=" + encodeURIComponent(details.rowId || ""),
        transactionId: String(details.rowId || code).slice(0, 40),
        externalSourceAmount: 0,
        discountAmount: toRial(details.discount || 0),
        cartList: [
          {
            cartId: 1,
            totalAmount: toRial(cartAmount),
            shippingAmount: toRial(details.shipping || 0),
            isShipmentIncluded: true,
            taxAmount: 0,
            isTaxIncluded: false,
            cartItems
          }
        ]
      };

      if (/^09\d{9}$/.test(String(mobile || ""))) {
        body.mobile = String(mobile);
      }

      const data = await bearerPost("/api/online/payment/v1/token", body);

      const paymentToken = String(data?.paymentToken || "");
      const paymentPageURL = String(data?.paymentPageUrl || data?.redirectUrl || "");

      if (!paymentToken || !/^https:\/\//.test(paymentPageURL)) {
        throw fail("ساخت پرداخت ناموفق بود.");
      }

      return { authority: paymentToken.slice(0, 256), startURL: paymentPageURL };
    },

    // SnappPay returns the payment page URL directly from the init call.
    startURL(authority, directURL) {
      return directURL || "https://snapp-pay.ir";
    },

    /*
     * Server-to-server verification plus settlement. Verify success is
     * signalled by the presence of transactionId (official example flow).
     */
    async verify(payment) {
      const token = await bearerToken();

      let response;

      try {
        response = await fetch(
          base + "/api/online/payment/v1/verify",
          {
            method: "POST",
            signal: AbortSignal.timeout(25000),
            headers: {
              authorization: "Bearer " + token,
              "content-type": "application/json",
              accept: "application/json"
            },
            body: JSON.stringify({ paymentToken: payment.authority })
          }
        );
      } catch {
        throw new AppError(
          502,
          "ارتباط با درگاه اسنپ‌پی برقرار نشد؛ وضعیت پرداخت بررسی می‌شود."
        );
      }

      let data;

      try {
        data = await response.json();
      } catch {
        return { ok: false };
      }

      if (!response.ok) return { ok: false };

      const transactionId = String(data?.transactionId || "");

      if (!transactionId) return { ok: false };

      // If the gateway echoes the amount, it must match exactly (Rial).
      if (Number.isFinite(Number(data?.amount)) && Number(data.amount) > 0) {
        if (Number(data.amount) !== toRial(payment.amount)) {
          return { ok: false };
        }
      }

      // Settle the captured payment; a transient settle failure must not
      // lose a verified payment, so it is attempted once, best-effort.
      try {
        await fetch(base + "/api/online/payment/v1/settle", {
          method: "POST",
          signal: AbortSignal.timeout(25000),
          headers: {
            authorization: "Bearer " + token,
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({ paymentToken: payment.authority })
        });
      } catch {
        // Settlement can be completed from the SnappPay merchant panel.
      }

      return { ok: true, refId: transactionId, cardPan: String(data?.cardNumber || "") };
    },

    /*
     * SnappPay redirects back to the return URL that was supplied during
     * init. The row identifier travels in the "snapp" query parameter,
     * so the payment is located deterministically. Cancellation is not
     * reported by the redirect; a failed verify settles the state.
     */
    callback(url) {
      return {
        authority: String(url.searchParams.get("snapp") || ""),
        byRow: true,
        success: true
      };
    }
  };
}

function makeAdapter(config, name) {
  const gateway = String(name || config.payment_gateway || "");

  if (gateway === "zibal") {
    return zibalAdapter(config);
  }

  if (gateway === "snapppay") {
    return snapppayAdapter(config);
  }

  if (gateway === "zarinpal") {
    return zarinpalAdapter(config);
  }

  throw new AppError(503, "درگاه پرداخت پشتیبانی‌شده‌ای تنظیم نشده است.");
}

// ------------------------------------------------------------
// Customer flow: create a gateway payment for an existing order
// ------------------------------------------------------------

export async function startGatewayPayment(request, env, ctx) {
  requireOrigin(request);

  await rateLimit(env, ipKey(request, "paystart"), 12, 600);

  const config = await getSettings(env);

  if (!config.payment_gateway_enabled) {
    throw new AppError(403, "درگاه پرداخت آنلاین در دسترس نیست.");
  }

  const body = await readJSON(request, 2000);
  const orderId = String(body?.orderId || "");

  if (!/^[a-f0-9]{32}$/.test(orderId)) {
    throw new AppError(400, "Invalid order identifier.");
  }

  const order = await requireOrderAccess(env, request, orderId);

  if (!order.gateway) {
    throw new AppError(409, "این سفارش برای پرداخت آنلاین ثبت نشده است.");
  }

  /*
   * The gateway was chosen by the customer at checkout and stored on
   * the order row; it must still be active and fully configured.
   */
  if (!activeGateways(config).includes(order.gateway) ||
      !gatewayReady(config, order.gateway)) {
    throw new AppError(503, "این درگاه پرداخت در حال حاضر در دسترس نیست.");
  }

  if (order.payment_status === "paid") {
    throw new AppError(409, "این سفارش قبلاً پرداخت شده است.");
  }

  if (!["new", "confirmed"].includes(order.status)) {
    throw new AppError(409, "این سفارش دیگر قابل پرداخت نیست.");
  }

  if (order.total < MIN_AMOUNT) {
    throw new AppError(400, "مبلغ سفارش کمتر از حداقل مجاز درگاه پرداخت است.");
  }

  // The worker learns its public origin from real traffic; remember it so the
  // Telegram panel can display the exact callback URL to the admin.
  const origin = new URL(request.url).origin;

  if (config.site_url !== origin) {
    try {
      await setSetting(env, "site_url", origin);
    } catch {
      // Non-critical: the callback URL is still built from the request origin.
    }
  }

  const adapter = makeAdapter(config, order.gateway);

  // The payment row id is generated up-front so gateways that identify
  // their return redirect by merchant-supplied reference (SnappPay) can
  // carry it inside the callback URL.
  const rowId = uid();

  const lines = await rows(
    env,
    "SELECT name,price,quantity FROM order_lines WHERE order_id=? ORDER BY id",
    [order.id]
  );

  const started = await adapter.request(
    order.total,
    origin + "/pay/callback",
    order.code,
    order.phone,
    {
      rowId,
      discount: order.discount,
      shipping: order.shipping,
      lines
    }
  );

  const now = Date.now();

  try {
    await execute(
      env,
      "INSERT INTO gateway_payments(" +
      "id,order_id,gateway,authority,amount,status,created_at,updated_at" +
      ") VALUES(?,?,?,?,?,'pending',?,?)",
      [rowId, order.id, order.gateway, started.authority, order.total, now, now]
    );
  } catch {
    throw new AppError(502, "ثبت تراکنش ناموفق بود. لطفاً دوباره تلاش کنید.");
  }

  const redirect = adapter.startURL(started.authority, started.startURL);

  if (!/^https:\/\//.test(redirect)) {
    throw new AppError(502, "آدرس پرداخت درگاه نامعتبر است.");
  }

  return { redirect };
}

// ------------------------------------------------------------
// Result page rendered on the gateway return URL
// ------------------------------------------------------------

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resultPage({ ok, title, message, order, refId }) {
  const accent = ok ? "#1f7a3f" : "#b73747";
  const background = ok ? "#eef7f0" : "#fdf1f2";

  const lines = [];

  if (order) {
    lines.push("کد سفارش: <strong>" + escapeHTML(order.code) + "</strong>");
  }

  if (refId) {
    lines.push("شماره پیگیری درگاه: <strong>" + escapeHTML(refId) + "</strong>");
  }

  lines.push(message);

  return new Response(
    '<!doctype html>\n' +
    '<html lang="fa" dir="rtl">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="robots" content="noindex">\n' +
    "<title>" + title + "</title>\n" +
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">\n' +
    "<style>\n" +
    "*{box-sizing:border-box}\n" +
    "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafbf9;" +
    "color:#24332a;font-family:Vazirmatn,Tahoma,sans-serif;line-height:2;padding:20px}\n" +
    ".card{width:min(480px,100%);background:#fff;border:1px solid #e5ebe5;border-radius:22px;" +
    "padding:34px 26px;text-align:center;box-shadow:0 12px 36px #26382b09}\n" +
    ".mark{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;" +
    "margin:0 auto 18px;background:" + background + ";color:" + accent + ";" +
    "font-size:2.1rem;font-weight:800}\n" +
    "h1{font-size:1.25rem;margin:0 0 14px}\n" +
    "p{font-size:.92rem;margin:10px 0}\n" +
    ".muted{color:#718077;font-size:.84rem}\n" +
    "a.btn{display:inline-block;margin-top:18px;padding:11px 26px;border-radius:14px;" +
    "background:#637c68;color:#fff;text-decoration:none;font-size:.92rem}\n" +
    "</style>\n" +
    "</head>\n" +
    '<body>\n' +
    '<div class="card">\n' +
    '<div class="mark">' + (ok ? "✓" : "✕") + "</div>\n" +
    "<h1>" + title + "</h1>\n" +
    lines.map(line => "<p>" + line + "</p>").join("\n") +
    '\n<p class="muted">این صفحه را می‌توانید ببندید.</p>\n' +
    '<a class="btn" href="/">بازگشت به فروشگاه</a>\n' +
    "</div>\n" +
    "</body>\n" +
    "</html>",
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

// ------------------------------------------------------------
// Gateway return URL: verify and settle the payment
// ------------------------------------------------------------

export async function handleGatewayCallback(url, env, ctx) {
  const config = await getSettings(env);

  /*
   * Several gateways can be active at once, so the payment row is
   * located first (SnappPay by its row id, the others by authority)
   * and the adapter is then built for THAT row's gateway.
   */
  const snappRowId = String(url.searchParams.get("snapp") || "");

  let payment;

  if (snappRowId) {
    payment = await one(
      env,
      "SELECT * FROM gateway_payments WHERE id=? AND gateway='snapppay'",
      [snappRowId]
    );
  } else {
    const authority = String(
      url.searchParams.get("Authority") ||
      url.searchParams.get("authority") ||
      url.searchParams.get("trackId") ||
      ""
    );

    if (!authority) {
      return resultPage({
        ok: false,
        title: "پرداخت ناموفق",
        message: "اطلاعات بازگشت از درگاه پرداخت ناقص است."
      });
    }

    payment = await one(
      env,
      "SELECT * FROM gateway_payments WHERE authority=? " +
      "ORDER BY created_at DESC LIMIT 1",
      [authority]
    );
  }

  if (!payment) {
    return resultPage({
      ok: false,
      title: "تراکنش یافت نشد",
      message: "پرداختی با این مشخصات در فروشگاه ثبت نشده است."
    });
  }

  const adapter = makeAdapter(config, payment.gateway);
  const parsed = adapter.callback(url);

  const order = await one(
    env,
    "SELECT * FROM orders WHERE id=?",
    [payment.order_id]
  );

  if (!order) {
    return resultPage({
      ok: false,
      title: "تراکنش یافت نشد",
      message: "سفارش مربوط به این پرداخت پیدا نشد. با فروشگاه تماس بگیرید."
    });
  }

  // Customer cancelled or the gateway reported failure.
  const success = parsed.success !== false;

  if (!success && payment.status === "pending") {
    await execute(
      env,
      "UPDATE gateway_payments SET status='failed',updated_at=? WHERE id=? AND status='pending'",
      [Date.now(), payment.id]
    );
  }

  if (!success) {
    return resultPage({
      ok: false,
      title: "پرداخت انجام نشد",
      order,
      message:
        "پرداخت لغو شد یا در درگاه ناموفق بود. اگر مبلغی کسر شده باشد، " +
        "به‌صورت خودکار آزاد می‌شود. می‌توانید از صفحه سفارش دوباره تلاش کنید."
    });
  }

  // Already settled: render success again without side effects.
  if (payment.status === "verified") {
    return resultPage({
      ok: true,
      title: "پرداخت موفق",
      order,
      refId: payment.ref_id,
      message: "پرداخت این سفارش قبلاً با موفقیت تأیید شده است."
    });
  }

  let verdict;

  try {
    if (typeof adapter.verify === "function") {
      // Gateways with OAuth flows (SnappPay) perform their own
      // server-to-server verify + settle handshake.
      verdict = await adapter.verify(payment);
    } else {
      const data = await postJSON(adapter.verifyURL, adapter.verifyParams(payment));
      verdict = adapter.parseVerify(data);
    }
  } catch (error) {
    if (error instanceof AppError) {
      // Gateway unreachable: keep the payment pending and let the admin decide.
      return resultPage({
        ok: false,
        title: "وضعیت پرداخت نامشخص",
        order,
        message:
          "تأیید نهایی از درگاه در دسترس نبود. اگر مبلغ کسر شده باشد، " +
          "وضعیت سفارش به‌زودی بررسی می‌شود؛ نگران پرداخت تکراری نباشید."
      });
    }

    verdict = { ok: false };
  }

  if (!verdict.ok) {
    await execute(
      env,
      "UPDATE gateway_payments SET status='failed',updated_at=? WHERE id=? AND status='pending'",
      [Date.now(), payment.id]
    );

    return resultPage({
      ok: false,
      title: "پرداخت تأیید نشد",
      order,
      message:
        "درگاه پرداخت این تراکنش را تأیید نکرد. مبلغی برداشت نشده یا " +
        "به‌صورت خودکار به حساب شما برمی‌گردد."
    });
  }

  // Atomic settlement: only one callback can flip the pending payment.
  const now = Date.now();

  const claimed = await one(
    env,
    "UPDATE gateway_payments SET status='verified',ref_id=?,card_pan=?,updated_at=? " +
    "WHERE id=? AND status='pending' RETURNING id",
    [verdict.refId, verdict.cardPan, now, payment.id]
  );

  if (claimed) {
    await execute(
      env,
      "UPDATE orders SET payment_status='paid',paid_at=?,expires_at=NULL,updated_at=? " +
      "WHERE id=? AND payment_status!='paid' AND status IN ('new','confirmed')",
      [now, now, order.id]
    );

    await recordSalesForOrder(env, order.id);

    await execute(
      env,
      "INSERT OR IGNORE INTO order_events(id,order_id,kind,actor_id,created_at) " +
      "VALUES(?,?, 'gateway_payment','gateway',?)",
      [uid(), order.id, now]
    );

    // Older pending attempts are obsolete once one authority is verified.
    await execute(
      env,
      "UPDATE gateway_payments SET status='failed',updated_at=? " +
      "WHERE order_id=? AND status='pending' AND id!=?",
      [now, order.id, payment.id]
    );

    const settled = await one(
      env,
      "SELECT payment_status,status FROM orders WHERE id=?",
      [order.id]
    );

    const message = settled?.payment_status === "paid"
      ? [
          "💳 پرداخت آنلاین موفق",
          "کد سفارش: " + order.code,
          "مبلغ: " + Number(order.total).toLocaleString("fa-IR") + " تومان",
          "درگاه: " + adapter.label,
          verdict.refId ? "شماره پیگیری: " + verdict.refId : ""
        ].filter(Boolean).join("\n")
      : [
          "⚠️ پرداخت آنلاین موفق اما سفارش قابل تأیید نبود",
          "کد سفارش: " + order.code,
          "مبلغ: " + Number(order.total).toLocaleString("fa-IR") + " تومان",
          "وضعیت فعلی سفارش: " + (settled?.status || "نامشخص"),
          "لطفاً بررسی و در صورت نیاز بازپرداخت کنید."
        ].filter(Boolean).join("\n");

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        notifyAdminsBestEffort(
          env,
          message,
          await miniAppOrderKeyboard(env, order.id)
        ).catch(() => {
          console.error("Gateway payment notification failed.");
        })
      );
    }
  }

  return resultPage({
    ok: true,
    title: "پرداخت موفق",
    order,
    refId: verdict.refId,
    message: "پرداخت شما با موفقیت انجام و در فروشگاه ثبت شد."
  });
}
