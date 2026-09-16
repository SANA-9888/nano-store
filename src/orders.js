import { digits, activeGateways, gatewayReady } from "./defaults.js";

import {
  AppError,
  uid,
  sha256,
  rows,
  one,
  execute,
  getSettings,
  readJSON,
  requireOrigin,
  requireOrderAccess,
  rateLimit,
  ipKey,
  isAdmin
} from "./db.js";

import {
  collectOrderNotifications,
  deliverNotifications,
  notifyAdminsBestEffort
} from "./telegram.js";

import { logAdminAction } from "./audit.js";

function text(value, minimum, maximum, label) {
  if (typeof value !== "string") {
    throw new AppError(400, "Invalid " + label + ".");
  }

  const result = value.trim();

  if (result.length < minimum || result.length > maximum) {
    throw new AppError(400, "Invalid " + label + " length.");
  }

  return result;
}

function normalizedSelection(schema, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError(400, "Select the product options.");
  }

  if (Object.keys(input).length !== schema.length) {
    throw new AppError(400, "Invalid product selection.");
  }

  const output = {};

  for (const group of schema) {
    if (!group.values.includes(input[group.name])) {
      throw new AppError(400, "Invalid product option: " + group.name);
    }

    output[group.name] = input[group.name];
  }

  return output;
}

async function checkTurnstile(request, env, config, token) {
  if (!config.turnstile_enabled) return;

  if (!env.TURNSTILE_SECRET_KEY || !config.turnstile_site_key) {
    throw new AppError(503, "Turnstile is not configured.");
  }

  if (typeof token !== "string" || !token || token.length > 2048) {
    throw new AppError(400, "Complete the security verification.");
  }

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);

  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);

  let result;

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(15000)
      }
    );

    result = await response.json();
  } catch {
    throw new AppError(503, "Security verification is temporarily unavailable.");
  }

  if (
    !result.success ||
    result.hostname !== new URL(request.url).hostname ||
    result.action !== "checkout"
  ) {
    throw new AppError(400, "Security verification failed.");
  }
}

async function buildLines(env, requested) {
  const productIds = [...new Set(requested.map(item => item.productId))];

  const products = await rows(
    env,
    "SELECT * FROM products WHERE id IN (" +
    productIds.map(() => "?").join(",") + ")",
    productIds
  );

  const variants = await rows(
    env,
    "SELECT * FROM variants WHERE product_id IN (" +
    productIds.map(() => "?").join(",") + ")",
    productIds
  );

  const productMap = new Map(products.map(item => [item.id, item]));
  const variantMap = new Map(variants.map(item => [item.id, item]));

  const identities = new Set();
  const lines = [];

  for (const requestedLine of requested) {
    const product = productMap.get(requestedLine.productId);

    if (!product?.published) {
      throw new AppError(409, "A product is unavailable.");
    }

    const schema = JSON.parse(product.option_schema);
    let selection = {};
    let variantId = null;
    let price = product.price;
    let stock = product.stock;

    if (product.inventory_mode === "shared") {
      selection = normalizedSelection(schema, requestedLine.selection);
    }

    if (product.inventory_mode === "variants") {
      const variant = variantMap.get(requestedLine.variantId);

      if (
        !variant ||
        variant.product_id !== product.id ||
        !variant.enabled
      ) {
        throw new AppError(409, "The selected variant is unavailable.");
      }

      variantId = variant.id;
      selection = JSON.parse(variant.options);
      price = variant.price ?? product.price;
      stock = variant.stock;
    }

    if (stock < requestedLine.quantity) {
      throw new AppError(409, "Insufficient stock: " + product.name);
    }

    const identity = JSON.stringify([
      product.id,
      variantId,
      selection
    ]);

    if (identities.has(identity)) {
      throw new AppError(400, "Duplicate cart line.");
    }

    identities.add(identity);

    lines.push({
      id: uid(),
      productId: product.id,
      variantId,
      name: product.name,
      selection,
      price,
      quantity: requestedLine.quantity,
      inventoryMode: product.inventory_mode
    });
  }

  return lines;
}

export async function createOrder(request, env, ctx) {
  requireOrigin(request);

  await rateLimit(
    env,
    ipKey(request, "checkout"),
    20,
    600
  );

  const body = await readJSON(request, 40000);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Invalid checkout payload.");
  }

  const config = await getSettings(env);

  const requestId = text(body.requestId, 36, 36, "request ID");
  const accessKey = text(body.accessKey, 64, 64, "order access key");

  if (
    !/^[a-f0-9-]{36}$/i.test(requestId) ||
    !/^[a-f0-9]{64}$/i.test(accessKey)
  ) {
    throw new AppError(400, "Invalid checkout identifiers.");
  }

  const customer = {
    name: text(body.name, 2, 100, "name"),
    phone: digits(text(body.phone, 10, 20, "phone")).replace(/\s/g, ""),
    address: text(body.address, 10, 1500, "address"),
    postal: digits(text(body.postal || "", 0, 10, "postal code")),
    note: text(body.note || "", 0, 2000, "note")
  };

  if (!/^09\d{9}$/.test(customer.phone)) {
    throw new AppError(400, "Use an Iranian mobile number such as 09123456789.");
  }

  if (customer.postal && !/^\d{10}$/.test(customer.postal)) {
    throw new AppError(400, "Postal code must contain 10 digits.");
  }

  const paymentMethod = body.paymentMethod;
  if (!["contact", "card", "gateway"].includes(paymentMethod)) {
    throw new AppError(400, "Invalid payment method.");
  }

  /*
   * Online payment: the customer picks one of the ACTIVE gateways at
   * checkout. The chosen gateway is stored on the order row and later
   * used for both the payment request and the callback verification.
   */
  let chosenGateway = "";

  if (paymentMethod === "gateway") {
    const active = activeGateways(config);

    if (!config.payment_gateway_enabled) {
      throw new AppError(403, "This payment method is disabled.");
    }

    chosenGateway = String(body.gateway || "").trim();

    if (!active.includes(chosenGateway)) {
      throw new AppError(403, "این درگاه پرداخت فعال نیست.");
    }

    if (!gatewayReady(config, chosenGateway)) {
      throw new AppError(503, "این درگاه پرداخت هنوز کامل تنظیم نشده است.");
    }
  }

  const couponCode = digits(
    text(body.coupon || "", 0, 32, "coupon")
  ).toUpperCase();

  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 40
  ) {
    throw new AppError(400, "Use 1-40 cart lines.");
  }

  const requested = body.items.map(item => {
    if (
      !item ||
      typeof item.productId !== "string" ||
      item.productId.length > 64 ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99
    ) {
      throw new AppError(400, "Invalid cart line.");
    }

    const selection = item.selection || {};

    if (
      typeof selection !== "object" ||
      Array.isArray(selection) ||
      Object.keys(selection).length > 4
    ) {
      throw new AppError(400, "Invalid product selection.");
    }

    const canonicalSelection = Object.fromEntries(
      Object.entries(selection).sort(([a], [b]) => a.localeCompare(b))
    );

    return {
      productId: item.productId,
      variantId: typeof item.variantId === "string" ? item.variantId : "",
      selection: canonicalSelection,
      quantity: item.quantity
    };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  const requestHash = await sha256(JSON.stringify({
    customer,
    paymentMethod,
    gateway: chosenGateway,
    couponCode,
    requested
  }));

  const accessHash = await sha256(accessKey);

  async function previousOrder() {
    const previous = await one(
      env,
      "SELECT id,code,total,request_hash,access_hash FROM orders WHERE request_id=?",
      [requestId]
    );

    if (!previous) return null;

    if (
      previous.request_hash !== requestHash ||
      previous.access_hash !== accessHash
    ) {
      throw new AppError(409, "Request ID was reused with different data.");
    }

    return {
      id: previous.id,
      code: previous.code,
      total: previous.total
    };
  }

  const prior = await previousOrder();
  if (prior) return prior;

  if (!config.orders_enabled || !config.cart_enabled) {
    throw new AppError(403, "Ordering is currently disabled.");
  }

  if (
    (paymentMethod === "contact" && !config.payment_contact_enabled) ||
    (paymentMethod === "card" && !config.payment_card_enabled)
  ) {
    throw new AppError(403, "This payment method is disabled.");
  }

  if (paymentMethod === "card") {
    const card = await one(
      env,
      "SELECT id FROM bank_cards WHERE enabled=1 LIMIT 1"
    );

    if (!card) {
      throw new AppError(503, "No bank card is configured.");
    }
  }

  await checkTurnstile(request, env, config, body.turnstile);

  const lines = await buildLines(env, requested);

  const subtotal = lines.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0
  );

  if (!Number.isSafeInteger(subtotal)) {
    throw new AppError(400, "Order amount is too large.");
  }

  let coupon = null;
  let discount = 0;

  if (couponCode) {
    if (!config.discounts_enabled) {
      throw new AppError(400, "Discount codes are disabled.");
    }

    coupon = await one(
      env,
      "SELECT * FROM coupons WHERE code=?",
      [couponCode]
    );

    if (
      !coupon?.enabled ||
      coupon.minimum > subtotal ||
      (coupon.expires_at && coupon.expires_at <= Date.now()) ||
      (coupon.max_uses && coupon.used >= coupon.max_uses)
    ) {
      throw new AppError(400, "Discount code is invalid, expired or exhausted.");
    }

    discount = coupon.type === "percent"
      ? Math.floor(subtotal * coupon.amount / 100)
      : Math.min(subtotal, coupon.amount);
  }

  const shipping =
    config.free_shipping_over > 0 &&
    subtotal >= config.free_shipping_over
      ? 0
      : config.shipping_fee;

  const total = subtotal + shipping - discount;

  if (!Number.isSafeInteger(total)) {
    throw new AppError(400, "Invalid order total.");
  }

  const orderId = uid();
  const code = "S-" + uid().slice(0, 12).toUpperCase();
  const now = Date.now();

  // Card orders get a payment deadline enforced by scheduled maintenance.
  // Gateway orders stay open: the callback settles them whenever the
  // customer finishes paying, so they are never auto-cancelled.
  const expiresAt = paymentMethod === "card"
    ? now + config.reservation_hours * 3600000
    : null;

  const statements = [
    env.DB.prepare(`
      INSERT INTO orders(
        id,request_id,request_hash,access_hash,code,
        name,phone,address,postal,note,
        subtotal,shipping,discount,total,
        coupon_id,coupon_code,coupon_version,
        payment_method,gateway,expires_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      orderId, requestId, requestHash, accessHash, code,
      customer.name, customer.phone, customer.address, customer.postal,
      config.order_notes_enabled ? customer.note : "",
      subtotal, shipping, discount, total,
      coupon?.id || null, coupon?.code || "", coupon?.version ?? null,
      // The orders table CHECK allows only contact/card; online payment is
      // identified by the gateway column.
      paymentMethod === "gateway" ? "contact" : paymentMethod,
      paymentMethod === "gateway" ? chosenGateway : "",
      expiresAt, now, now
    ),

    ...lines.map(line => env.DB.prepare(`
      INSERT INTO order_lines(
        id,order_id,product_id,variant_id,name,selection,
        price,quantity,inventory_mode
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).bind(
      line.id, orderId, line.productId, line.variantId,
      line.name, JSON.stringify(line.selection),
      line.price, line.quantity, line.inventoryMode
    )),

    env.DB.prepare(
      "INSERT INTO notification_jobs(id,kind,entity_id,payload,created_at) " +
      "VALUES(?,'order_new',?,?,?)"
    ).bind(
      "order:" + orderId,
      orderId,
      JSON.stringify({
        code,
        name: customer.name,
        phone: customer.phone,
        total,
        payment_method: paymentMethod
      }),
      now
    )
  ];

  try {
    await env.DB.batch(statements);
  } catch {
    const duplicate = await previousOrder();
    if (duplicate) return duplicate;

    throw new AppError(
      409,
      "Price, stock or discount changed. Refresh the cart and try again."
    );
  }

  ctx.waitUntil(
    deliverNotifications(env).catch(() => {
      console.error("Notification delivery failed; scheduled retry is available.");
    })
  );

  return {
    id: orderId,
    code,
    total
  };
}

export async function getPrivateOrder(request, env, orderId) {
  const order = await requireOrderAccess(env, request, orderId);
  const settings = await getSettings(env);

  const lines = await rows(
    env,
    "SELECT name,selection,price,quantity FROM order_lines WHERE order_id=?",
    [order.id]
  );

  const cards = order.payment_method === "card"
    ? await rows(
        env,
        "SELECT id,bank_name,holder_name,card_number,label " +
        "FROM bank_cards WHERE enabled=1 ORDER BY position,created_at"
      )
    : [];

  const receipts = await rows(
    env,
    "SELECT id,uploaded_at FROM receipts WHERE order_id=? ORDER BY uploaded_at DESC",
    [order.id]
  );

  return {
    id: order.id,
    code: order.code,
    status: order.status,
    paymentMethod: order.gateway ? "gateway" : order.payment_method,
    gateway: order.gateway || "",
    paymentStatus: order.payment_status,
    subtotal: order.subtotal,
    shipping: order.shipping,
    discount: order.discount,
    total: order.total,
    expiresAt: order.expires_at,
    lines: lines.map(line => ({
      ...line,
      selection: JSON.parse(line.selection)
    })),
    cards,
    receipts,
    message: settings.order_message,
    contact: settings.contact_text,
    links: settings.contact_links
  };
}

/*
 * Counts one order exactly once towards product sales popularity.
 * The order_events row acts as the idempotency guard, so replayed
 * verifications or concurrent approvals never double-count.
 */
export async function recordSalesForOrder(env, orderId) {
  const claimed = await one(
    env,
    "INSERT OR IGNORE INTO order_events(id,order_id,kind,actor_id,created_at) " +
    "VALUES(?,?,'sales_record','',?) RETURNING id",
    ["sales:" + orderId, orderId, Date.now()]
  );

  if (!claimed) return false;

  await execute(
    env,
    "UPDATE products SET sales_count=sales_count+(" +
    "SELECT COALESCE(SUM(l.quantity),0) FROM order_lines l " +
    "WHERE l.order_id=? AND l.product_id=products.id" +
    ") WHERE id IN (" +
    "SELECT DISTINCT product_id FROM order_lines WHERE order_id=?" +
    ")",
    [orderId, orderId]
  );

  return true;
}

export async function markPaidManually(env, orderId, adminId) {
  if (!await isAdmin(env, adminId)) {
    throw new Error("Access denied.");
  }

  const order = await one(
    env,
    "SELECT * FROM orders WHERE id=?",
    [orderId]
  );

  if (!order || !["new", "confirmed"].includes(order.status)) {
    throw new Error("This order cannot be marked as paid.");
  }

  if (order.payment_status === "paid") {
    return { alreadyPaid: true };
  }

  const eventId = "paid:" + order.id;
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE orders SET payment_status='paid',paid_at=?,expires_at=NULL,updated_at=? " +
      "WHERE id=? AND status IN ('new','confirmed') AND payment_status!='paid'"
    ).bind(now, now, order.id),

    env.DB.prepare(
      "INSERT OR IGNORE INTO order_events(id,order_id,kind,actor_id,created_at) " +
      "SELECT ?,id,'manual_payment',?,? FROM orders " +
      "WHERE id=? AND payment_status='paid' AND status IN ('new','confirmed')"
    ).bind(eventId, String(adminId), now, order.id)
  ]);

  const result = await one(
    env,
    "SELECT payment_status FROM orders WHERE id=?",
    [order.id]
  );

  if (result?.payment_status !== "paid") {
    throw new Error("Order changed before payment approval.");
  }

  await recordSalesForOrder(env, order.id);

  await logAdminAction(
    env,
    adminId,
    "orders",
    "تایید پرداخت (دستی)",
    order.code,
    Number(order.total).toLocaleString("fa-IR") + " تومان"
  );

  await notifyAdminsBestEffort(
    env,
    "✅ پرداخت با بررسی دستی مدیر تأیید شد\n" +
    "کد: " + order.code + "\n" +
    "مبلغ: " + Number(order.total).toLocaleString("fa-IR") + " تومان",
    [],
    "orders"
  );

  return { ok: true };
}

export async function changeOrderStatus(env, orderId, status, adminId) {
  if (!await isAdmin(env, adminId)) {
    throw new Error("Access denied.");
  }

  if (!["confirmed", "sent", "cancelled"].includes(status)) {
    throw new Error("Invalid order status.");
  }

  const order = await one(
    env,
    "SELECT id,code,status,payment_status,payment_method,paid_at FROM orders WHERE id=?",
    [orderId]
  );

  if (!order) {
    throw new Error("Order not found.");
  }

  /*
   * Shipping an order implies its payment was checked and accepted.
   * A card-to-card receipt that was still pending review is therefore
   * auto-confirmed here — the order no longer shows up in the
   * "receipts needing review" queue once it has been sent.
   */
  const autoConfirmReceipt =
    status === "sent" &&
    order.payment_status === "review" &&
    order.payment_method === "card";

  const now = Date.now();

  const result = await execute(
    env,
    "UPDATE orders SET status=?,payment_status=?,paid_at=?,expires_at=NULL,updated_at=? " +
    "WHERE id=? AND payment_status=?",
    [
      status,
      autoConfirmReceipt ? "paid" : order.payment_status,
      autoConfirmReceipt ? now : order.paid_at ?? null,
      now,
      orderId,
      order.payment_status
    ]
  );

  if (!result.meta.changes) {
    throw new Error("Order not found.");
  }

  if (autoConfirmReceipt) {
    await execute(
      env,
      "INSERT OR IGNORE INTO order_events(id,order_id,kind,actor_id,created_at) " +
      "VALUES(?,?,'receipt_auto_confirmed',?,?)",
      ["autoreceipt:" + order.id, order.id, String(adminId), now]
    );

    // Popularity counting starts with the paid order (idempotent).
    await recordSalesForOrder(env, order.id);
  }

  const labels = {
    confirmed: "تایید سفارش",
    sent: "ارسال سفارش",
    cancelled: "لغو سفارش"
  };

  await logAdminAction(
    env,
    adminId,
    "orders",
    labels[status] || status,
    order.code,
    "وضعیت قبلی: " + (order.status || "؟") +
      (autoConfirmReceipt ? "؛ رسید در انتظار بررسی به‌صورت خودکار تایید شد" : "")
  );
}

export async function maintainOrders(env) {
  const now = Date.now();

  // Only unpaid, unreviewed card orders expire automatically.
  await execute(
    env,
    "UPDATE orders SET status='cancelled',updated_at=? " +
    "WHERE status='new' AND payment_method='card' AND payment_status='unpaid' " +
    "AND expires_at IS NOT NULL AND expires_at<=?",
    [now, now]
  );

  await collectOrderNotifications(env);
  await deliverNotifications(env);

  /*
   * Retention of the activity report. The owner-configurable setting
   * log_retention_days defaults to 20 days; junk rows (sessions, rate
   * limits, consumed deliveries) are dropped as soon as they expire so
   * the D1 database stays small. D1 has no VACUUM, but freed pages are
   * reused by SQLite automatically, so deleting rows does reclaim
   * writable space over time.
   */
  let retentionDays = 20;

  try {
    const settings = await getSettings(env);
    const parsed = Number(settings.log_retention_days);

    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 365) {
      retentionDays = Math.floor(parsed);
    }
  } catch {
    // Fall back to the default retention.
  }

  const retentionCutoff = now - retentionDays * 86400000;

  await env.DB.batch([
    env.DB.prepare("DELETE FROM bot_sessions WHERE expires_at<?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(now),
    env.DB.prepare(
      "DELETE FROM telegram_updates WHERE state='done' AND updated_at<?"
    ).bind(now - 7 * 86400000),
    env.DB.prepare(
      "DELETE FROM admin_logs WHERE created_at<?"
    ).bind(retentionCutoff),
    env.DB.prepare(
      "DELETE FROM user_otps WHERE expires_at<?"
    ).bind(now - 3600000),
    env.DB.prepare(
      "DELETE FROM user_otps WHERE created_at<?"
    ).bind(now - 86400000),
    env.DB.prepare(
      "DELETE FROM notification_deliveries WHERE job_id IN (" +
      "SELECT id FROM notification_jobs WHERE created_at<?)"
    ).bind(retentionCutoff),
    env.DB.prepare(
      "DELETE FROM notification_jobs WHERE created_at<?"
    ).bind(retentionCutoff),
    env.DB.prepare(
      "DELETE FROM bot_panels WHERE updated_at<?"
    ).bind(now - 30 * 86400000),
    env.DB.prepare(
      "DELETE FROM gateway_payments WHERE status='failed' AND created_at<?"
    ).bind(now - 90 * 86400000)
  ]);
}