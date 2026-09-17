// ============================================================
// Persian Store V2 — Telegram Admin Mini App (OPTIONAL FEATURE)
//
// Everything this feature needs lives in this single file plus the
// two routes registered in src/worker.js.
//
// Disable/remove:
//   • Temporarily off: set  "vars": { "MINIAPP_ENABLED": "off" }
//     in wrangler.json and redeploy (bot falls back to panel buttons).
//   • Remove completely: delete this file and the two "/miniapp"
//     routes plus their import in src/worker.js.
// ============================================================

import {
  AppError,
  uid,
  one,
  rows,
  execute,
  getSettings,
  setSetting,
  readBytes,
  readJSON,
  responseJSON,
  rateLimit,
  ipKey
} from "./db.js";

import {
  parseSetting,
  parseOptions,
  combinations,
  SMS_PROVIDERS,
  smsProviderLabel
} from "./defaults.js";
import {
  GATEWAYS,
  GATEWAY_LABELS,
  activeGateways,
  gatewayReady
} from "./defaults.js";

import {
  applyInventoryStructure,
  validateProductPublish,
  deleteProduct,
  setProductImages,
  addProductImage,
  removeProductImage
} from "./catalog.js";

import { markPaidManually, changeOrderStatus } from "./orders.js";

import { logAdminAction, AUDIT_SECTIONS } from "./audit.js";

import { uploadProductImage } from "./media.js";

// ------------------------------------------------------------
// Permission model (kept in sync with src/bot.js so the Mini App
// stays a self-contained, removable module).
// ------------------------------------------------------------

const PERMISSIONS = {
  products: "محصولات",
  categories: "دسته‌بندی‌ها",
  slider: "اسلایدر",
  posts: "نوشته‌ها",
  faq: "پرسش‌ها",
  discounts: "تخفیف‌ها",
  cards: "کارت‌های بانکی",
  orders: "سفارش‌ها و رسیدها",
  gateway: "درگاه پرداخت",
  settings: "تنظیمات فروشگاه",
  sms: "تنظیمات پیامک",
  users: "کاربران سایت",
  admins: "مدیریت مدیران"
};

const ROLE_PERMISSIONS = {
  owner: Object.keys(PERMISSIONS),
  admin: Object.keys(PERMISSIONS).filter(key => key !== "admins"),
  operator: ["orders"]
};

/* Legacy keys (before the fine-grained split) expand on read. */
const LEGACY_EXPANSION = {
  catalog: ["products", "categories", "slider", "posts", "faq"],
  orders: ["orders"],
  gateway: ["gateway"],
  settings: ["settings"],
  admins: ["admins"]
};

function accessOfRow(row) {
  if (row.role === "owner") {
    return { role: "owner", perms: [...Object.keys(PERMISSIONS)], isOwner: true };
  }

  if (row.role === "custom") {
    let list = [];

    try {
      list = JSON.parse(row.permissions || "[]");
    } catch {
      list = [];
    }

    if (!Array.isArray(list)) list = [];

    const expanded = [];

    for (const key of list) {
      if (key in LEGACY_EXPANSION) expanded.push(...LEGACY_EXPANSION[key]);
      else if (key in PERMISSIONS) expanded.push(key);
    }

    return {
      role: "custom",
      perms: [...new Set(expanded)],
      isOwner: false
    };
  }

  const role = ROLE_PERMISSIONS[row.role] ? row.role : "admin";

  return { role, perms: [...ROLE_PERMISSIONS[role]], isOwner: false };
}

function allows(access, permission) {
  return access.isOwner || access.perms.includes(permission);
}

/* The category picker inside the wizard is a product-editor tool. */
function allowsAny(access, keys) {
  return access.isOwner || keys.some(key => access.perms.includes(key));
}

function snapppayReady(settings) {
  return Boolean(
    settings.snapppay_username &&
    settings.snapppay_password &&
    settings.snapppay_client_id &&
    settings.snapppay_client_secret
  );
}

// ------------------------------------------------------------
// Telegram initData verification (HMAC-SHA256, "WebAppData" key)
// ------------------------------------------------------------

async function verifyInitData(env, initData) {
  if (!initData || typeof initData !== "string" || initData.length > 4096) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const hash = String(params.get("hash") || "");

  if (!/^[a-f0-9]{64}$/.test(hash)) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => key + "=" + value)
    .sort()
    .join("\n");

  // Telegram spec: secret = HMAC("WebAppData", bot_token), then
  // hash = HMAC(secret, data_check_string).
  const webAppKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const secretRaw = await crypto.subtle.sign(
    "HMAC",
    webAppKey,
    new TextEncoder().encode(String(env.BOT_TOKEN || ""))
  );

  const secretKey = await crypto.subtle.importKey(
    "raw",
    secretRaw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    new TextEncoder().encode(dataCheckString)
  );

  const hex = [...new Uint8Array(signature)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");

  if (hex !== hash) return null;

  // initData is replayed by Telegram on each open; still bound to a day.
  const authDate = Number(params.get("auth_date") || 0);

  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) {
    return null;
  }

  let user;

  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }

  if (!user || !Number.isFinite(Number(user.id))) return null;

  return {
    userId: String(user.id),
    name: [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 100)
  };
}

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------

const PAGE_SIZE = 20;

function orderStatusLabels(status) {
  return {
    new: "جدید",
    confirmed: "تأییدشده",
    sent: "ارسال‌شده",
    cancelled: "لغوشده"
  }[status] || status;
}

function money(value) {
  return Number(value || 0).toLocaleString("fa-IR");
}

async function requirePermission(access, permission) {
  if (!allows(access, permission)) {
    throw new AppError(403, "سطح دسترسی شما این بخش را شامل نمی‌شود.");
  }
}

async function bodyJSON(request) {
  const body = await readJSON(request, 40000);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Invalid request body.");
  }

  return body;
}

// ------------------------------------------------------------
// Endpoint handlers
// ------------------------------------------------------------

async function apiStats(env, access) {
  const now = Date.now();

  const [orders, products, variants, daily, weekly, monthly] = await Promise.all([
    one(
      env,
      `SELECT
        COUNT(*) AS total,
        SUM(status='new') AS new_count,
        SUM(status='confirmed') AS confirmed_count,
        SUM(status='sent') AS sent_count,
        SUM(status='cancelled') AS cancelled_count,
        SUM(payment_status='review') AS review_count,
        COALESCE(SUM(
          total * (payment_status='paid' AND status!='cancelled')
        ),0) AS paid_total,
        COALESCE(SUM(
          total * (
            payment_status='paid'
            AND status!='cancelled'
            AND paid_at>=?
          )
        ),0) AS paid_month
       FROM orders`,
      [now - 30 * 86400000]
    ),
    one(
      env,
      `SELECT COUNT(*) AS total, SUM(published=1) AS published
       FROM products`
    ),
    one(
      env,
      "SELECT COUNT(*) AS total FROM variants v " +
      "JOIN products p ON p.id=v.product_id " +
      "WHERE v.enabled=1 AND v.stock<=MAX(v.low_stock_threshold,0) " +
      "AND p.inventory_mode='variants'"
    ),
    salesChartSeries(env, "daily"),
    salesChartSeries(env, "weekly"),
    salesChartSeries(env, "monthly")
  ]);

  const lowStock = await one(
    env,
    "SELECT COUNT(*) AS total FROM products " +
    "WHERE published=1 AND inventory_mode IN ('simple','shared') " +
    "AND low_stock_threshold>0 AND stock<=low_stock_threshold"
  );

  return {
    orders: {
      total: Number(orders.total || 0),
      new: Number(orders.new_count || 0),
      confirmed: Number(orders.confirmed_count || 0),
      sent: Number(orders.sent_count || 0),
      cancelled: Number(orders.cancelled_count || 0),
      review: Number(orders.review_count || 0)
    },
    paidTotal: Number(orders.paid_total || 0),
    paidMonth: Number(orders.paid_month || 0),
    products: {
      total: Number(products.total || 0),
      published: Number(products.published || 0)
    },
    lowStock:
      Number(lowStock.total || 0) + Number(variants.total || 0),
    chart: {
      daily: daily,
      weekly: weekly,
      monthly: monthly
    }
  };
}

/*
 * Paid-sales buckets for the Mini App home charts.
 * daily   -> last 14 days   (bucket = YYYY-MM-DD)
 * weekly  -> last 8 weeks   (bucket = date of the Saturday starting the week)
 * monthly -> last 6 months  (bucket = YYYY-MM)
 * Buckets with no sales are filled client-side with zero bars.
 */
function salesChartSeries(env, range) {
  const config = {
    daily: {
      since: 14 * 86400000,
      group: "strftime('%Y-%m-%d', o.paid_at/1000, 'unixepoch')"
    },
    weekly: {
      since: 8 * 7 * 86400000,
      /*
       * Persian weeks start on Saturday. strftime('%w') maps
       * Saturday to 6, so (w + 1) % 7 is the number of days to step
       * back in order to reach the Saturday that starts the week.
       */
      group:
        "date(o.paid_at/1000, 'unixepoch', '-' || " +
        "((CAST(strftime('%w', o.paid_at/1000, 'unixepoch') AS INTEGER) + 1) % 7) || " +
        "' days')"
    },
    monthly: {
      since: 6 * 31 * 86400000,
      group: "strftime('%Y-%m', o.paid_at/1000, 'unixepoch')"
    }
  }[range];

  return rows(
    env,
    "SELECT " + config.group + " AS bucket, " +
    "COALESCE(SUM(o.total),0) AS amount, COUNT(*) AS orders " +
    "FROM orders o " +
    "WHERE o.payment_status='paid' AND o.status!='cancelled' " +
    "AND o.paid_at IS NOT NULL AND o.paid_at>=? " +
    "GROUP BY bucket ORDER BY bucket",
    [Date.now() - config.since]
  ).then(list =>
    list.map(item => ({
      bucket: String(item.bucket || ""),
      amount: Number(item.amount || 0),
      orders: Number(item.orders || 0)
    }))
  ).catch(() => []);
}

async function apiOrders(env, url) {
  const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") || 0)));
  const filter = String(url.searchParams.get("filter") || "all");

  let where = "1=1";
  const params = [];

  if (["new", "confirmed", "sent", "cancelled"].includes(filter)) {
    where += " AND status=?";
    params.push(filter);
  } else if (filter === "review") {
    where += " AND payment_status='review'";
  } else if (filter === "paid") {
    where += " AND payment_status='paid'";
  }

  const records = await rows(
    env,
    "SELECT id,code,name,phone,total,status,payment_status,payment_method,gateway,created_at " +
    "FROM orders WHERE " + where +
    " ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
    [...params, PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  return {
    orders: records.slice(0, PAGE_SIZE).map(order => ({
      ...order,
      gatewayLabel: order.gateway || ""
    })),
    hasMore: records.length > PAGE_SIZE,
    page
  };
}

/*
 * CSV export of the current order filter. Same query and same permission
 * gate as the list endpoint, so an exported file can never leak orders the
 * admin could not already see in the panel. The BOM makes Excel read the
 * Persian text as UTF-8 instead of garbling it.
 */
async function apiOrdersCsv(env, access, url) {
  await requirePermission(access, "orders");

  const filter = String(url.searchParams.get("filter") || "all");

  let where = "1=1";
  const params = [];

  if (["new", "confirmed", "sent", "cancelled"].includes(filter)) {
    where += " AND status=?";
    params.push(filter);
  } else if (filter === "review") {
    where += " AND payment_status='review'";
  } else if (filter === "paid") {
    where += " AND payment_status='paid'";
  }

  const records = await rows(
    env,
    "SELECT code,name,phone,total,status,payment_status,payment_method," +
    "gateway,created_at FROM orders WHERE " + where +
    " ORDER BY created_at DESC,id LIMIT 500",
    params
  );

  const columns = [
    "کد", "نام", "موبایل", "مبلغ", "وضعیت", "پرداخت", "روش پرداخت",
    "درگاه", "تاریخ ثبت"
  ];

  const labels = orderStatusLabels;

  const lines = records.map(order => [
    order.code,
    order.name,
    order.phone,
    String(order.total),
    labels(order.status),
    order.payment_status,
    order.gateway
      ? "درگاه (" + (GATEWAY_LABELS[order.gateway] || order.gateway) + ")"
      : (order.payment_method === "card" ? "کارت‌به‌کارت" : "هماهنگی"),
    order.gateway || "",
    new Date(order.created_at).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })
  ].map(cell => {
    const text = String(cell ?? "");

    // RFC 4180: quote any cell containing a comma, quote or newline.
    if (/[",\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
  }).join(","));

  return {
    contentType: "text/csv; charset=utf-8",
    filename: "orders-" + filter + ".csv",
    body: String.fromCharCode(0xFEFF) + columns.join(",") + "\n" + lines.join("\n")
  };
}

async function apiOrderDetail(env, orderId) {
  if (!/^[a-f0-9]{32}$/.test(String(orderId))) {
    throw new AppError(404, "سفارش پیدا نشد.");
  }

  const order = await one(env, "SELECT * FROM orders WHERE id=?", [orderId]);

  if (!order) throw new AppError(404, "سفارش پیدا نشد.");

  const [lines, receipts, events] = await Promise.all([
    rows(
      env,
      "SELECT name,selection,price,quantity,inventory_mode FROM order_lines WHERE order_id=? ORDER BY id",
      [orderId]
    ),
    one(env, "SELECT COUNT(*) AS total FROM receipts WHERE order_id=?", [orderId]),
    rows(
      env,
      "SELECT kind,actor_id,created_at FROM order_events WHERE order_id=? ORDER BY created_at DESC LIMIT 8",
      [orderId]
    )
  ]);

  return {
    ...order,
    lines: lines.map(line => ({
      ...line,
      selection: JSON.parse(line.selection || "{}")
    })),
    receiptCount: Number(receipts.total || 0),
    events
  };
}

async function apiOrderStatus(env, access, orderId, status) {
  if (!["confirmed", "sent", "cancelled"].includes(status)) {
    throw new AppError(400, "وضعیت نامعتبر است.");
  }

  const order = await one(env, "SELECT * FROM orders WHERE id=?", [orderId]);

  if (!order) throw new AppError(404, "سفارش پیدا نشد.");

  const allowed =
    (order.status === "new" && ["confirmed", "cancelled"].includes(status)) ||
    (order.status === "confirmed" && ["sent", "cancelled"].includes(status));

  if (!allowed) {
    throw new AppError(409, "این تغییر وضعیت برای سفارش فعلی ممکن نیست.");
  }

  if (status === "cancelled" && order.payment_status === "paid") {
    throw new AppError(409, "سفارش پرداخت‌شده نیازمند بازپرداخت جداگانه است.");
  }

  await changeOrderStatus(env, orderId, status, access.adminId);
  return apiOrderDetail(env, orderId);
}

async function apiOrderApprove(env, access, orderId) {
  await markPaidManually(env, orderId, access.adminId);

  return apiOrderDetail(env, orderId);
}

async function apiProducts(env, url) {
  const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") || 0)));
  const search = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const filter = String(url.searchParams.get("filter") || "all");

  let where = "1=1";
  const params = [];

  if (filter === "published") where += " AND published=1";
  if (filter === "draft") where += " AND published=0";

  if (search) {
    where += " AND (instr(lower(name), lower(?)) > 0)";
    params.push(search);
  }

  const records = await rows(
    env,
    "SELECT id,name,price,stock,published,inventory_mode,created_at," +
    "(SELECT media_id FROM product_images pi WHERE pi.product_id=p.id ORDER BY pi.position,pi.media_id LIMIT 1) AS image " +
    "FROM products p WHERE " + where +
    " ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
    [...params, PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  return {
    products: records.slice(0, PAGE_SIZE),
    hasMore: records.length > PAGE_SIZE,
    page
  };
}

async function apiProductDetail(env, productId) {
  if (!/^[a-f0-9]{32}$/.test(String(productId))) {
    throw new AppError(404, "محصول پیدا نشد.");
  }

  const product = await one(env, "SELECT * FROM products WHERE id=?", [productId]);

  if (!product) throw new AppError(404, "محصول پیدا نشد.");

  const [images, variants, categories] = await Promise.all([
    rows(
      env,
      "SELECT media_id,position FROM product_images WHERE product_id=? ORDER BY position,media_id",
      [productId]
    ),
    rows(
      env,
      "SELECT id,options,price,stock,enabled,low_stock_threshold FROM variants " +
      "WHERE product_id=? ORDER BY created_at,id LIMIT 200",
      [productId]
    ),
    rows(
      env,
      "SELECT id,name,enabled,position FROM categories ORDER BY position,created_at,id LIMIT 200"
    )
  ]);

  return {
    ...product,
    option_schema: JSON.parse(product.option_schema || "[]"),
    images: images.map(image => image.media_id),
    variants: variants.map(variant => ({
      ...variant,
      options: JSON.parse(variant.options)
    })),
    categories
  };
}

function productFields(body, partial, current = {}) {
  const output = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? "").trim();

    if (!name || name.length > 200) {
      throw new AppError(400, "نام محصول بین ۱ تا ۲۰۰ کاراکتر باشد.");
    }

    output.name = name;
  }

  if (body.description !== undefined) {
    const description = String(body.description ?? "");

    if (description.length > 6000) {
      throw new AppError(400, "توضیحات حداکثر ۶۰۰۰ کاراکتر است.");
    }

    output.description = description;
  }

  if (body.attributes !== undefined) {
    const attributes = String(body.attributes ?? "");

    if (attributes.length > 6000) {
      throw new AppError(400, "ویژگی‌های توصیفی حداکثر ۶۰۰۰ کاراکتر است.");
    }

    output.attributes = attributes;
  }

  if (!partial || body.price !== undefined) {
    const price = Number(body.price);

    if (
      !Number.isSafeInteger(price) ||
      price < 0 ||
      price > 1000000000000
    ) {
      throw new AppError(400, "قیمت معتبر نیست.");
    }

    output.price = price;
  }

  if (body.stock !== undefined) {
    const stock = Number(body.stock);

    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000000) {
      throw new AppError(400, "موجودی معتبر نیست.");
    }

    output.stock = stock;
  }

  if (body.lowStockThreshold !== undefined) {
    const threshold = Number(body.lowStockThreshold);

    if (
      !Number.isSafeInteger(threshold) ||
      threshold < 0 ||
      threshold > 1000000000
    ) {
      throw new AppError(400, "آستانه هشدار معتبر نیست.");
    }

    output.low_stock_threshold = threshold;
  }

  if (body.categoryId !== undefined) {
    const categoryId = body.categoryId ? String(body.categoryId) : null;

    output.category_id = categoryId;
  }

  return output;
}

async function apiProductCreateInner(env, body) {
  const fields = productFields(body, false);

  if (fields.category_id) {
    const category = await one(
      env,
      "SELECT id FROM categories WHERE id=?",
      [fields.category_id]
    );

    if (!category) throw new AppError(400, "دسته‌بندی انتخابی وجود ندارد.");
  }

  const id = uid();
  const now = Date.now();

  await execute(
    env,
    "INSERT INTO products(" +
    "id,name,description,attributes,category_id,price,stock," +
    "low_stock_threshold,inventory_mode,option_schema," +
    "published,created_at,updated_at" +
    ") VALUES(?,?,?,?,?,?,?,?, 'simple','[]', 0,?,?)",
    [
      id,
      fields.name,
      fields.description || "",
      fields.attributes || "",
      fields.category_id || null,
      fields.price,
      fields.stock !== undefined ? fields.stock : 0,
      fields.low_stock_threshold !== undefined ? fields.low_stock_threshold : 0,
      now,
      now
    ]
  );

  return { id };
}

async function apiProductCreate(env, access, body) {
  const result = await apiProductCreateInner(env, body);

  await logAdminAction(
    env,
    access.adminId,
    "catalog",
    "ایجاد محصول (مینی‌اپ)",
    String(body.name || "")
  );

  return result;
}

async function apiProductUpdate(env, access, productId, body) {
  const result = await apiProductUpdateInner(env, productId, body);

  await logAdminAction(
    env,
    access.adminId,
    "catalog",
    "ویرایش محصول (مینی‌اپ)",
    String(body.name || "")
  );

  return result;
}

async function apiProductPublish(env, access, productId, published) {
  const result = await apiProductPublishInner(env, productId, published);

  await logAdminAction(
    env,
    access.adminId,
    "catalog",
    published ? "انتشار محصول (مینی‌اپ)" : "بازگشت به پیش‌نویس (مینی‌اپ)"
  );

  return result;
}

async function apiProductDelete(env, access, productId) {
  const detail = await one(
    env,
    "SELECT name FROM products WHERE id=?",
    [productId]
  );

  await deleteProduct(env, productId);

  await logAdminAction(
    env,
    access.adminId,
    "catalog",
    "حذف محصول (مینی‌اپ)",
    detail?.name || ""
  );

  return { ok: true };
}
async function apiProductUpdateInner(env, productId, body) {
  const fields = productFields(body, true);

  if (fields.category_id !== undefined && fields.category_id) {
    const category = await one(
      env,
      "SELECT id FROM categories WHERE id=?",
      [fields.category_id]
    );

    if (!category) throw new AppError(400, "دسته‌بندی انتخابی وجود ندارد.");
  }

  const keys = Object.keys(fields);

  if (!keys.length) throw new AppError(400, "چیزی برای ذخیره ارسال نشد.");

  const assignments = keys.map(key => key + "=?");
  const values = keys.map(key => fields[key]);

  await execute(
    env,
    "UPDATE products SET " + assignments.join(",") + ",updated_at=? WHERE id=?",
    [...values, Date.now(), productId]
  );

  return apiProductDetail(env, productId);
}

async function apiProductPublishInner(env, productId, published) {
  const product = await one(env, "SELECT * FROM products WHERE id=?", [productId]);

  if (!product) throw new AppError(404, "محصول پیدا نشد.");

  if (published) {
    try {
      await validateProductPublish(env, product);
    } catch {
      // Shared validator throws English internals; translate for the wizard.
      throw new AppError(
        409,
        "برای انتشار، ابتدا در گام موجودی، حالت و ترکیب‌های محصول را کامل کنید."
      );
    }
  }

  await execute(
    env,
    "UPDATE products SET published=?,updated_at=? WHERE id=?",
    [published ? 1 : 0, Date.now(), productId]
  );

  return { published: Boolean(published) };
}

/*
 * Per-variant stock editor. The customer-facing variant stays the same;
 * only the stock number (and optionally the enabled flag) changes.
 */
async function apiVariantStock(env, access, productId, body) {
  const product = await one(
    env,
    "SELECT id,inventory_mode FROM products WHERE id=?",
    [productId]
  );

  if (!product) throw new AppError(404, "محصول پیدا نشد.");

  if (product.inventory_mode !== "variants") {
    throw new AppError(409, "این محصول حالت موجودی مستقل ترکیب‌ها ندارد.");
  }

  const stocks = Array.isArray(body.stocks) ? body.stocks : [];

  if (!stocks.length || stocks.length > 100) {
    throw new AppError(400, "فهرست موجودی ترکیب‌ها نامعتبر است.");
  }

  const variants = await rows(
    env,
    "SELECT id FROM variants WHERE product_id=? AND enabled=1",
    [productId]
  );

  const known = new Set(variants.map(variant => variant.id));
  const now = Date.now();
  const statements = [];
  let changed = 0;

  for (const item of stocks) {
    const id = String(item?.id || "");
    const stock = Number(item?.stock);

    if (!known.has(id)) continue;

    if (!Number.isInteger(stock) || stock < 0 || stock > 1000000000) {
      throw new AppError(400, "موجودی هر ترکیب باید عددی بین ۰ و ۱۰۰۰۰۰۰۰۰۰ باشد.");
    }

    statements.push(
      env.DB.prepare(
        "UPDATE variants SET stock=?,updated_at=? WHERE id=? AND product_id=?"
      ).bind(stock, now, id, productId)
    );

    changed++;
  }

  if (!changed) {
    throw new AppError(400, "هیچ ترکیب معتبری برای به‌روزرسانی پیدا نشد.");
  }

  await env.DB.batch(statements);

  await logAdminAction(
    env,
    access.adminId,
    "catalog",
    "به‌روزرسانی موجودی ترکیب‌ها (" + changed.toLocaleString("fa-IR") + " مورد)"
  );

  return apiProductDetail(env, productId);
}

/*
 * Owner-only activity log reader for the Mini App.
 */
async function apiLogs(env, access, url) {
  if (!access.isOwner) {
    throw new AppError(403, "گزارش فعالیت فقط برای مدیر اصلی قابل مشاهده است.");
  }

  const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") || 0)));
  const adminId = String(url.searchParams.get("admin") || "").slice(0, 32);
  const requested = String(url.searchParams.get("section") || "catalog");
  const section = AUDIT_SECTIONS[requested] ? requested : "catalog";

  if (!/^[1-9]\d{0,19}$/.test(adminId)) {
    throw new AppError(400, "شناسه مدیر نامعتبر است.");
  }

  const events = await rows(
    env,
    "SELECT id,action,target,detail,created_at FROM admin_logs " +
    "WHERE admin_id=? AND section=? " +
    "ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
    [adminId, section, PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  return {
    events: events.slice(0, PAGE_SIZE),
    hasMore: events.length > PAGE_SIZE,
    page,
    section
  };
}

/*
 * Shop-users management (permission key "users").
 * Search by phone/name, per-user order stats, block/unblock and
 * delete. Sensitive actions are written to the admin audit log
 * (section "catalog", actions prefixed with "کاربران:") so the
 * owner can see who touched customer accounts.
 */
const USERS_PHONE_RE = /^09\d{9}$/;

function normalizeAdminUserQuery(value) {
  const raw = String(value || "").trim().slice(0, 40);

  if (!raw) return "";

  const english = raw
    .replace(/[۰-۹]/g, ch => String("۰۱۲۳۴۵۶۷۸۹".indexOf(ch)))
    .replace(/[٠-٩]/g, ch => String("٠١٢٣٤٥٦٧٨٩".indexOf(ch)))
    .replace(/^\+98/, "0")
    .replace(/^0098/, "0")
    .replace(/\D/g, "");

  return USERS_PHONE_RE.test(english) ? english : raw;
}

async function apiUsers(env, access, url) {
  await requirePermission(access, "users");

  const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") || 0)));
  const query = normalizeAdminUserQuery(url.searchParams.get("q"));

  const whereClause = query
    ? (USERS_PHONE_RE.test(query)
        ? "WHERE phone = ?"
        : "WHERE name LIKE ?")
    : "";
  const params = query
    ? [USERS_PHONE_RE.test(query) ? query : "%" + query + "%"]
    : [];

  const users = await rows(
    env,
    "SELECT u.id,u.phone,u.name,u.blocked,u.created_at,u.last_login_at," +
    "(SELECT COUNT(*) FROM orders o WHERE o.phone=u.phone) AS orders_count," +
    "(SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.phone=u.phone " +
    "AND o.payment_status='paid') AS paid_total " +
    "FROM shop_users u " + whereClause +
    " ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?",
    [...params, PAGE_SIZE, page * PAGE_SIZE]
  );

  return {
    users: users.map(user => ({
      id: user.id,
      phone: user.phone,
      name: user.name || "",
      blocked: Boolean(user.blocked),
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      ordersCount: Number(user.orders_count || 0),
      paidTotal: Number(user.paid_total || 0)
    })),
    page,
    hasMore: users.length > PAGE_SIZE,
    query
  };
}

async function apiUserOrders(env, access, userId) {
  await requirePermission(access, "users");

  if (!/^[a-f0-9]{32}$/.test(String(userId || ""))) {
    throw new AppError(400, "شناسه کاربر نامعتبر است.");
  }

  const user = await one(
    env,
    "SELECT id,phone,name,blocked,created_at FROM shop_users WHERE id=?",
    [String(userId)]
  );

  if (!user) throw new AppError(404, "کاربر پیدا نشد.");

  const orders = await rows(
    env,
    "SELECT code,status,payment_status,payment_method,gateway,total,created_at " +
    "FROM orders WHERE phone=? ORDER BY created_at DESC,id DESC LIMIT 50",
    [user.phone]
  );

  return {
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name || "",
      blocked: Boolean(user.blocked),
      createdAt: user.created_at
    },
    orders: orders.map(order => ({
      code: order.code,
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMethod: order.gateway ? "gateway" : order.payment_method,
      gateway: order.gateway || "",
      total: order.total,
      createdAt: order.created_at
    }))
  };
}

async function apiUserAction(env, access, userId, body) {
  await requirePermission(access, "users");

  if (!/^[a-f0-9]{32}$/.test(String(userId || ""))) {
    throw new AppError(400, "شناسه کاربر نامعتبر است.");
  }

  const op = String(body.op || "");
  const user = await one(
    env,
    "SELECT id,phone,name,blocked FROM shop_users WHERE id=?",
    [String(userId)]
  );

  if (!user) throw new AppError(404, "کاربر پیدا نشد.");

  if (op === "block" || op === "unblock") {
    const blocked = op === "block" ? 1 : 0;

    await execute(
      env,
      "UPDATE shop_users SET blocked=? WHERE id=?",
      [blocked, String(userId)]
    );

    await logAdminAction(
      env,
      access.adminId,
      "security",
      op === "block" ? "کاربران: مسدودسازی کاربر" : "کاربران: آزادسازی کاربر",
      user.phone,
      ""
    );

    return { ok: true, blocked: Boolean(blocked) };
  }

  if (op === "delete") {
    await execute(env, "DELETE FROM shop_users WHERE id=?", [String(userId)]);

    await logAdminAction(
      env,
      access.adminId,
      "security",
      "کاربران: حذف کاربر",
      user.phone,
      ""
    );

    return { ok: true, deleted: true };
  }

  throw new AppError(400, "عملیات نامعتبر است.");
}

/*
 * SMS settings card (permission key "sms"). The API key is stored and
 * masked like every other credential; re-saving the masked value is a
 * no-op so an accidental save never destroys the real key.
 */
async function apiSmsSettingsGet(env, access) {
  await requirePermission(access, "sms");

  const settings = await getSettings(env);

  return {
    provider: SMS_PROVIDERS.includes(settings.sms_provider)
      ? settings.sms_provider
      : "kavenegar",
    providers: SMS_PROVIDERS.map(name => ({
      key: name,
      label: smsProviderLabel(name)
    })),
    apiKeyMasked: maskValue(settings.sms_api_key),
    apiKeyTouched: Boolean(settings.sms_api_key),
    template: settings.sms_template || ""
  };
}

async function apiSmsSettingsSave(env, access, body) {
  await requirePermission(access, "sms");

  if (body.provider !== undefined) {
    const provider = String(body.provider || "");

    if (!SMS_PROVIDERS.includes(provider)) {
      throw new AppError(400, "سرویس پیامک نامعتبر است.");
    }

    await setSetting(env, "sms_provider", provider);
  }

  if (body.apiKey !== undefined) {
    const key = String(body.apiKey ?? "").trim();

    // The masked placeholder must never overwrite the real credential.
    if (key && !key.includes("•••")) {
      if (key.length > 250) {
        throw new AppError(400, "کلید API بیش از حد طولانی است.");
      }

      await setSetting(env, "sms_api_key", key);
    }
  }

  if (body.template !== undefined) {
    const template = String(body.template ?? "").trim();

    await setSetting(env, "sms_template", parseSetting("sms_template", template || "-"));
  }

  return apiSmsSettingsGet(env, access);
}

async function apiProductOptions(env, access, productId, body) {
  const mode = String(body.mode || "simple");

  if (!["simple", "shared", "variants"].includes(mode)) {
    throw new AppError(400, "حالت موجودی نامعتبر است.");
  }

  let schema = [];

  if (mode !== "simple") {
    schema = parseOptions(String(body.optionsText || ""));

    if (mode === "variants") {
      combinations(schema, 100);
    }
  }

  await applyInventoryStructure(env, {
    productId,
    mode,
    schema
  });

  return apiProductDetail(env, productId);
}

async function apiMediaList(env) {
  const media = await rows(
    env,
    "SELECT id,mime,created_at FROM media WHERE kind='photo' " +
    "ORDER BY created_at DESC LIMIT 60"
  );

  return { media };
}

async function apiAdmins(env, access) {
  const admins = await rows(
    env,
    "SELECT id,name,role,permissions,created_at FROM admins ORDER BY created_at,id"
  );

  return {
    admins: admins.map(admin => {
      const target = accessOfRow(admin);

      return {
        id: admin.id,
        name: admin.name || "",
        role: target.role,
        isOwner: target.isOwner,
        perms: target.perms,
        isYou: admin.id === access.adminId,
        createdAt: admin.created_at
      };
    }),
    permissionDefs: Object.entries(PERMISSIONS).map(([key, label]) => ({
      key,
      label
    }))
  };
}

async function apiAdminSet(env, access, body) {
  const id = String(body.id || "").trim();

  if (!/^[1-9]\d{0,19}$/.test(id)) {
    throw new AppError(400, "شناسه عددی تلگرام معتبر نیست.");
  }

  const permissions = Array.isArray(body.permissions) ? body.permissions : [];

  const valid = [...new Set(permissions)].filter(key => key in PERMISSIONS);

  if (valid.length !== permissions.length) {
    throw new AppError(400, "دسترسی نامعتبر در فهرست وجود دارد.");
  }

  if (!access.isOwner) {
    const missing = valid.filter(key => !access.perms.includes(key));

    if (missing.length) {
      throw new AppError(
        403,
        "شما نمی‌توانید دسترسی‌هایی بدهید که خودتان ندارید."
      );
    }
  }

  const target = await one(env, "SELECT id,role FROM admins WHERE id=?", [id]);

  if (target?.role === "owner") {
    throw new AppError(409, "مدیر اصلی دسترسی کامل و ثابت دارد.");
  }

  if (id === access.adminId && !access.isOwner) {
    throw new AppError(403, "تغییر دسترسی خودتان فقط توسط مدیر اصلی انجام می‌شود.");
  }

  if (target) {
    await execute(
      env,
      "UPDATE admins SET role='custom',permissions=? WHERE id=?",
      [JSON.stringify(valid), id]
    );
  } else {
    await execute(
      env,
      "INSERT INTO admins(id,role,permissions,created_at) VALUES(?,'custom',?,?)",
      [id, JSON.stringify(valid), Date.now()]
    );
  }

  return { ok: true };
}

async function apiAdminDelete(env, access, body) {
  if (!access.isOwner) {
    throw new AppError(403, "حذف مدیران فقط توسط مدیر اصلی مجاز است.");
  }

  const id = String(body.id || "").trim();

  const removed = await one(
    env,
    "DELETE FROM admins WHERE id=? " +
    "AND (SELECT COUNT(*) FROM admins)>1 " +
    "AND (role!='owner' OR " +
    "(SELECT COUNT(*) FROM admins WHERE role='owner')>1) " +
    "RETURNING id",
    [id]
  );

  if (!removed) {
    throw new AppError(
      409,
      "حذف انجام نشد؛ آخرین مدیر و آخرین مدیر اصلی قابل حذف نیستند."
    );
  }

  return { ok: true };
}

// Secrets are masked before reaching the client.
function maskValue(value) {
  const text = String(value || "");

  if (!text) return "";

  return text.slice(0, 2) + "•••";
}

function publicSettings(settings) {
  return {
    store_name: settings.store_name,
    tagline: settings.tagline,
    shipping_fee: settings.shipping_fee,
    free_shipping_over: settings.free_shipping_over,
    orders_enabled: settings.orders_enabled,
    payment_contact_enabled: settings.payment_contact_enabled,
    payment_card_enabled: settings.payment_card_enabled,
    payment_gateway_enabled: settings.payment_gateway_enabled,
    payment_gateway: settings.payment_gateway,
    payment_gateways: Array.isArray(settings.payment_gateways)
      ? settings.payment_gateways
      : [],
    default_sort: settings.default_sort,
    payment_gateway_sandbox: settings.payment_gateway_sandbox,
    site_url: settings.site_url,
    payment_gateway_merchant: maskValue(settings.payment_gateway_merchant),
    snapppay_username: maskValue(settings.snapppay_username),
    snapppay_password: maskValue(settings.snapppay_password),
    snapppay_client_id: maskValue(settings.snapppay_client_id),
    snapppay_client_secret: maskValue(settings.snapppay_client_secret),
    snapppay_base_url: settings.snapppay_base_url,
    snapppay_complete: snapppayReady(settings),
    snapppay_touched: {
      username: Boolean(settings.snapppay_username),
      password: Boolean(settings.snapppay_password),
      client_id: Boolean(settings.snapppay_client_id),
      client_secret: Boolean(settings.snapppay_client_secret)
    }
  };
}

const SETTABLE_KEYS = new Set([
  "store_name",
  "tagline",
  "shipping_fee",
  "free_shipping_over",
  "payment_gateway_merchant",
  "snapppay_username",
  "snapppay_password",
  "snapppay_client_id",
  "snapppay_client_secret",
  "snapppay_base_url"
]);

async function apiSettingSet(env, body) {
  const key = String(body.key || "");
  const value = body.value;

  if (!SETTABLE_KEYS.has(key)) {
    throw new AppError(400, "این مقدار از مینی‌اپ قابل تغییر نیست.");
  }

  if (key === "store_name") {
    const text = String(value ?? "").trim();

    if (!text || text.length > 250) {
      throw new AppError(400, "نام فروشگاه معتبر نیست.");
    }

    await setSetting(env, key, text);
  } else {
    await setSetting(env, key, parseSetting(key, value === null ? "-" : String(value ?? "")));
  }

  return { ok: true };
}

async function apiGatewayAction(env, body) {
  const settings = await getSettings(env);
  const action = String(body.action || "");

  if (action === "toggle") {
    const desired = !settings.payment_gateway_enabled;

    if (desired) {
      const active = activeGateways(settings);

      if (!active.length) {
        throw new AppError(409, "ابتدا حداقل یک درگاه را فعال (✅) کنید.");
      }

      const notReady = active.filter(name => !gatewayReady(settings, name));

      if (notReady.length) {
        throw new AppError(
          409,
          "اطلاعات این درگاه‌ها کامل نیست: " +
          notReady.map(name => GATEWAY_LABELS[name] || name).join("، ")
        );
      }
    }

    await setSetting(env, "payment_gateway_enabled", desired);
  } else if (action === "use") {
    // Toggle one gateway inside the active multi-select list.
    const name = String(body.value || "");

    if (!GATEWAYS.includes(name)) {
      throw new AppError(400, "درگاه نامعتبر است.");
    }

    const active = new Set(activeGateways(settings));

    if (active.has(name)) {
      active.delete(name);
    } else {
      if (!gatewayReady(settings, name)) {
        throw new AppError(
          409,
          name === "snapppay"
            ? "ابتدا چهار مقدار اطلاعات اسنپ‌پی را تکمیل کنید."
            : "ابتدا کد پذیرنده (مرچنت‌آیدی) این درگاه را تنظیم کنید."
        );
      }

      active.add(name);
    }

    await setSetting(env, "payment_gateways", [...active]);
  } else if (action === "pick") {
    if (!GATEWAYS.includes(String(body.value))) {
      throw new AppError(400, "درگاه نامعتبر است.");
    }

    await setSetting(env, "payment_gateway", String(body.value));
  } else if (action === "sandbox") {
    await setSetting(
      env,
      "payment_gateway_sandbox",
      !settings.payment_gateway_sandbox
    );
  } else {
    throw new AppError(400, "درخواست نامعتبر است.");
  }

  const updated = await getSettings(env);

  return { settings: publicSettings(updated) };
}

// ------------------------------------------------------------
// Router
// ------------------------------------------------------------

export async function handleMiniAppAPI(request, env, ctx) {
  await rateLimit(env, ipKey(request, "miniapp"), 300, 300);

  const url = new URL(request.url);
  const sub = url.pathname
    .slice("/miniapp/api/".length)
    .replace(/\/+$/, "");
  const parts = sub.split("/").filter(Boolean);
  const method = request.method;

  const auth = await verifyInitData(
    env,
    request.headers.get("X-Telegram-Init-Data") || ""
  );

  if (!auth) {
    throw new AppError(
      401,
      "نشست تلگرام معتبر نیست؛ مینی‌اپ را از داخل ربات باز کنید."
    );
  }

  const admin = await one(
    env,
    "SELECT id,role,permissions FROM admins WHERE id=?",
    [auth.userId]
  );

  if (!admin) {
    throw new AppError(
      403,
      "دسترسی شما فعال نیست؛ ابتدا در ربات پیام /start بفرستید."
    );
  }

  const access = accessOfRow(admin);
  access.adminId = admin.id;

  const [head] = parts;

  // GET endpoints
  if (method === "GET") {
    if (head === "me") {
      const settings = await getSettings(env);

      return responseJSON({
        admin: {
          id: admin.id,
          name: auth.name,
          role: access.role,
          isOwner: access.isOwner,
          perms: access.perms
        },
        store: { name: settings.store_name, siteUrl: settings.site_url },
        permissions: Object.entries(PERMISSIONS).map(([key, label]) => ({
          key,
          label
        }))
      });
    }

    if (head === "stats") {
      await requirePermission(access, "orders");
      return responseJSON(await apiStats(env, access));
    }

    if (head === "logs") {
      return responseJSON(await apiLogs(env, access, url));
    }

    if (head === "users") {
      if (parts[1] && parts[2] === "orders") {
        return responseJSON(await apiUserOrders(env, access, parts[1]));
      }

      return responseJSON(await apiUsers(env, access, url));
    }

    if (head === "sms-settings") {
      return responseJSON(await apiSmsSettingsGet(env, access));
    }

    // The CSV export must be matched before the bare "orders" list route.
    if (head === "orders" && parts[1] === "csv") {
      const csv = await apiOrdersCsv(env, access, url);

      return new Response(csv.body, {
        status: 200,
        headers: {
          "content-type": csv.contentType,
          "content-disposition":
            'attachment; filename="' + csv.filename + '"'
        }
      });
    }

    if (head === "orders") {
      await requirePermission(access, "orders");
      return responseJSON(await apiOrders(env, url));
    }

    if (head === "order" && parts[1]) {
      await requirePermission(access, "orders");
      return responseJSON(await apiOrderDetail(env, parts[1]));
    }

    if (head === "products") {
      await requirePermission(access, "products");
      return responseJSON(await apiProducts(env, url));
    }

    if (head === "product" && parts[1]) {
      await requirePermission(access, "products");
      return responseJSON(await apiProductDetail(env, parts[1]));
    }

    if (head === "media") {
      await requirePermission(access, "products");
      return responseJSON(await apiMediaList(env));
    }

    if (head === "categories") {
      // The wizard uses this list; category management is its own section.
      if (!allowsAny(access, ["products", "categories"])) {
        throw new AppError(403, "سطح دسترسی شما این بخش را شامل نمی‌شود.");
      }

      const categories = await rows(
        env,
        "SELECT id,name,enabled,position,image_id FROM categories ORDER BY position,created_at,id LIMIT 300"
      );
      return responseJSON({ categories });
    }

    if (head === "admins") {
      await requirePermission(access, "admins");
      return responseJSON(await apiAdmins(env, access));
    }

    if (head === "settings") {
      await requirePermission(
        access,
        allows(access, "gateway") ? "gateway" : "settings"
      );

      const settings = await getSettings(env);
      return responseJSON({ settings: publicSettings(settings) });
    }
  }

  // POST endpoints
  if (method === "POST") {
    if (head === "order" && parts[1] && parts[2] === "status") {
      await requirePermission(access, "orders");
      const body = await bodyJSON(request);
      return responseJSON(
        await apiOrderStatus(env, access, parts[1], String(body.status || ""))
      );
    }

    if (head === "order" && parts[1] && parts[2] === "approvepay") {
      await requirePermission(access, "orders");
      return responseJSON(await apiOrderApprove(env, access, parts[1]));
    }

    if (head === "product" && !parts[1]) {
      await requirePermission(access, "products");
      const body = await bodyJSON(request);
      return responseJSON(await apiProductCreate(env, access, body));
    }

    if (head === "product" && parts[1] && parts[2] === "publish") {
      await requirePermission(access, "products");
      const body = await bodyJSON(request);
      return responseJSON(
        await apiProductPublish(env, access, parts[1], Boolean(body.published))
      );
    }

    if (head === "product" && parts[1] && parts[2] === "delete") {
      await requirePermission(access, "products");
      return responseJSON(await apiProductDelete(env, access, parts[1]));
    }

    if (head === "product" && parts[1] && parts[2] === "variant-stock") {
      await requirePermission(access, "products");
      const body = await bodyJSON(request);
      return responseJSON(await apiVariantStock(env, access, parts[1], body));
    }

    if (head === "product" && parts[1] && parts[2] === "options") {
      await requirePermission(access, "products");
      const body = await bodyJSON(request);
      return responseJSON(await apiProductOptions(env, access, parts[1], body));
    }

    if (head === "product" && parts[1] && parts[2] === "images") {
      await requirePermission(access, "products");
      const body = await bodyJSON(request);
      await setProductImages(env, parts[1], body.mediaIds || []);
      return responseJSON(await apiProductDetail(env, parts[1]));
    }

    if (head === "product" && parts[1] && parts[2] === "images-add") {
      await requirePermission(access, "products");
      const body = await bodyJSON(request);
      await addProductImage(env, parts[1], String(body.mediaId || ""));
      return responseJSON(await apiProductDetail(env, parts[1]));
    }

    if (head === "product" && parts[1] && parts[2] === "images-remove") {
      await requirePermission(access, "products");
      const body = await bodyJSON(request);
      await removeProductImage(env, parts[1], String(body.mediaId || ""));
      return responseJSON(await apiProductDetail(env, parts[1]));
    }

    if (head === "product" && parts[1]) {
      await requirePermission(access, "products");
      const body = await bodyJSON(request);
      return responseJSON(await apiProductUpdate(env, access, parts[1], body));
    }

    if (head === "media" && parts[1] === "upload") {
      await requirePermission(access, "products");

      const bytes = await readBytes(request, 4 * 1024 * 1024);
      const mediaId = await uploadProductImage(env, admin.id, bytes);

      return responseJSON({ id: mediaId });
    }

    if (head === "category" && !parts[1]) {
      await requirePermission(access, "categories");
      const body = await bodyJSON(request);
      const name = String(body.name || "").trim();

      if (!name || name.length > 120) {
        throw new AppError(400, "نام دسته‌بندی معتبر نیست.");
      }

      const id = uid();
      const now = Date.now();

      await execute(
        env,
        "INSERT INTO categories(id,name,enabled,position,created_at,updated_at) " +
        "VALUES(?,?,0,0,?,?)",
        [id, name, now, now]
      );

      return responseJSON({ id });
    }

    if (head === "category" && parts[1]) {
      await requirePermission(access, "categories");
      const body = await bodyJSON(request);

      if (body.name !== undefined) {
        const name = String(body.name || "").trim();

        if (!name || name.length > 120) {
          throw new AppError(400, "نام دسته‌بندی معتبر نیست.");
        }

        await execute(
          env,
          "UPDATE categories SET name=?,updated_at=? WHERE id=?",
          [name, Date.now(), parts[1]]
        );
      }

      if (body.enabled !== undefined) {
        await execute(
          env,
          "UPDATE categories SET enabled=?,updated_at=? WHERE id=?",
          [body.enabled ? 1 : 0, Date.now(), parts[1]]
        );
      }

      return responseJSON({ ok: true });
    }

    if (head === "admins" && parts[1] === "delete") {
      await requirePermission(access, "admins");
      const body = await bodyJSON(request);
      return responseJSON(await apiAdminDelete(env, access, body));
    }

    if (head === "admins" && !parts[1]) {
      await requirePermission(access, "admins");
      const body = await bodyJSON(request);
      return responseJSON(await apiAdminSet(env, access, body));
    }

    if (head === "users" && parts[1] && parts[2] === "action") {
      const body = await bodyJSON(request);
      return responseJSON(await apiUserAction(env, access, parts[1], body));
    }

    if (head === "sms-settings") {
      const body = await bodyJSON(request);
      return responseJSON(await apiSmsSettingsSave(env, access, body));
    }

    if (head === "settings") {
      await requirePermission(access, "settings");
      const body = await bodyJSON(request);
      return responseJSON(await apiSettingSet(env, body));
    }

    if (head === "gateway") {
      await requirePermission(access, "gateway");
      const body = await bodyJSON(request);
      return responseJSON(await apiGatewayAction(env, body));
    }
  }

  throw new AppError(404, "Endpoint not found.");
}

// ------------------------------------------------------------
// Frontend page
// ------------------------------------------------------------

export function miniAppPage() {
  // String.raw keeps \d, \s, \/, \n ... verbatim for the served page script
  // (a plain template literal silently eats unknown escapes).
  return String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="robots" content="noindex">
<title>پنل مدیریت فروشگاه</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{
  --bg:#0c1310;--bg2:#111d17;--ink:#eef5f0;--mut:#93a89c;
  --glass:rgba(255,255,255,.055);--glass2:rgba(255,255,255,.09);
  --line:rgba(255,255,255,.13);--accent:#7ce495;--accent-ink:#08130c;
  --danger:#ff8b8b;--warn:#ffd47e;
}
body.light{
  --bg:#eef2ee;--bg2:#e3eae4;--ink:#15241b;--mut:#5c6f63;
  --glass:rgba(255,255,255,.62);--glass2:rgba(255,255,255,.85);
  --line:rgba(21,36,27,.12);
}
html,body{height:100%}
body{
  margin:0;font-family:Vazirmatn,Tahoma,sans-serif;color:var(--ink);
  background:
    radial-gradient(120% 60% at 85% -10%, rgba(124,228,149,.14), transparent 60%),
    radial-gradient(90% 50% at 0% 0%, rgba(99,124,104,.20), transparent 55%),
    linear-gradient(180deg,var(--bg),var(--bg2));
  background-attachment:fixed;
  line-height:1.8;font-size:15px;
  padding-bottom:calc(76px + env(safe-area-inset-bottom));
}
#app{max-width:640px;margin:0 auto;padding:14px 14px 0}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 2px 14px}
.brand{display:flex;align-items:center;gap:11px;min-width:0}
.logo{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;font-size:1.3rem;
  background:linear-gradient(135deg,rgba(124,228,149,.25),rgba(124,228,149,.08));
  border:1px solid var(--line);flex:none}
.brand h1{margin:0;font-size:1.02rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw}
.chip{display:inline-block;font-size:.68rem;color:var(--mut);border:1px solid var(--line);
  border-radius:999px;padding:1px 9px;margin-top:2px;background:var(--glass)}
.iconbtn{width:44px;height:44px;border-radius:13px;border:1px solid var(--line);background:var(--glass);
  color:var(--ink);font-size:1.05rem;cursor:pointer;flex:none}
.iconbtn:active{transform:scale(.94)}
.tabs{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:center;gap:4px;
  padding:8px 10px calc(8px + env(safe-area-inset-bottom));z-index:60;
  background:linear-gradient(180deg,transparent,var(--bg) 30%)}
.tabs-inner{display:flex;gap:4px;width:100%;max-width:640px;
  background:var(--glass2);border:1px solid var(--line);border-radius:22px;
  padding:6px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  box-shadow:0 12px 34px rgba(0,0,0,.35)}
.tab{flex:1;border:0;background:transparent;color:var(--mut);font-family:inherit;font-size:.66rem;
  display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 2px;border-radius:16px;cursor:pointer}
.tab .ic{font-size:1.12rem;line-height:1}
.tab.active{background:var(--accent);color:var(--accent-ink);font-weight:700}
.card{background:var(--glass);border:1px solid var(--line);border-radius:20px;padding:16px;
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);margin-bottom:12px}
.card h3{margin:0 0 10px;font-size:.92rem}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.stat{background:var(--glass);border:1px solid var(--line);border-radius:18px;padding:13px 14px}
.stat .v{font-size:1.22rem;font-weight:800;letter-spacing:.2px}
.stat .k{font-size:.7rem;color:var(--mut);margin-top:1px}
.stat.hot .v{color:var(--accent)}
/* Sales bar chart (home) */
.chart{display:flex;align-items:flex-end;gap:3px;min-height:172px}
.chart .bar-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;height:172px;padding-bottom:2px}
.chart .bar-label-wrap{width:100%;display:flex;justify-content:center}
.chart .bar{width:100%;max-width:26px;background:linear-gradient(180deg,var(--accent),var(--brand));border-radius:7px 7px 2px 2px;min-height:2px;opacity:.92}
.chart .bar-label{font-size:.56rem;color:var(--mut);white-space:nowrap;max-width:64px;overflow:visible;text-overflow:clip;transform:rotate(-38deg);transform-origin:center}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.mut{color:var(--mut);font-size:.74rem}
.btn{border:1px solid var(--line);background:var(--glass);color:var(--ink);font-family:inherit;
  font-size:.86rem;border-radius:14px;padding:11px 16px;cursor:pointer;font-weight:600}
.btn:active{transform:scale(.97)}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.btn.danger{background:rgba(255,120,120,.12);color:var(--danger);border-color:rgba(255,120,120,.3)}
.btn.wide{width:100%}
.btn.sm{padding:7px 12px;font-size:.76rem;border-radius:11px}
.btn[disabled]{opacity:.45;pointer-events:none}
.chips{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.fchip{flex:none;min-height:44px;border:1px solid var(--line);background:var(--glass);color:var(--mut);
  border-radius:999px;padding:8px 16px;font-size:.78rem;font-family:inherit;cursor:pointer}
.fchip.active{background:var(--accent);color:var(--accent-ink);border-color:transparent;font-weight:700}
.list{display:flex;flex-direction:column;gap:10px}
.item{display:flex;align-items:center;gap:12px;background:var(--glass);border:1px solid var(--line);
  border-radius:18px;padding:12px 14px;cursor:pointer}
.item:active{transform:scale(.985)}
.item .thumb{width:52px;height:52px;border-radius:13px;background:var(--glass2);flex:none;
  object-fit:cover;border:1px solid var(--line);display:grid;place-items:center;font-size:1.2rem}
.item .ti{min-width:0;flex:1}
.item .ti b{display:block;font-size:.85rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.dot.g{background:var(--accent);box-shadow:0 0 9px rgba(124,228,149,.7)}
.dot.y{background:var(--warn);box-shadow:0 0 9px rgba(255,212,126,.6)}
.dot.r{background:var(--danger);box-shadow:0 0 9px rgba(255,139,139,.6)}
.dot.x{background:var(--mut)}
.fab{position:fixed;bottom:calc(84px + env(safe-area-inset-bottom));inset-inline-start:18px;
  width:56px;height:56px;border-radius:19px;border:0;background:var(--accent);color:var(--accent-ink);
  font-size:1.7rem;font-weight:800;cursor:pointer;z-index:55;box-shadow:0 14px 34px rgba(124,228,149,.35)}
.fab:active{transform:scale(.93)}
.sheet{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-end}
.sheet[hidden]{display:none}
.backdrop{position:absolute;inset:0;background:rgba(4,10,7,.62);backdrop-filter:blur(3px)}
.sheet-body{position:relative;width:100%;max-width:640px;margin:0 auto;max-height:92%;
  overflow-y:auto;overscroll-behavior:contain;
  background:var(--bg2);border:1px solid var(--line);border-bottom:0;
  border-radius:26px 26px 0 0;padding:10px 16px calc(26px + env(safe-area-inset-bottom));
  animation:up .26s cubic-bezier(.2,.9,.3,1)}
@keyframes up{from{transform:translateY(60px);opacity:.4}to{transform:none;opacity:1}}
.handle{width:44px;height:5px;border-radius:99px;background:var(--line);margin:4px auto 12px}
.sheet h2{margin:0 0 4px;font-size:1.05rem}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:.7rem;border-radius:999px;
  padding:3px 11px;border:1px solid var(--line);background:var(--glass);color:var(--mut)}
.badge.g{color:var(--accent);border-color:rgba(124,228,149,.35)}
.badge.y{color:var(--warn);border-color:rgba(255,212,126,.35)}
.badge.r{color:var(--danger);border-color:rgba(255,139,139,.35)}
.kv{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:.82rem}
.kv:last-child{border-bottom:0}
.kv .k{color:var(--mut);flex:none}
.kv .v{text-align:left;word-break:break-word}
.line{background:var(--glass);border:1px solid var(--line);border-radius:15px;padding:10px 13px;margin-bottom:8px;font-size:.8rem}
.actions{display:flex;flex-direction:column;gap:9px;margin-top:14px}
label.fl{display:block;font-size:.74rem;color:var(--mut);margin:12px 0 5px}
input.in,textarea.in,select.in{width:100%;background:var(--glass);border:1px solid var(--line);color:var(--ink);
  border-radius:14px;padding:11px 13px;font-family:inherit;font-size:.86rem;outline:none}
input.in:focus,textarea.in:focus,select.in:focus{border-color:var(--accent)}
textarea.in{min-height:96px;resize:vertical}
.seg{display:flex;background:var(--glass);border:1px solid var(--line);border-radius:15px;padding:4px;gap:4px}
.seg button{flex:1;border:0;background:transparent;color:var(--mut);font-family:inherit;font-size:.76rem;
  padding:9px 4px;border-radius:11px;cursor:pointer}
.seg button.active{background:var(--accent);color:var(--accent-ink);font-weight:700}
/* گلاس چک‌باکس‌های دسترسی */
.permgrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}
.perm{position:relative;display:flex;align-items:center;gap:9px;padding:12px 13px;cursor:pointer;
  border-radius:16px;border:1px solid var(--line);background:var(--glass);
  font-size:.78rem;font-weight:600;color:var(--mut);user-select:none;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:all .18s ease}
.perm .box{width:21px;height:21px;border-radius:8px;border:1.5px solid var(--line);flex:none;
  display:grid;place-items:center;font-size:.7rem;color:transparent;background:rgba(255,255,255,.04)}
.perm.on{color:var(--ink);border-color:rgba(124,228,149,.45);
  background:linear-gradient(160deg,rgba(124,228,149,.16),rgba(124,228,149,.05));
  box-shadow:inset 0 0 22px rgba(124,228,149,.10),0 6px 18px rgba(0,0,0,.18)}
.perm.on .box{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.perm.lock{opacity:.42;pointer-events:none}
.imggrid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:10px}
.imgcell{position:relative;aspect-ratio:1;border-radius:15px;overflow:hidden;border:1px solid var(--line);background:var(--glass)}
.imgcell img{width:100%;height:100%;object-fit:cover;display:block}
.imgcell .rm{position:absolute;top:5px;inset-inline-start:5px;width:24px;height:24px;border-radius:9px;
  border:0;background:rgba(0,0,0,.55);color:#fff;font-size:.72rem;cursor:pointer}
.imgcell.add{display:grid;place-items:center;font-size:.72rem;color:var(--mut);cursor:pointer;text-align:center;padding:4px}
.steps{display:flex;gap:6px;margin:6px 0 14px}
.steps span{flex:1;height:4px;border-radius:99px;background:var(--line)}
.steps span.on{background:var(--accent)}
.toast{position:fixed;bottom:calc(96px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);
  background:var(--glass2);border:1px solid var(--line);color:var(--ink);z-index:120;
  padding:11px 20px;border-radius:15px;font-size:.82rem;backdrop-filter:blur(16px);
  box-shadow:0 14px 40px rgba(0,0,0,.4);max-width:86%;text-align:center;animation:up .2s ease}
.toast.ok{border-color:rgba(124,228,149,.5)}
.toast.err{border-color:rgba(255,139,139,.55)}
.lock{position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:var(--bg);padding:26px;text-align:center}
/* Author display would otherwise beat the UA rule behind [hidden]. */
.lock[hidden]{display:none}
.lock .ic{font-size:2.6rem;margin-bottom:12px}
.lock p{color:var(--mut);font-size:.88rem;max-width:340px;margin:8px auto 0}
.empty{text-align:center;color:var(--mut);padding:34px 10px;font-size:.84rem}
.search{display:flex;gap:8px;margin-bottom:12px}
.search input{flex:1}
.pill{display:inline-block;font-size:.68rem;border-radius:999px;padding:2px 9px;margin-inline-start:6px;
  border:1px solid var(--line);color:var(--mut)}
.note{font-size:.72rem;color:var(--mut);background:var(--glass);border:1px dashed var(--line);
  border-radius:13px;padding:9px 12px;margin-top:12px;line-height:1.9}
.oktext{color:var(--accent)}.errtext{color:var(--danger)}
</style>
</head>
<body>
<div id="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo">🛍</span>
      <div>
        <h1 id="storeName">پنل مدیریت</h1>
        <span id="roleChip" class="chip">…</span>
      </div>
    </div>
    <button id="refreshBtn" class="iconbtn" title="تازه‌سازی">↻</button>
  </header>
  <main id="view"></main>
  <nav class="tabs"><div class="tabs-inner" id="tabs"></div></nav>
</div>

<div id="sheet" class="sheet" hidden>
  <div class="backdrop" id="sheetBackdrop"></div>
  <div class="sheet-body">
    <div class="handle"></div>
    <div id="sheetContent"></div>
  </div>
</div>

<div id="toast" class="toast" hidden></div>

<div id="lock" class="lock" hidden>
  <div>
    <div class="ic">🔐</div>
    <h2>پنل مدیریت</h2>
    <p>این بخش فقط از داخل تلگرام و با دسترسی مدیریتی باز می‌شود.
    در ربات فروشگاه پیام /start بفرستید و دکمه «پنل مدیریت (مینی‌اپ)» را بزنید.</p>
  </div>
</div>

<script>
(function () {
  "use strict";

  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  var HAS_TG = Boolean(tg && typeof tg.initData === "string" && tg.initData.length > 0);

  var STATE = {
    me: null,
    permissions: [],
    view: "home",
    orders: { filter: "all", page: 0, items: [], hasMore: false, loading: false },
    products: { filter: "all", q: "", page: 0, items: [], hasMore: false, loading: false },
    logs: { admin: "", section: "catalog", page: 0, items: [], hasMore: false, loading: false },
    users: { q: "", page: 0, items: [], hasMore: false, loading: false },
    categories: [],
    admins: [],
    wizard: null,
    sheetReturn: null
  };

  var VIEW_NAMES = {
    home: { icon: "🏠", label: "خانه", perm: null },
    orders: { icon: "📦", label: "سفارش‌ها", perm: "orders" },
    products: { icon: "🛍", label: "محصولات", perm: "products" },
    users: { icon: "🧑‍💻", label: "کاربران", perm: "users" },
    logs: { icon: "🕵️", label: "گزارش", perm: "owner_only" },
    admins: { icon: "👥", label: "مدیران", perm: "admins" },
    settings: { icon: "⚙️", label: "تنظیمات", perm: "gateway_or_settings" }
  };

  // ---------- utilities ----------

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(value) {
    return Number(value || 0).toLocaleString("fa-IR") + " تومان";
  }

  function num(value) { return Number(value || 0).toLocaleString("fa-IR"); }

  function dateFa(ts) {
    if (!ts) return "—";
    try {
      return new Date(Number(ts)).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
    } catch (e) { return "—"; }
  }

  function haptic(kind) {
    try {
      if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred(kind || "light");
    } catch (e) {}
  }

  var toastTimer = null;

  function toast(message, ok) {
    var el = $("toast");
    clearTimeout(toastTimer);
    el.className = "toast " + (ok ? "ok" : "err");
    el.textContent = message;
    el.hidden = false;
    toastTimer = setTimeout(function () { el.hidden = true; }, 3600);
  }

  function confirmBox(message, callback) {
    if (tg && tg.showConfirm) {
      tg.showConfirm(message, function (ok) { if (ok) callback(); });
    } else if (window.confirm) {
      if (window.confirm(message)) callback();
    } else {
      callback();
    }
  }

  function api(path, method, body, raw) {
    var options = { method: method || "GET", headers: { "X-Telegram-Init-Data": tg ? tg.initData : "" } };

    if (raw) {
      options.body = raw;
      options.headers["content-type"] = raw.type || "application/octet-stream";
    } else if (body) {
      options.body = JSON.stringify(body);
      options.headers["content-type"] = "application/json";
    }

    return fetch("/miniapp/api/" + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          throw new Error(data && data.error ? data.error : "خطای نامشخص (" + response.status + ")");
        }
        return data;
      });
    });
  }

  function hasPerm(key) {
    if (!STATE.me) return false;
    if (STATE.me.isOwner) return true;
    return STATE.me.perms.indexOf(key) !== -1;
  }

  function canSettingsView() {
    return hasPerm("settings") || hasPerm("gateway");
  }

  // ---------- sheet ----------

  var sheetStack = [];

  function openSheet(html) {
    $("sheetContent").innerHTML = html;
    $("sheet").hidden = false;
    $("sheet").querySelector(".sheet-body").scrollTop = 0;
    sheetStack.push(true);
    updateBack();
  }

  function closeSheet() {
    if ($("sheet").hidden) return false;
    $("sheet").hidden = true;
    $("sheetContent").innerHTML = "";
    sheetStack.pop();
    updateBack();
    return true;
  }

  function sheetOpen() { return !$("sheet").hidden; }

  function updateBack() {
    if (!tg || !tg.BackButton) return;
    if (sheetOpen() || STATE.view !== "home") {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }

  // ---------- navigation ----------

  function renderTabs() {
    var wrap = $("tabs");
    wrap.innerHTML = "";
    Object.keys(VIEW_NAMES).forEach(function (name) {
      var def = VIEW_NAMES[name];
      var visible =
        def.perm === "gateway_or_settings" ? canSettingsView() :
        def.perm === "owner_only" ? Boolean(STATE.me && STATE.me.isOwner) :
        def.perm ? hasPerm(def.perm) : true;
      if (!visible) return;
      var btn = document.createElement("button");
      btn.className = "tab" + (STATE.view === name ? " active" : "");
      btn.innerHTML = '<span class="ic">' + def.icon + '</span>' + def.label;
      btn.onclick = function () { haptic(); navigate(name); };
      wrap.appendChild(btn);
    });
  }

  function navigate(view) {
    STATE.view = view;
    closeSheet();
    renderTabs();
    updateBack();

    if (view === "home") renderHome();
    if (view === "orders") { renderOrdersView(); loadOrders(false); }
    if (view === "products") { renderProductsView(); loadProducts(false); }
    if (view === "logs") renderLogsView();
    if (view === "users") { renderUsersView(); loadUsers(false); }
    if (view === "admins") { renderAdminsView(); loadAdmins(); }
    if (view === "settings") renderSettingsView();
  }

  // ---------- home ----------

  function renderHome() {
    var roleText = STATE.me.isOwner
      ? "مدیر اصلی — دسترسی کامل"
      : STATE.me.role === "custom"
        ? "دسترسی سفارشی"
        : STATE.me.role === "operator" ? "اپراتور سفارش" : "مدیر";

    $("storeName").textContent = STATE.storeName || "پنل مدیریت";
    $("roleChip").textContent = roleText;

    var html =
      '<div class="card">' +
      '<h3>سلام ' + esc(STATE.me.name || "مدیر") + " 👋</h3>" +
      '<div class="mut">کارهای روزانه فروشگاه را سریع و ساده انجام دهید.</div>' +
      "</div>";

    if (hasPerm("orders")) {
      html +=
        '<div class="card"><h3>📊 خلاصه امروز</h3><div id="statsBox"><div class="mut">در حال دریافت…</div></div></div>';
    }

    var actions = [];

    if (hasPerm("orders")) {
      actions.push({ icon: "📦", title: "بررسی سفارش‌ها", go: "orders" });
      actions.push({ icon: "🧾", title: "رسیدهای نیازمند بررسی", go: "orders-review" });
    }
    if (hasPerm("products")) {
      actions.push({ icon: "➕", title: "محصول جدید", go: "new-product" });
      actions.push({ icon: "🛍", title: "مدیریت محصولات", go: "products" });
    }
    if (hasPerm("admins")) actions.push({ icon: "👥", title: "مدیران و دسترسی‌ها", go: "admins" });
    if (hasPerm("users")) actions.push({ icon: "🧑‍💻", title: "کاربران سایت", go: "users" });
    if (canSettingsView()) actions.push({ icon: "🏦", title: "درگاه پرداخت", go: "settings" });
    if (STATE.me.isOwner) actions.push({ icon: "🕵️", title: "گزارش فعالیت مدیران", go: "logs" });

    if (actions.length) {
      html += '<div class="card"><h3>⚡ دسترسی سریع</h3><div class="grid2" id="quickActions">';
      actions.forEach(function (action) {
        html +=
          '<div class="stat" style="cursor:pointer" data-go="' + action.go + '">' +
          '<div style="font-size:1.3rem">' + action.icon + "</div>" +
          '<div class="k" style="font-weight:700;color:var(--ink);margin-top:4px">' + action.title + "</div></div>";
      });
      html += "</div></div>";
    }

    html +=
      '<div class="note">پنل ربات تلگرام هم همیشه در دسترس است؛ این مینی‌اپ برای سرعت کار شما اضافه شده. ' +
      "برای عملیات پیشرفته‌تر (عکس با ربات، ویرایش گروهی و…) از دکمه «پنل مدیریت» در ربات استفاده کنید.</div>";

    $("view").innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll("[data-go]"), function (el) {
      el.onclick = function () {
        var go = el.getAttribute("data-go");
        haptic();
        if (go === "orders") navigate("orders");
        if (go === "orders-review") {
          STATE.orders.filter = "review";
          navigate("orders");
        }
        if (go === "products") navigate("products");
        if (go === "new-product") { navigate("products"); openWizard(null); }
        if (go === "logs") navigate("logs");
        if (go === "admins") navigate("admins");
        if (go === "users") navigate("users");
        if (go === "settings") navigate("settings");
      };
    });

    if (hasPerm("orders")) loadStats();
  }

  function loadStats() {
    api("stats").then(function (data) {
      STATE.statsData = data;
      var box = $("statsBox");
      if (!box) return;
      box.innerHTML =
        '<div class="grid2">' +
        statCard(data.orders.new, "سفارش جدید", "hot") +
        statCard(data.orders.review, "رسید نیازمند بررسی", data.orders.review ? "" : "") +
        statCard(data.orders.confirmed, "تأییدشده") +
        statCard(data.orders.sent, "ارسال‌شده") +
        "</div>" +
        '<div class="mut" style="margin-top:10px">فروش تأییدشده ۳۰ روز اخیر: <b class="oktext">' +
        money(data.paidMonth) + "</b></div>" +
        '<div style="margin-top:14px">' + salesChartHTML(data) + "</div>";

      Array.prototype.forEach.call(document.querySelectorAll("[data-chartmode]"), function (btn) {
        btn.onclick = function () {
          haptic();
          STATE.chartMode = btn.getAttribute("data-chartmode");
          Array.prototype.forEach.call(document.querySelectorAll("[data-chartmode]"), function (other) {
            other.classList.toggle("active", other === btn);
          });
          var host = $("salesChart");
          if (host) host.innerHTML = salesChartBars(data);
        };
      });
    }).catch(function (error) {
      var box = $("statsBox");
      if (box) box.innerHTML = '<div class="errtext">' + esc(error.message) + "</div>";
    });
  }

  // ---------- sales charts (home) ----------

  var JALALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

  function toJalali(gy, gm, gd) {
    var gDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var jy = gy <= 1600 ? 0 : 979;
    gy -= gy <= 1600 ? 621 : 1600;
    var gy2 = gm > 2 ? gy + 1 : gy;
    var days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
      Math.floor((gy2 + 399) / 400) - 80 + gd + gDays[gm - 1];
    jy += 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      jy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    var jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    return [jy, jm];
  }

  function jalaliBucketLabel(bucket, mode) {
    var parts = String(bucket).split("-");
    if (parts.length < 2) return bucket;
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = parts.length > 2 ? Number(parts[2]) : 1;
    if (!y || !m) return bucket;
    var jalali = toJalali(y, m, d);
    if (mode === "monthly") {
      return JALALI_MONTHS[jalali[1] - 1] + " " + num(jalali[0]);
    }
    return num(jalali[1]) + " " + JALALI_MONTHS[jalali[1] - 1];
  }

  function chartModeBuckets(mode) {
    if (mode === "weekly") return 8;
    if (mode === "monthly") return 6;
    return 14;
  }

  function chartBucketsFor(mode, series) {
    /*
     * Build a full list of buckets (empty ones included) so gaps in
     * sales appear as zero bars instead of silently disappearing.
     */
    var result = [];
    var map = {};
    Array.prototype.forEach.call(series || [], function (item) {
      map[item.bucket] = item;
    });

    var day = 86400000;

    for (var index = chartModeBuckets(mode) - 1; index >= 0; index--) {
      var reference = new Date(Date.now() - index * (mode === "daily" ? day : mode === "weekly" ? 7 * day : 31 * day));
      var bucket;

      if (mode === "monthly") {
        bucket = reference.getUTCFullYear() + "-" + String(reference.getUTCMonth() + 1).padStart(2, "0");
      } else if (mode === "weekly") {
        var shifted = new Date(reference.getTime() - ((reference.getUTCDay() + 1) % 7) * day);
        bucket = shifted.toISOString().slice(0, 10);
      } else {
        bucket = reference.toISOString().slice(0, 10);
      }

      var found = map[bucket];
      result.push({
        bucket: bucket,
        amount: found ? found.amount : 0,
        orders: found ? found.orders : 0
      });
    }

    return result;
  }

  function salesChartHTML(data) {
    var modes = [["daily", "روزانه"], ["weekly", "هفتگی"], ["monthly", "ماهانه"]];
    var chips = modes.map(function (mode) {
      return '<button class="fchip' + (STATE.chartMode === mode[0] ? " active" : "") +
        '" data-chartmode="' + mode[0] + '">' + mode[1] + "</button>";
    }).join("");

    return (
      '<div class="chips" style="margin-bottom:8px">' + chips + "</div>" +
      '<div class="card" style="padding:14px 10px 8px">' +
      '<div id="salesChart">' + salesChartBars(data) + "</div>" +
      "</div>"
    );
  }

  function salesChartBars(data) {
    var mode = STATE.chartMode || "daily";
    var series = (data.chart && data.chart[mode]) || [];
    var buckets = chartBucketsFor(mode, series);
    var maximum = 0;

    var total = 0;

    Array.prototype.forEach.call(buckets, function (item) {
      if (item.amount > maximum) maximum = item.amount;
      total += item.amount;
    });

    var title = mode === "daily" ? "فروش روزانه (۱۴ روز اخیر)"
      : mode === "weekly" ? "فروش هفتگی (۸ هفته اخیر)"
      : "فروش ماهانه (۶ ماه اخیر)";

    var html =
      '<div style="font-weight:700;margin:0 4px 8px">' + esc(title) +
      ' <span class="mut" style="font-weight:400">— مجموع: ' + money(total) + "</span></div>" +
      '<div class="chart" dir="ltr">';

    Array.prototype.forEach.call(buckets, function (item) {
      var height = maximum > 0 ? Math.max(2, Math.round((item.amount / maximum) * 105)) : 2;
      var label = jalaliBucketLabel(item.bucket, mode);

      html +=
        '<div class="bar-col" title="' + esc(label) + ": " + esc(money(item.amount)) +
        " (" + num(item.orders) + ' سفارش)">' +
        '<div class="bar" style="height:' + height + 'px"></div>' +
        '<div class="bar-label-wrap"><div class="bar-label">' + esc(label) + "</div></div>" +
        "</div>";
    });

    html += "</div>";
    return html;
  }

  function statCard(value, label, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="v">' + num(value) + '</div><div class="k">' + label + "</div></div>";
  }

  // ---------- orders ----------

  var ORDER_FILTERS = [
    ["all", "همه"], ["new", "جدید"], ["review", "🧾 رسید"], ["confirmed", "تأییدشده"],
    ["sent", "ارسال‌شده"], ["paid", "💳 پرداخت‌شده"], ["cancelled", "لغوشده"]
  ];

  function statusBadge(status) {
    var map = {
      new: ["y", "جدید"],
      confirmed: ["g", "تأییدشده"],
      sent: ["g", "ارسال‌شده"],
      cancelled: ["r", "لغوشده"]
    };
    var item = map[status] || ["x", status];
    return '<span class="badge ' + item[0] + '">' + item[1] + "</span>";
  }

  function payBadge(order) {
    if (order.payment_status === "paid") return '<span class="badge g">💳 پرداخت‌شده</span>';
    if (order.payment_status === "review") return '<span class="badge y">🧾 رسید در انتظار</span>';
    return '<span class="badge">پرداخت‌نشده</span>';
  }

  function gatewayName(name) {
    return name === "zibal" ? "زیبال" : name === "snapppay" ? "اسنپ‌پی" : name === "zarinpal" ? "زرین‌پال" : name;
  }

  function renderOrdersView() {
    var html = '<div class="chips">';
    ORDER_FILTERS.forEach(function (pair) {
      html +=
        '<button class="fchip' + (STATE.orders.filter === pair[0] ? " active" : "") +
        '" data-filter="' + pair[0] + '">' + pair[1] + "</button>";
    });
    html += '</div><div class="list" id="ordersList"><div class="empty">در حال دریافت…</div></div>' +
      '<div id="ordersMore"></div>';

    $("view").innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (btn) {
      btn.onclick = function () {
        haptic();
        STATE.orders.filter = btn.getAttribute("data-filter");
        STATE.orders.page = 0;
        renderOrdersView();
        loadOrders(false);
      };
    });
  }

  function loadOrders(reset) {
    var state = STATE.orders;
    if (state.loading) return;
    state.loading = true;

    api("orders?filter=" + encodeURIComponent(state.filter) + "&page=" + state.page)
      .then(function (data) {
        state.loading = false;

        if (reset || state.page === 0) state.items = [];
        state.items = state.items.concat(data.orders);
        state.hasMore = data.hasMore;

        var box = $("ordersList");
        if (!box) return;

        if (!state.items.length) {
          box.innerHTML = '<div class="empty">سفارشی در این بخش نیست.</div>';
          $("ordersMore").innerHTML = "";
          return;
        }

        box.innerHTML = state.items.map(orderCard).join("");
        Array.prototype.forEach.call(box.querySelectorAll("[data-order]"), function (el) {
          el.onclick = function () { haptic(); openOrder(el.getAttribute("data-order")); };
        });

        $("ordersMore").innerHTML = state.hasMore
          ? '<button class="btn wide" id="moreOrders">نمایش بیشتر</button>'
          : "";

        var more = $("moreOrders");
        if (more) {
          more.onclick = function () {
            state.page += 1;
            loadOrders(false);
          };
        }
      })
      .catch(function (error) {
        state.loading = false;
        toast(error.message, false);
      });
  }

  function orderCard(order) {
    var method = order.gateway
      ? "آنلاین (" + gatewayName(order.gateway) + ")"
      : order.payment_method === "card" ? "کارت‌به‌کارت" : "هماهنگی";

    return (
      '<div class="item" data-order="' + esc(order.id) + '">' +
      '<div class="dot ' + (order.status === "cancelled" ? "r" : order.payment_status === "paid" ? "g" : order.payment_status === "review" ? "y" : order.status === "new" ? "y" : "x") + '"></div>' +
      '<div class="ti"><b>' + esc(order.code) + " — " + esc(order.name) + "</b>" +
      '<span class="mut">' + money(order.total) + " · " + method + " · " + dateFa(order.created_at) + "</span></div>" +
      statusBadge(order.status) +
      "</div>"
    );
  }

  function openOrder(orderId) {
    api("order/" + encodeURIComponent(orderId)).then(function (order) {
      renderOrderSheet(order);
    }).catch(function (error) { toast(error.message, false); });
  }

  function selectionText(selection) {
    var pairs = [];
    for (var key in selection) {
      if (Object.prototype.hasOwnProperty.call(selection, key)) pairs.push(key + ": " + selection[key]);
    }
    return pairs.join(" / ");
  }

  function renderOrderSheet(order) {
    var method = order.gateway
      ? "پرداخت آنلاین (" + gatewayName(order.gateway) + ")"
      : order.payment_method === "card" ? "کارت‌به‌کارت" : "هماهنگی با مدیر";

    var html =
      "<h2>سفارش " + esc(order.code) + "</h2>" +
      '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px">' +
      statusBadge(order.status) + payBadge(order) +
      '<span class="badge">' + method + "</span></div>" +

      '<div class="card">' +
      kv("نام مشتری", order.name) +
      kv("موبایل", '<a href="tel:' + esc(order.phone) + '" style="color:var(--accent)">' + esc(order.phone) + "</a>") +
      kv("نشانی", order.address) +
      kv("کد پستی", order.postal || "—") +
      (order.note ? kv("توضیحات", order.note) : "") +
      kv("زمان ثبت", dateFa(order.created_at)) +
      (order.paid_at ? kv("تأیید پرداخت", dateFa(order.paid_at)) : "") +
      "</div>" +

      '<div class="card"><h3>🧺 اقلام</h3>' +
      order.lines.map(function (line) {
        return (
          '<div class="line"><b>' + esc(line.name) + "</b>" +
          (selectionText(line.selection) ? '<div class="mut">' + esc(selectionText(line.selection)) + "</div>" : "") +
          '<div class="row"><span class="mut">' + num(line.quantity) + " × " + money(line.price) + "</span>" +
          "<b>" + money(line.price * line.quantity) + "</b></div></div>"
        );
      }).join("") +
      '<div class="kv"><span class="k">کالاها</span><span class="v">' + money(order.subtotal) + "</span></div>" +
      '<div class="kv"><span class="k">ارسال</span><span class="v">' + money(order.shipping) + "</span></div>" +
      (order.discount ? '<div class="kv"><span class="k">تخفیف</span><span class="v errtext">-' + money(order.discount) + "</span></div>" : "") +
      '<div class="kv"><span class="k" style="font-weight:800">مبلغ نهایی</span><span class="v" style="font-weight:800;color:var(--accent)">' + money(order.total) + "</span></div>" +
      "</div>" +

      (order.receiptCount ? '<div class="card"><div class="row"><span>🧾 رسید ثبت‌شده</span><span class="badge y">' + num(order.receiptCount) + " عدد</span></div>" +
        '<div class="mut" style="margin-top:6px">نمایش تصویر رسید از پنل ربات تلگرام انجام می‌شود.</div></div>' : "") +
      '<div class="actions" id="orderActions"></div>';

    openSheet(html);

    var actions = [];

    if (["new", "confirmed"].indexOf(order.status) !== -1 && order.payment_status !== "paid") {
      actions.push({ label: "💳 تأیید دستی پرداخت", cls: "primary", run: function () {
        confirmBox("ورود این مبلغ را در حساب بانکی بررسی کرده‌اید؟", function () {
          act("order/" + order.id + "/approvepay", "POST");
        });
      }});
    }
    if (order.status === "new") {
      actions.push({ label: "✅ تأیید سفارش", cls: "primary", run: function () {
        act("order/" + order.id + "/status", "POST", { status: "confirmed" });
      }});
    }
    if (order.status === "confirmed") {
      actions.push({ label: "🚚 ثبت ارسال", cls: "primary", run: function () {
        act("order/" + order.id + "/status", "POST", { status: "sent" });
      }});
    }
    if (["new", "confirmed"].indexOf(order.status) !== -1 && order.payment_status !== "paid") {
      actions.push({ label: "❌ لغو و آزادسازی موجودی", cls: "danger", run: function () {
        confirmBox("سفارش لغو شود؟ موجودی رزروشده آزاد می‌شود.", function () {
          act("order/" + order.id + "/status", "POST", { status: "cancelled" });
        });
      }});
    }

    var wrap = $("orderActions");
    actions.forEach(function (action) {
      var btn = document.createElement("button");
      btn.className = "btn wide " + action.cls;
      btn.textContent = action.label;
      btn.onclick = action.run;
      wrap.appendChild(btn);
    });

    function act(path, method, body) {
      haptic("medium");
      api(path, method, body).then(function (updated) {
        toast("انجام شد ✅", true);
        renderOrderSheet(updated);
        STATE.orders.page = 0;
        if (STATE.view === "orders") loadOrders(false);
      }).catch(function (error) { toast(error.message, false); });
    }
  }

  function kv(key, value) {
    return '<div class="kv"><span class="k">' + key + '</span><span class="v">' + (value == null || value === "" ? "—" : value) + "</span></div>";
  }

  // ---------- products ----------

  function renderProductsView() {
    var html =
      '<div class="search"><input id="pSearch" class="in" placeholder="جست‌وجوی محصول…"></div>' +
      '<div class="chips">' +
      [["all", "همه"], ["published", "منتشرشده"], ["draft", "پیش‌نویس"]].map(function (pair) {
        return '<button class="fchip' + (STATE.products.filter === pair[0] ? " active" : "") +
          '" data-pfilter="' + pair[0] + '">' + pair[1] + "</button>";
      }).join("") +
      '</div><div class="list" id="productsList"><div class="empty">در حال دریافت…</div></div>' +
      '<div id="productsMore"></div>' +
      '<button class="fab" id="newProduct" title="محصول جدید">＋</button>';

    $("view").innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll("[data-pfilter]"), function (btn) {
      btn.onclick = function () {
        haptic();
        STATE.products.filter = btn.getAttribute("data-pfilter");
        STATE.products.page = 0;
        renderProductsView();
        loadProducts(false);
      };
    });

    var search = $("pSearch");
    var timer = null;
    search.value = STATE.products.q;
    search.oninput = function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        STATE.products.q = search.value.trim();
        STATE.products.page = 0;
        loadProducts(false);
      }, 350);
    };

    $("newProduct").onclick = function () { haptic(); openWizard(null); };

    loadProducts(false);
  }

  function loadProducts(reset) {
    var state = STATE.products;
    if (state.loading) return;
    state.loading = true;

    api("products?filter=" + encodeURIComponent(state.filter) +
        "&q=" + encodeURIComponent(state.q) + "&page=" + state.page)
      .then(function (data) {
        state.loading = false;

        if (reset || state.page === 0) state.items = [];
        state.items = state.items.concat(data.products);
        state.hasMore = data.hasMore;

        var box = $("productsList");
        if (!box) return;

        if (!state.items.length) {
          box.innerHTML = '<div class="empty">محصولی یافت نشد؛ با دکمه + اولین محصول را بسازید.</div>';
          $("productsMore").innerHTML = "";
          return;
        }

        box.innerHTML = state.items.map(productCard).join("");
        Array.prototype.forEach.call(box.querySelectorAll("[data-product]"), function (el) {
          el.onclick = function () { haptic(); openWizard(el.getAttribute("data-product")); };
        });

        $("productsMore").innerHTML = state.hasMore
          ? '<button class="btn wide" id="moreProducts">نمایش بیشتر</button>'
          : "";

        var more = $("moreProducts");
        if (more) {
          more.onclick = function () {
            state.page += 1;
            loadProducts(false);
          };
        }
      })
      .catch(function (error) {
        state.loading = false;
        toast(error.message, false);
      });
  }

  function productCard(product) {
    var thumb = product.image
      ? '<img class="thumb" src="/media/' + esc(product.image) + '" alt="">'
      : '<div class="thumb">📦</div>';

    return (
      '<div class="item" data-product="' + esc(product.id) + '">' +
      thumb +
      '<div class="ti"><b>' + esc(product.name) + "</b>" +
      '<span class="mut">' + money(product.price) + " · موجودی " + num(product.stock) + "</span></div>" +
      '<div class="dot ' + (product.published ? "g" : "y") + '"></div>' +
      "</div>"
    );
  }

  // Product wizard: 1 مشخصات / 2 موجودی / 3 تصاویر / 4 انتشار

  function openWizard(productId) {
    if (!productId) {
      STATE.wizard = {
        id: null, step: 1, published: false, images: [],
        data: { name: "", price: "", stock: "", lowStockThreshold: "", description: "", attributes: "", categoryId: "" },
        mode: "simple", optionsText: "", schema: []
      };
      fetchCategories().then(function () { renderWizard(); });
      renderWizard();
      return;
    }

    api("product/" + encodeURIComponent(productId)).then(function (product) {
      STATE.wizard = {
        id: product.id, step: 1, published: Boolean(product.published),
        images: product.images.slice(0),
        data: {
          name: product.name, price: product.price, stock: product.stock,
          lowStockThreshold: product.low_stock_threshold,
          description: product.description || "", attributes: product.attributes || "",
          categoryId: product.category_id || ""
        },
        mode: product.inventory_mode,
        optionsText: (product.option_schema || []).map(function (group) {
          return group.name + ":\n" + group.values.join("\n");
        }).join("\n\n"),
        schema: product.option_schema || [],
        variants: product.variants
      };
      fetchCategories().then(function () { renderWizard(); });
      renderWizard();
    }).catch(function (error) { toast(error.message, false); });
  }

  function fetchCategories() {
    return api("categories").then(function (data) {
      STATE.categories = data.categories;
    }).catch(function () { STATE.categories = []; });
  }

  function wizardHeader() {
    var wizard = STATE.wizard;
    return (
      "<h2>" + (wizard.id ? "ویرایش محصول" : "محصول جدید") + "</h2>" +
      '<div class="steps">' + [1, 2, 3, 4].map(function (step) {
        return '<span class="' + (step <= wizard.step ? "on" : "") + '"></span>';
      }).join("") + "</div>" +
      '<div class="mut">' +
      (wizard.step === 1 ? "گام ۱ از ۴ — مشخصات اصلی" :
       wizard.step === 2 ? "گام ۲ از ۴ — موجودی و گزینه‌ها" :
       wizard.step === 3 ? "گام ۳ از ۴ — تصاویر" :
       "گام ۴ از ۴ — بررسی و انتشار") +
      (wizard.published ? ' <span class="badge g">منتشرشده</span>' : "") +
      "</div>"
    );
  }

  function renderWizard() {
    var wizard = STATE.wizard;
    var html = wizardHeader();
    var step = wizard.step;

    if (step === 1) {
      html +=
        '<label class="fl">نام محصول *</label><input id="wName" class="in" value="' + esc(wizard.data.name) + '">' +
        '<label class="fl">قیمت (تومان) *</label><input id="wPrice" class="in" inputmode="numeric" value="' + esc(wizard.data.price) + '">' +
        '<label class="fl">دسته‌بندی</label><select id="wCategory" class="in">' +
        '<option value="">بدون دسته</option>' +
        STATE.categories.map(function (category) {
          return '<option value="' + esc(category.id) + '"' +
            (wizard.data.categoryId === category.id ? " selected" : "") + ">" +
            esc(category.name) + "</option>";
        }).join("") +
        "</select>" +
        '<label class="fl">موجودی</label><input id="wStock" class="in" inputmode="numeric" value="' + esc(wizard.data.stock) + '">' +
        '<label class="fl">آستانه هشدار موجودی (۰ خاموش)</label><input id="wThreshold" class="in" inputmode="numeric" value="' + esc(wizard.data.lowStockThreshold) + '">' +
        '<label class="fl">توضیحات</label><textarea id="wDescription" class="in">' + esc(wizard.data.description) + "</textarea>" +
        '<label class="fl">ویژگی‌های توصیفی (جنس، نگهداری و…)</label><textarea id="wAttributes" class="in">' + esc(wizard.data.attributes) + "</textarea>" +
        '<div class="actions">' +
        '<button class="btn primary wide" id="wNext">ذخیره و ادامه ›</button>' +
        (wizard.id ? '<button class="btn danger wide" id="wDelete">🗑 حذف محصول</button>' : "") +
        "</div>";
    }

    if (step === 2) {
      html +=
        '<label class="fl">حالت موجودی</label>' +
        '<div class="seg" id="wMode">' +
        '<button data-mode="simple" class="' + (wizard.mode === "simple" ? "active" : "") + '">ساده</button>' +
        '<button data-mode="shared" class="' + (wizard.mode === "shared" ? "active" : "") + '">گزینه مشترک</button>' +
        '<button data-mode="variants" class="' + (wizard.mode === "variants" ? "active" : "") + '">ترکیب‌ها</button>' +
        "</div>" +
        (wizard.mode !== "simple"
          ? '<label class="fl">گزینه‌ها — هر خط با «:» یک ویژگی است؛ خط‌های بعدی گزینه‌های همان ویژگی:</label>' +
            '<textarea id="wOptions" class="in" style="min-height:130px" placeholder="رنگ: مشکی&#10;قرمز&#10;&#10;سایز: کوچک&#10;بزرگ">' + esc(wizard.optionsText) + "</textarea>" +
            '<div class="mut">در حالت «ترکیب‌ها» هر ترکیب موجودی مستقل می‌گیرد؛ با دکمه «ویرایش موجودی هر ترکیب» موجودی هرکدام را دونه‌دونه تنظیم کنید.</div>'
          : '<div class="mut">محصول ساده موجودی مشترک ندارد؛ گزینه‌ای به مشتری نمایش داده نمی‌شود.</div>') +
        '<div class="actions">' +
        '<button class="btn primary wide" id="wNext">ذخیره و ادامه ›</button>' +
        (wizard.mode === "variants" && wizard.id && wizard.schema.length
          ? '<button class="btn wide" id="wVariants">🔢 ویرایش موجودی هر ترکیب</button>'
          : "") +
        '<button class="btn wide" id="wPrev">‹ بازگشت</button>' +
        "</div>";
    }

    if (step === 3) {
      html +=
        '<div class="mut">اولین تصویر، عکس اصلی محصول است (حداکثر ۶ تصویر).</div>' +
        '<div class="imggrid" id="wImages">' +
        wizard.images.map(function (mediaId) {
          return '<div class="imgcell"><img src="/media/' + esc(mediaId) + '" alt="">' +
            '<button class="rm" data-rm="' + esc(mediaId) + '">✕</button></div>';
        }).join("") +
        (wizard.images.length < 6
          ? '<div class="imgcell add" id="wUpload">📷<br>آپلود از دستگاه</div>' +
            '<div class="imgcell add" id="wLibrary">📚<br>از کتابخانه</div>'
          : "") +
        "</div>" +
        '<input type="file" id="wFile" accept="image/jpeg,image/png,image/webp" style="display:none">' +
        '<div id="wLibPicker"></div>' +
        '<div class="actions">' +
        '<button class="btn primary wide" id="wNext">ادامه ›</button>' +
        '<button class="btn wide" id="wPrev">‹ بازگشت</button>' +
        "</div>";
    }

    if (step === 4) {
      var variantCount = wizard.variants ? wizard.variants.filter(function (variant) { return variant.enabled; }).length : 0;
      html +=
        '<div class="card">' +
        kv("نام", esc(wizard.data.name)) +
        kv("قیمت", money(wizard.data.price)) +
        kv("موجودی", wizard.mode === "variants" ? "مستقل برای " + num(variantCount) + " ترکیب" : num(wizard.data.stock)) +
        kv("حالت", wizard.mode === "simple" ? "ساده" : wizard.mode === "shared" ? "گزینه مشترک" : "ترکیب‌ها") +
        kv("تصاویر", num(wizard.images.length)) +
        "</div>" +
        (wizard.mode !== "simple" && !wizard.schema.length
          ? '<div class="note">⚠️ حالت گزینه‌ای بدون گزینه ذخیره شده؛ ابتدا گام ۲ را کامل کنید.</div>' : "") +
        (wizard.mode === "variants" && wizard.variants && wizard.variants.length
          ? '<button class="btn wide" id="wVariants" style="margin-bottom:10px">🔢 ویرایش موجودی هر ترکیب</button>'
          : "") +
        '<div class="actions">' +
        (wizard.published
          ? '<button class="btn wide" id="wUnpublish">⛔ بازگشت به پیش‌نویس</button>'
          : '<button class="btn primary wide" id="wPublish">🚀 انتشار محصول</button>') +
        '<button class="btn wide" id="wPrev">‹ بازگشت</button>' +
        "</div>";
    }

    openSheet(html);
    bindWizard();
  }

  function bindWizard() {
    var wizard = STATE.wizard;

    var variantBtn = $("wVariants");
    if (variantBtn) {
      variantBtn.onclick = function () { haptic(); renderVariantStock(); };
    }

    function readStep1() {
      wizard.data.name = $("wName").value.trim();
      wizard.data.price = $("wPrice").value.trim();
      wizard.data.categoryId = $("wCategory").value;
      wizard.data.stock = $("wStock").value.trim();
      wizard.data.lowStockThreshold = $("wThreshold").value.trim();
      wizard.data.description = $("wDescription").value;
      wizard.data.attributes = $("wAttributes").value;
    }

    if (wizard.step === 1) {
      $("wNext").onclick = function () {
        readStep1();

        if (!wizard.data.name) return toast("نام محصول را بنویسید.", false);
        if (!/^\d+$/.test(wizard.data.price)) return toast("قیمت را عدد و بر حسب تومان وارد کنید.", false);

        var payload = {
          name: wizard.data.name,
          price: Number(wizard.data.price),
          stock: wizard.data.stock === "" ? 0 : Number(wizard.data.stock),
          lowStockThreshold: wizard.data.lowStockThreshold === "" ? 0 : Number(wizard.data.lowStockThreshold),
          description: wizard.data.description,
          attributes: wizard.data.attributes,
          categoryId: wizard.data.categoryId || null
        };

        haptic("medium");
        var request = wizard.id
          ? api("product/" + wizard.id, "POST", payload)
          : api("product", "POST", payload);

        request.then(function (result) {
          if (!wizard.id) wizard.id = result.id;
          toast("ذخیره شد ✅", true);
          wizard.step = 2;
          if (wizard.mode !== "simple" && !wizard.schema.length) {
            wizard.variants = [];
          }
          renderWizard();
        }).catch(function (error) { toast(error.message, false); });
      };

      var del = $("wDelete");
      if (del) {
        del.onclick = function () {
          confirmBox("محصول حذف شود؟ محصول دارای سابقه سفارش فقط پنهان می‌شود.", function () {
            api("product/" + wizard.id + "/delete", "POST", {}).then(function () {
              toast("حذف شد.", true);
              closeSheet();
              STATE.products.page = 0;
              loadProducts(false);
            }).catch(function (error) { toast(error.message, false); });
          });
        };
      }
    }

    if (wizard.step === 2) {
      Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (btn) {
        btn.onclick = function () {
          haptic();
          wizard.mode = btn.getAttribute("data-mode");
          renderWizard();
        };
      });

      var optionsBox = $("wOptions");
      if (optionsBox) wizard.optionsText = optionsBox.value;

      $("wNext").onclick = function () {
        var optionsText = optionsBox ? optionsBox.value : "";

        haptic("medium");
        api("product/" + wizard.id + "/options", "POST", {
          mode: wizard.mode, optionsText: optionsText
        }).then(function (product) {
          wizard.mode = product.inventory_mode;
          wizard.schema = product.option_schema;
          wizard.optionsText = (product.option_schema || []).map(function (group) {
            return group.name + ":\n" + group.values.join("\n");
          }).join("\n\n");
          wizard.variants = product.variants;
          toast("ساختار ذخیره شد؛ محصول به پیش‌نویس رفت.", true);
          wizard.step = 3;
          wizard.published = false;
          renderWizard();
        }).catch(function (error) { toast(error.message, false); });
      };

      $("wPrev").onclick = function () { wizard.step = 1; renderWizard(); };
    }

    if (wizard.step === 3) {
      Array.prototype.forEach.call(document.querySelectorAll("[data-rm]"), function (btn) {
        btn.onclick = function () {
          haptic();
          api("product/" + wizard.id + "/images-remove", "POST", { mediaId: btn.getAttribute("data-rm") })
            .then(function (product) {
              wizard.images = product.images;
              renderWizard();
            }).catch(function (error) { toast(error.message, false); });
        };
      });

      var fileInput = $("wFile");
      if ($("wUpload")) {
        $("wUpload").onclick = function () { fileInput.click(); };
        fileInput.onchange = function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 4 * 1024 * 1024) return toast("حجم تصویر حداکثر ۴ مگابایت.", false);
          toast("در حال آپلود…");
          api("media/upload", "POST", null, file).then(function (result) {
            return api("product/" + wizard.id + "/images-add", "POST", { mediaId: result.id });
          }).then(function (product) {
            wizard.images = product.images;
            toast("تصویر اضافه شد ✅", true);
            renderWizard();
          }).catch(function (error) { toast(error.message, false); });
        };
      }

      if ($("wLibrary")) {
        $("wLibrary").onclick = function () {
          api("media").then(function (data) {
            var picker = $("wLibPicker");
            if (!data.media.length) {
              picker.innerHTML = '<div class="note">کتابخانه خالی است؛ اولین تصویر را آپلود کنید.</div>';
              return;
            }
            picker.innerHTML =
              '<div class="card" style="margin-top:12px"><h3>📚 کتابخانه تصاویر</h3><div class="imggrid">' +
              data.media.map(function (media) {
                return '<div class="imgcell" style="cursor:pointer" data-lib="' + esc(media.id) + '"><img src="/media/' + esc(media.id) + '" alt=""></div>';
              }).join("") + "</div></div>";

            Array.prototype.forEach.call(picker.querySelectorAll("[data-lib]"), function (cell) {
              cell.onclick = function () {
                haptic();
                api("product/" + wizard.id + "/images-add", "POST", { mediaId: cell.getAttribute("data-lib") })
                  .then(function (product) {
                    wizard.images = product.images;
                    renderWizard();
                  }).catch(function (error) { toast(error.message, false); });
              };
            });
          }).catch(function (error) { toast(error.message, false); });
        };
      }

      $("wNext").onclick = function () { wizard.step = 4; renderWizard(); };
      $("wPrev").onclick = function () { wizard.step = 2; renderWizard(); };
    }

    if (wizard.step === 4) {
      var publish = $("wPublish");
      if (publish) {
        publish.onclick = function () {
          haptic("medium");
          api("product/" + wizard.id + "/publish", "POST", { published: true })
            .then(function () {
              wizard.published = true;
              toast("محصول منتشر شد 🎉", true);
              renderWizard();
              STATE.products.page = 0;
            }).catch(function (error) { toast(error.message, false); });
        };
      }

      var unpublish = $("wUnpublish");
      if (unpublish) {
        unpublish.onclick = function () {
          haptic("medium");
          api("product/" + wizard.id + "/publish", "POST", { published: false })
            .then(function () {
              wizard.published = false;
              toast("به پیش‌نویس رفت.", true);
              renderWizard();
            }).catch(function (error) { toast(error.message, false); });
        };
      }

      $("wPrev").onclick = function () { wizard.step = 3; renderWizard(); };
    }
  }

  /*
   * Per-variant stock editor (dono-dono). Rendered as a wizard sub-view
   * inside the same sheet; the back button re-opens the wizard step.
   */
  function renderVariantStock() {
    var wizard = STATE.wizard;

    api("product/" + encodeURIComponent(wizard.id)).then(function (product) {
      wizard.variants = product.variants || [];

      var enabled = wizard.variants.filter(function (variant) { return variant.enabled; });
      var html = "<h2>موجودی ترکیب‌ها</h2>" +
        '<div class="mut">موجودی هر ترکیب را جدا وارد کنید و یک‌بار ذخیره بزنید. ترکیب‌های غیرفعال نمایش داده نمی‌شوند.</div>';

      if (!enabled.length) {
        html += '<div class="note">هیچ ترکیب فعالی وجود ندارد؛ ابتدا گام ۲ (گزینه‌ها) را کامل کنید.</div>';
      } else {
        html += '<div id="variantStockList">' +
          enabled.map(function (variant) {
            var label = variant.options
              ? Object.keys(variant.options).sort().map(function (key) {
                  return key + ": " + variant.options[key];
                }).join(" · ")
              : "ترکیب";

            return '<div class="card" style="padding:10px 12px;margin-top:10px">' +
              '<div class="mut" style="font-size:.78rem">' + esc(label) + "</div>" +
              '<div class="row" style="gap:8px;margin-top:6px">' +
              '<span class="mut" style="flex:none">موجودی:</span>' +
              '<input class="in" style="flex:1" inputmode="numeric" data-vstock="' +
              esc(variant.id) + '" value="' + num(variant.stock) + '">' +
              "</div></div>";
          }).join("") + "</div>" +
          '<div class="actions">' +
          '<button class="btn primary wide" id="vStockSave">💾 ذخیره موجودی‌ها</button>' +
          '<button class="btn wide" id="vStockBack">‹ بازگشت به ویرایش محصول</button>' +
          "</div>";
      }

      openSheet(html);

      var back = $("vStockBack");
      if (back) back.onclick = function () { haptic(); renderWizard(); };

      var save = $("vStockSave");
      if (save) {
        save.onclick = function () {
          var stocks = [];
          var bad = false;

          Array.prototype.forEach.call(document.querySelectorAll("[data-vstock]"), function (input) {
            if (bad) return;
            var value = String(input.value || "").trim()
              .replace(/[۰-۹]/g, function (ch) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(ch); })
              .replace(/[٠-٩]/g, function (ch) { return "٠١٢٣٤٥٦٧٨٩".indexOf(ch); });

            if (!/^\d+$/.test(value)) { bad = true; return; }
            stocks.push({ id: input.getAttribute("data-vstock"), stock: Number(value) });
          });

          if (bad) return toast("موجودی هر ترکیب باید عددی بین ۰ تا ۱۰۰۰۰۰۰۰۰۰ باشد.", false);
          if (!stocks.length) return toast("ترکیبی برای ذخیره پیدا نشد.", false);

          haptic("medium");
          api("product/" + wizard.id + "/variant-stock", "POST", { stocks: stocks })
            .then(function (updated) {
              wizard.variants = updated.variants || wizard.variants;
              toast("موجودی ترکیب‌ها ذخیره شد ✅", true);
              renderVariantStock();
            })
            .catch(function (error) { toast(error.message, false); });
        };
      }
    }).catch(function (error) { toast(error.message, false); });
  }

  // ---------- logs (owner-only) ----------

  var LOG_SECTION_NAMES = {
    catalog: "محصولات و محتوا",
    orders: "سفارش‌ها",
    users: "کاربران",
    security: "امنیت و مدیران",
    system: "سیستم و تنظیمات"
  };

  function renderLogsView() {
    STATE.logs = { admin: "", section: "catalog", page: 0, items: [], hasMore: false, loading: false };

    var sectionChips = Object.keys(LOG_SECTION_NAMES).map(function (key) {
      return '<button class="fchip" data-lsec="' + key + '">' + esc(LOG_SECTION_NAMES[key]) + "</button>";
    }).join("");

    $("view").innerHTML =
      '<div class="card"><h3>🕵️ گزارش فعالیت مدیران</h3>' +
      '<div class="mut">هر تغییری که مدیران در بخش‌های مختلف می‌دهند اینجا ثبت می‌شود؛ رویدادها پس از مدت نگهداری تعیین‌شده پاک می‌شوند.</div></div>' +
      '<div class="chips" id="logSections">' + sectionChips + "</div>" +
      '<div class="card" id="logAdminPicker"><div class="mut">در حال دریافت مدیران…</div></div>' +
      '<div class="list" id="logList"><div class="empty">ابتدا یک مدیر را انتخاب کنید.</div></div>' +
      '<div id="logsMore"></div>';

    syncLogSectionChips();

    Array.prototype.forEach.call(document.querySelectorAll("[data-lsec]"), function (btn) {
      btn.onclick = function () {
        haptic();
        STATE.logs.section = btn.getAttribute("data-lsec");
        STATE.logs.page = 0;
        STATE.logs.items = [];
        syncLogSectionChips();
        $("logList").innerHTML = '<div class="empty">ابتدا یک مدیر را انتخاب کنید.</div>';
        $("logsMore").innerHTML = "";
      };
    });

    api("admins").then(function (data) {
      renderLogAdminPicker(data.admins || []);
    }).catch(function (error) {
      var box = $("logAdminPicker");
      if (box) box.innerHTML = '<div class="mut">' + esc(error.message) + "</div>";
    });
  }

  function syncLogSectionChips() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-lsec]"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-lsec") === STATE.logs.section);
    });
  }

  function renderLogAdminPicker(admins) {
    var box = $("logAdminPicker");
    if (!box) return;

    if (!admins.length) {
      box.innerHTML = '<div class="mut">مدیری ثبت نشده است.</div>';
      return;
    }

    box.innerHTML =
      '<div class="mut" style="margin-bottom:7px">انتخاب مدیر:</div><div class="chips">' +
      admins.map(function (admin) {
        return '<button class="fchip" data-ladmin="' + esc(admin.id) + '">' +
          (admin.isOwner ? "👑 " : "👤 ") +
          (admin.name ? esc(admin.name) + " (" + esc(admin.id) + ")" : esc(admin.id)) + "</button>";
      }).join("") + "</div>";

    Array.prototype.forEach.call(box.querySelectorAll("[data-ladmin]"), function (btn) {
      btn.onclick = function () {
        haptic();
        STATE.logs.admin = btn.getAttribute("data-ladmin");
        STATE.logs.page = 0;
        STATE.logs.items = [];
        syncLogAdminChips();
        loadLogs();
      };
    });

    syncLogAdminChips();
  }

  function syncLogAdminChips() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-ladmin]"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-ladmin") === STATE.logs.admin);
    });
  }

  function loadLogs() {
    var state = STATE.logs;

    if (!state.admin || state.loading) return;
    state.loading = true;

    var box = $("logList");
    if (box) box.innerHTML = '<div class="empty">در حال دریافت…</div>';

    api("logs?section=" + state.section +
        "&admin=" + encodeURIComponent(state.admin) +
        "&page=" + state.page)
      .then(function (data) {
        state.loading = false;

        if (state.page === 0) state.items = [];
        state.items = state.items.concat(data.events || []);
        state.hasMore = Boolean(data.hasMore);
        renderLogsList();
      })
      .catch(function (error) {
        state.loading = false;
        var list = $("logList");
        if (list) list.innerHTML = '<div class="empty errtext">' + esc(error.message) + "</div>";
      });
  }

  function renderLogsList() {
    var state = STATE.logs;
    var box = $("logList");
    if (!box) return;

    if (!state.items.length) {
      box.innerHTML = '<div class="empty">برای این مدیر در بخش «' +
        (LOG_SECTION_NAMES[state.section] || state.section) + '» رویدادی ثبت نشده است.</div>';
      $("logsMore").innerHTML = "";
      return;
    }

    box.innerHTML = state.items.map(function (event) {
      return (
        '<div class="item"><div class="thumb">📝</div>' +
        '<div class="ti"><b>' + esc(event.action || "تغییر") + "</b>" +
        (event.target ? '<span class="mut">' + esc(event.target) + "</span>" : "") +
        (event.detail ? '<span class="mut">' + esc(event.detail) + "</span>" : "") +
        '<span class="mut" style="font-size:.68rem">' + dateFa(event.created_at) + "</span></div></div>"
      );
    }).join("");

    $("logsMore").innerHTML = state.hasMore
      ? '<button class="btn wide" id="moreLogs">نمایش بیشتر</button>'
      : "";

    var more = $("moreLogs");
    if (more) {
      more.onclick = function () {
        state.page += 1;
        loadLogs();
      };
    }
  }

  // ---------- users (permission: users) ----------

  function renderUsersView() {
    $("view").innerHTML =
      '<div class="card"><div style="display:flex;gap:8px">' +
      '<input id="userSearch" class="in" placeholder="جستجوی شماره یا نام…" style="flex:1">' +
      '<button class="btn" id="userSearchGo">جستجو</button>' +
      "</div></div>" +
      '<div class="list" id="usersList"><div class="empty">در حال دریافت…</div></div>' +
      '<div id="usersMore"></div>';

    $("userSearchGo").onclick = function () {
      haptic();
      STATE.users.q = $("userSearch").value.trim();
      STATE.users.page = 0;
      loadUsers(false);
    };

    $("userSearch").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        STATE.users.q = $("userSearch").value.trim();
        STATE.users.page = 0;
        loadUsers(false);
      }
    });
  }

  function loadUsers(reset) {
    var state = STATE.users;

    if (state.loading) return;
    state.loading = true;

    var box = $("usersList");
    if (box && reset) box.innerHTML = '<div class="empty">در حال دریافت…</div>';

    api("users?page=" + state.page +
        (state.q ? "&q=" + encodeURIComponent(state.q) : ""))
      .then(function (data) {
        state.loading = false;

        if (!state.page) state.items = [];
        state.items = state.items.concat(data.users || []);
        state.hasMore = Boolean(data.hasMore);
        renderUsersList();
      })
      .catch(function (error) {
        state.loading = false;
        var list = $("usersList");
        if (list) list.innerHTML = '<div class="empty errtext">' + esc(error.message) + "</div>";
      });
  }

  function renderUsersList() {
    var state = STATE.users;
    var box = $("usersList");
    if (!box) return;

    if (!state.items.length) {
      box.innerHTML = '<div class="empty">کاربری پیدا نشد.</div>';
      $("usersMore").innerHTML = "";
      return;
    }

    box.innerHTML = state.items.map(function (user) {
      return (
        '<div class="item" data-user="' + esc(user.id) + '">' +
        '<div class="thumb">' + (user.blocked ? "🚫" : "🧑‍💻") + "</div>" +
        '<div class="ti"><b>' + (user.name ? esc(user.name) : esc(user.phone)) + "</b>" +
        (user.blocked ? ' <span class="pill" style="background:rgba(255,139,139,.18)">مسدود</span>' : "") +
        '<span class="mut">' + esc(user.phone) + " — " +
        num(user.ordersCount) + " سفارش — " + money(user.paidTotal) + "</span>" +
        "</div>" +
        '<div class="dot ' + (user.blocked ? "x" : "g") + '"></div>' +
        "</div>"
      );
    }).join("");

    $("usersMore").innerHTML = state.hasMore
      ? '<button class="btn wide" id="moreUsers">نمایش بیشتر</button>'
      : "";

    var more = $("moreUsers");
    if (more) {
      more.onclick = function () {
        state.page += 1;
        loadUsers(false);
      };
    }

    Array.prototype.forEach.call(box.querySelectorAll("[data-user]"), function (el) {
      el.onclick = function () {
        haptic();
        openUser(el.getAttribute("data-user"));
      };
    });
  }

  function openUser(userId) {
    api("users/" + encodeURIComponent(userId) + "/orders")
      .then(function (data) {
        var user = data.user || {};
        var orders = data.orders || [];

        var html =
          '<h3 style="margin:0 0 6px">' + (user.name ? esc(user.name) + " — " : "") + esc(user.phone) + "</h3>" +
          '<div class="mut">عضویت: ' + dateFa(user.createdAt) +
          (user.blocked ? " — <b class='errtext'>مسدود</b>" : "") + "</div>" +
          '<div style="display:flex;gap:8px;margin:12px 0">' +
          '<button class="btn" id="uBlock">' + (user.blocked ? "آزادسازی" : "مسدودسازی") + "</button>" +
          '<button class="btn" id="uDelete" style="color:var(--danger)">حذف کاربر</button>' +
          "</div>" +
          "<h4 style='margin:10px 0 4px'>سفارش‌ها</h4>";

        html += orders.length
          ? orders.map(function (order) {
              return (
                '<div class="item"><div class="thumb">📦</div>' +
                '<div class="ti"><b>' + esc(order.code) + "</b>" +
                "<span class='mut'>" + esc(orderStatusLabel(order.status)) + " — " +
                money(order.total) + " — " + dateFa(order.createdAt) + "</span></div></div>"
              );
            }).join("")
          : '<div class="empty">سفارشی ثبت نشده است.</div>';

        openSheet(html);

        $("uBlock").onclick = function () {
          haptic();
          var op = user.blocked ? "unblock" : "block";

          api("users/" + encodeURIComponent(userId) + "/action", "POST", { op: op })
            .then(function () {
              toast(op === "block" ? "کاربر مسدود شد." : "کاربر آزاد شد.", true);
              closeSheet();
              STATE.users.page = 0;
              loadUsers(true);
            })
            .catch(function (error) { toast(error.message, false); });
        };

        $("uDelete").onclick = function () {
          haptic();
          confirmBox("کاربر و دسترسی او حذف شود؟ سفارش‌های قبلی حفظ می‌شوند.", function () {
            api("users/" + encodeURIComponent(userId) + "/action", "POST", { op: "delete" })
              .then(function () {
                toast("کاربر حذف شد.", true);
                closeSheet();
                STATE.users.page = 0;
                STATE.users.q = "";
                loadUsers(true);
              })
              .catch(function (error) { toast(error.message, false); });
          });
        };
      })
      .catch(function (error) { toast(error.message, false); });
  }

  function orderStatusLabel(status) {
    return {
      new: "جدید",
      confirmed: "تأییدشده",
      sent: "ارسال‌شده",
      cancelled: "لغوشده"
    }[status] || status;
  }

  // ---------- admins ----------

  function loadAdmins() {
    api("admins").then(function (data) {
      STATE.admins = data.admins;
      STATE.permissionDefs = data.permissionDefs;
      renderAdmins();
    }).catch(function (error) {
      $("view").innerHTML = '<div class="empty errtext">' + esc(error.message) + "</div>";
    });
  }

  function renderAdminsView() {
    $("view").innerHTML =
      '<div id="adminsList"><div class="empty">در حال دریافت…</div></div>' +
      '<button class="fab" id="newAdmin" title="افزودن مدیر">＋</button>';

    $("newAdmin").onclick = function () { haptic(); openAdminEditor(null); };
  }

  function renderAdmins() {
    var box = $("adminsList");
    if (!box) return;

    if (!STATE.admins.length) {
      box.innerHTML = '<div class="empty">مدیری ثبت نشده است.</div>';
      return;
    }

    box.innerHTML = STATE.admins.map(function (admin) {
      var roleText = admin.isOwner
        ? "مدیر اصلی"
        : admin.role === "custom"
          ? "دسترسی سفارشی (" + num(admin.perms.length) + " بخش)"
          : admin.role === "operator" ? "اپراتور سفارش" : "مدیر";

      return (
        '<div class="item" data-admin="' + esc(admin.id) + '">' +
        '<div class="thumb">' + (admin.isOwner ? "👑" : "👤") + "</div>" +
        '<div class="ti"><b>' +
        (admin.name ? esc(admin.name) + " <span class='mut' style='font-weight:400'>(" + esc(admin.id) + ")</span>" : esc(admin.id)) +
        (admin.isYou ? ' <span class="pill">شما</span>' : "") + "</b>" +
        '<span class="mut">' + roleText + "</span></div>" +
        '<div class="dot ' + (admin.isOwner ? "g" : "x") + '"></div>' +
        "</div>"
      );
    }).join("");

    Array.prototype.forEach.call(box.querySelectorAll("[data-admin]"), function (el) {
      el.onclick = function () { haptic(); openAdminEditor(el.getAttribute("data-admin")); };
    });
  }

  function openAdminEditor(targetId) {
    var target = targetId
      ? STATE.admins.filter(function (admin) { return admin.id === String(targetId); })[0]
      : null;

    var isOwner = STATE.me.isOwner;
    var html = "<h2>" + (target ? "دسترسی‌های " + esc(target.id) : "افزودن مدیر") + "</h2>";

    if (target && target.isOwner) {
      html +=
        '<div class="card"><div class="row"><span>👑 مدیر اصلی</span><span class="badge g">دسترسی کامل و ثابت</span></div>' +
        '<div class="mut" style="margin-top:8px">دسترسی مدیر اصلی قابل تغییر نیست.' +
        (isOwner ? " حذف از فهرست پایین انجام می‌شود." : "") + "</div></div>" +
        '<div class="actions" id="adminActions"></div>';
      openSheet(html);
      bindAdminEditor(target, html, isOwner);
      return;
    }

    var perms = target ? target.perms.slice(0) : ["orders"];

    html +=
      (target ? "" : '<label class="fl">شناسه عددی تلگرام مدیر جدید *</label><input id="aId" class="in" inputmode="numeric" placeholder="مثلاً ۱۲۳۴۵۶۷۸۹">') +
      '<label class="fl">سطح آماده</label><div class="seg" id="aPresets"></div>' +
      '<label class="fl">بخش‌های مجاز (لمس کنید)</label><div class="permgrid" id="aPerms"></div>' +
      (target && isOwner
        ? '<div class="actions"><button class="btn danger wide" id="aDelete">🗑 حذف این مدیر</button></div>'
        : "") +
      '<div class="actions"><button class="btn primary wide" id="aSave">💾 ذخیره دسترسی‌ها</button></div>' +
      '<div class="note">هر مدیر فقط می‌تواند دسترسی‌هایی بدهد که خودش دارد. ' +
      "حذف مدیران فقط توسط مدیر اصلی انجام می‌شود.</div>";

    openSheet(html);
    bindAdminEditor(target, perms, isOwner);
  }

  function bindAdminEditor(target, perms, isOwner) {
    // Read-only owner card
    if (target && target.isOwner) {
      var actions = $("adminActions");
      if (isOwner) {
        var del = document.createElement("button");
        del.className = "btn danger wide";
        del.textContent = "🗑 حذف این مدیر";
        del.onclick = function () {
          confirmBox("دسترسی این مدیر اصلی حذف شود؟ (آخرین مدیر اصلی قابل حذف نیست)", function () {
            api("admins/delete", "POST", { id: target.id }).then(function () {
              toast("حذف شد.", true);
              closeSheet();
              loadAdmins();
            }).catch(function (error) { toast(error.message, false); });
          });
        };
        actions.appendChild(del);
      }
      return;
    }

    var current = perms.slice(0);

    function renderPermGrid() {
      var grid = $("aPerms");
      grid.innerHTML = STATE.permissionDefs.map(function (def) {
        var locked = !isOwner && STATE.me.perms.indexOf(def.key) === -1;
        var on = current.indexOf(def.key) !== -1;
        return (
          '<div class="perm' + (on ? " on" : "") + (locked ? " lock" : "") + '" data-perm="' + def.key + '">' +
          '<span class="box">✓</span>' + def.label +
          (locked ? " 🔒" : "") + "</div>"
        );
      }).join("");

      Array.prototype.forEach.call(grid.querySelectorAll("[data-perm]"), function (cell) {
        cell.onclick = function () {
          haptic();
          var key = cell.getAttribute("data-perm");
          var index = current.indexOf(key);
          if (index === -1) current.push(key);
          else current.splice(index, 1);
          renderPermGrid();
        };
      });
    }

    var presets = [
      ["مدیر اصلی", "owner", isOwner],
      ["مدیر", "admin", isOwner || ["products", "orders", "gateway", "settings"].every(function (key) { return STATE.me.perms.indexOf(key) !== -1; })],
      ["اپراتور", "operator", isOwner || STATE.me.perms.indexOf("orders") !== -1],
      ["فقط محصولات", "products", isOwner || STATE.me.perms.indexOf("products") !== -1],
      ["فقط سفارش", "orders", true]
    ];

    var presetWrap = $("aPresets");
    presets.forEach(function (preset) {
      if (!preset[2]) return;
      var btn = document.createElement("button");
      btn.textContent = preset[0];
      btn.onclick = function () {
        haptic();
        current = preset[1] === "owner"
          ? STATE.permissionDefs.map(function (def) { return def.key; })
          : preset[1] === "admin"
            ? STATE.permissionDefs.map(function (def) { return def.key; }).filter(function (key) { return key !== "admins"; })
            : preset[1] === "operator"
              ? ["orders"]
              : [preset[1]];
        renderPermGrid();
      };
      presetWrap.appendChild(btn);
    });

    renderPermGrid();

    $("aSave").onclick = function () {
      var id = target ? target.id : ($("aId") ? $("aId").value.trim() : "");

      if (!/^[1-9]\d{0,19}$/.test(id)) return toast("شناسه عددی معتبر وارد کنید.", false);
      if (!current.length && !confirmBox) return;

      haptic("medium");
      api("admins", "POST", { id: id, permissions: current }).then(function () {
        toast("دسترسی‌ها ذخیره شد ✅", true);
        closeSheet();
        loadAdmins();
      }).catch(function (error) { toast(error.message, false); });
    };

    var delBtn = $("aDelete");
    if (delBtn) {
      delBtn.onclick = function () {
        confirmBox("دسترسی این مدیر حذف شود؟", function () {
          api("admins/delete", "POST", { id: target.id }).then(function () {
            toast("حذف شد.", true);
            closeSheet();
            loadAdmins();
          }).catch(function (error) { toast(error.message, false); });
        });
      };
    }
  }

  // ---------- settings ----------

  function renderSettingsView() {
    $("view").innerHTML = '<div class="empty">در حال دریافت…</div>';

    api("settings").then(function (data) {
      STATE.settings = data.settings;
      drawSettings();
    }).catch(function (error) {
      $("view").innerHTML = '<div class="empty errtext">' + esc(error.message) + "</div>";
    });
  }

  function loadSmsCard() {
    api("sms-settings").then(function (data) {
      drawSmsCard(data);
    }).catch(function (error) {
      var box = $("smsCard");
      if (box) box.innerHTML = '<h3>💬 پیامک کد تایید ورود</h3><div class="errtext">' + esc(error.message) + "</div>";
    });
  }

  function drawSmsCard(data) {
    var box = $("smsCard");
    if (!box) return;

    box.innerHTML =
      '<h3>💬 پیامک کد تایید ورود</h3>' +
      '<div class="mut">کد ورود مشتریان با قالب Verify سرویس انتخابی ارسال می‌شود.</div>' +
      '<label class="fl">سرویس پیامک</label><div class="seg" id="smsProv">' +
      data.providers.map(function (provider) {
        return '<button data-smsprov="' + provider.key + '" class="' +
          (data.provider === provider.key ? "active" : "") + '">' + esc(provider.label) + "</button>";
      }).join("") + "</div>" +
      '<label class="fl">کلید API' + (data.apiKeyTouched ? " — ثبت‌شده ✅" : "") + "</label>" +
      '<input id="smsKey" class="in" placeholder="' + esc(data.apiKeyMasked || "کلید API سرویس") + '">' +
      '<label class="fl">قالب کد تایید' + (data.provider === "smsir" ? " (شناسه عددی TemplateId)" : " (نام قالب، متغیر %token)") + "</label>" +
      '<input id="smsTemplate" class="in" value="' + esc(data.template) + '">' +
      '<button class="btn primary wide" id="smsSave" style="margin-top:12px">💾 ذخیره تنظیمات پیامک</button>' +
      '<div class="note">نکته امنیتی: کلید API فقط در سرور ذخیره می‌شود و هرگز به مرورگر مشتریان فرستاده نمی‌شود.</div>';

    Array.prototype.forEach.call(box.querySelectorAll("[data-smsprov]"), function (btn) {
      btn.onclick = function () {
        haptic();
        api("sms-settings", "POST", { provider: btn.getAttribute("data-smsprov") })
          .then(function (result) { drawSmsCard(result); toast("سرویس پیامک ثبت شد ✅", true); })
          .catch(function (error) { toast(error.message, false); });
      };
    });

    $("smsSave").onclick = function () {
      haptic("medium");
      var payload = {};

      var keyInput = $("smsKey");
      if (keyInput && keyInput.value.trim()) payload.apiKey = keyInput.value.trim();

      payload.template = $("smsTemplate").value;

      api("sms-settings", "POST", payload)
        .then(function (result) {
          drawSmsCard(result);
          toast("تنظیمات پیامک ذخیره شد ✅", true);
        })
        .catch(function (error) { toast(error.message, false); });
    };
  }

  function drawSettings() {
    var settings = STATE.settings;
    var html = "";

    if (hasPerm("gateway")) {
      html +=
        '<div class="card"><h3>🏦 درگاه پرداخت آنلاین</h3>' +
        '<div class="row"><span class="mut">وضعیت</span>' +
        '<span class="badge ' + (settings.payment_gateway_enabled ? "g" : "") + '">' +
        (settings.payment_gateway_enabled ? "فعال ✅" : "غیرفعال ⛔") + "</span></div>" +
        '<div class="actions">' +
        '<button class="btn wide" id="gToggle">' + (settings.payment_gateway_enabled ? "⛔ غیرفعال کردن" : "✅ فعال کردن") + "</button>" +
        "</div>" +
        '<label class="fl">انتخاب درگاه</label><div class="seg" id="gPick">' +
        [["zarinpal", "زرین‌پال"], ["zibal", "زیبال"], ["snapppay", "اسنپ‌پی"]].map(function (pair) {
          return '<button data-gw="' + pair[0] + '" class="' + (settings.payment_gateway === pair[0] ? "active" : "") + '">' + pair[1] + "</button>";
        }).join("") + "</div>" +
        '<label class="fl">کد پذیرنده (زرین‌پال / زیبال)' +
        (settings.payment_gateway_merchant ? ' — ثبت‌شده ✅' : "") + '</label>' +
        '<input id="gMerchant" class="in" inputmode="text" placeholder="' + esc(settings.payment_gateway_merchant || "کد پذیرنده") + '">' +
        '<button class="btn sm wide" id="gMerchantSave" style="margin-top:8px">ذخیره کد پذیرنده</button>' +
        "</div>";

      {
        html +=
          '<div class="card"><h3>🔐 اطلاعات اسنپ‌پی</h3>' +
          '<div class="mut">چهار مقدار زیر را از پشتیبانی اسنپ‌پی دریافت می‌کنید. مقادیر ثبت‌شده مخفی نمایش داده می‌شوند؛ برای تغییر، مقدار جدید را بنویسید و ذخیره کنید.</div>' +
          snappField("username", "نام کاربری", settings.snapppay_username, settings.snapppay_touched.username) +
          snappField("password", "رمز عبور", settings.snapppay_password, settings.snapppay_touched.password) +
          snappField("client_id", "شناسه کلاینت", settings.snapppay_client_id, settings.snapppay_touched.client_id) +
          snappField("client_secret", "کلید مخفی", settings.snapppay_client_secret, settings.snapppay_touched.client_secret) +
          '<label class="fl">آدرس پایه API (خالی = پیش‌فرض)</label>' +
          '<input id="s_baseurl" class="in" placeholder="' + esc(settings.snapppay_base_url || "https://api.snapp-pay.ir") + '">' +
          '<button class="btn primary wide" id="sSnapSave" style="margin-top:12px">💾 ذخیره اطلاعات اسنپ‌پی</button>' +
          '<div class="row" style="margin-top:14px"><span class="mut">حالت آزمایشی (سرور تست)</span>' +
          '<button class="btn sm" id="gSandbox">' + (settings.payment_gateway_sandbox ? "🧪 روشن" : "خاموش") + "</button></div>" +
          '<div class="note">آدرس بازگشت پرداخت: ' + esc(settings.site_url ? settings.site_url.replace(/\/+$/, "") + "/pay/callback" : "پس از تنظیم آدرس سایت") +
          "<br>وضعیت اعتبارنامه اسنپ‌پی: " + (settings.snapppay_complete ? '<b class="oktext">کامل ✅</b>' : '<b class="errtext">ناقص ⛔</b>') + "</div></div>";
      }
    }

    if (hasPerm("settings")) {
      html +=
        '<div class="card"><h3>🏪 فروشگاه</h3>' +
        '<label class="fl">نام فروشگاه</label><input id="tName" class="in" value="' + esc(settings.store_name) + '">' +
        '<label class="fl">شعار</label><input id="tTagline" class="in" value="' + esc(settings.tagline) + '">' +
        '<label class="fl">هزینه ارسال (تومان)</label><input id="tShip" class="in" inputmode="numeric" value="' + esc(settings.shipping_fee) + '">' +
        '<label class="fl">ارسال رایگان از مبلغ (۰ خاموش)</label><input id="tFree" class="in" inputmode="numeric" value="' + esc(settings.free_shipping_over) + '">' +
        '<button class="btn primary wide" id="tSave" style="margin-top:12px">💾 ذخیره تنظیمات فروشگاه</button>' +
        "</div>" +
        '<div class="note">بقیه تنظیمات (اسلایدر، دسته‌بندی، رنگ، Turnstile و…) از پنل ربات قابل مدیریت است: در ربات /start بزنید.</div>';
    }

    if (hasPerm("sms")) {
      html += '<div class="card" id="smsCard"><h3>💬 پیامک کد تایید ورود</h3><div class="mut">در حال دریافت…</div></div>';
    }

    $("view").innerHTML = html;

    if (hasPerm("sms")) loadSmsCard();

    if (hasPerm("gateway")) {
      $("gToggle").onclick = function () {
        haptic("medium");
        confirmBox(settings.payment_gateway_enabled
          ? "درگاه پرداخت غیرفعال شود؟"
          : "درگاه پرداخت فعال شود؟", function () {
          api("gateway", "POST", { action: "toggle" }).then(function (result) {
            STATE.settings = result.settings;
            toast("انجام شد ✅", true);
            drawSettings();
          }).catch(function (error) { toast(error.message, false); });
        });
      };

      Array.prototype.forEach.call(document.querySelectorAll("[data-gw]"), function (btn) {
        btn.onclick = function () {
          haptic();
          api("gateway", "POST", { action: "pick", value: btn.getAttribute("data-gw") })
            .then(function (result) {
              STATE.settings = result.settings;
              toast("درگاه انتخاب شد ✅", true);
              drawSettings();
            }).catch(function (error) { toast(error.message, false); });
        };
      });

      $("gMerchantSave").onclick = function () {
        api("settings", "POST", { key: "payment_gateway_merchant", value: $("gMerchant").value })
          .then(function () { toast("ذخیره شد ✅", true); renderSettingsView(); })
          .catch(function (error) { toast(error.message, false); });
      };

      $("gSandbox").onclick = function () {
        haptic();
        api("gateway", "POST", { action: "sandbox" }).then(function (result) {
          STATE.settings = result.settings;
          toast("انجام شد ✅", true);
          drawSettings();
        }).catch(function (error) { toast(error.message, false); });
      };

      $("sSnapSave").onclick = function () {
        haptic("medium");
        var fields = ["username", "password", "client_id", "client_secret", "baseurl"];
        var map = {
          username: "s_username", password: "s_password",
          client_id: "s_client_id", client_secret: "s_client_secret",
          baseurl: "s_baseurl"
        };
        var keys = {
          username: "snapppay_username", password: "snapppay_password",
          client_id: "snapppay_client_id", client_secret: "snapppay_client_secret",
          baseurl: "snapppay_base_url"
        };

        var chain = Promise.resolve();
        fields.forEach(function (field) {
          var input = $(map[field]);
          if (!input || !input.value.trim()) return;
          chain = chain.then(function () {
            return api("settings", "POST", { key: keys[field], value: input.value });
          });
        });

        chain.then(function () {
          toast("اطلاعات اسنپ‌پی ذخیره شد ✅", true);
          renderSettingsView();
        }).catch(function (error) { toast(error.message, false); });
      };
    }

    if (hasPerm("settings")) {
      $("tSave").onclick = function () {
        haptic("medium");
        var chain = Promise.resolve();

        chain = chain.then(function () {
          return api("settings", "POST", { key: "store_name", value: $("tName").value });
        });
        chain = chain.then(function () {
          return api("settings", "POST", { key: "tagline", value: $("tTagline").value });
        });
        chain = chain.then(function () {
          return api("settings", "POST", { key: "shipping_fee", value: $("tShip").value });
        });
        chain = chain.then(function () {
          return api("settings", "POST", { key: "free_shipping_over", value: $("tFree").value });
        });

        chain.then(function () {
          toast("ذخیره شد ✅", true);
          renderSettingsView();
        }).catch(function (error) { toast(error.message, false); });
      };
    }
  }

  function snappField(key, label, masked, touched) {
    return (
      '<label class="fl">' + label + (touched ? ' — <span class="oktext">ثبت‌شده ✅</span>' : "") + "</label>" +
      '<input id="s_' + key + '" class="in" placeholder="' + (masked ? esc(masked) : "وارد کنید") + '">'
    );
  }

  // ---------- boot ----------

  function boot() {
    if (!HAS_TG) {
      $("lock").hidden = false;
      return;
    }

    try { tg.expand(); } catch (e) {}
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
    try {
      if (tg.setHeaderColor) tg.setHeaderColor("bg_color");
    } catch (e) {}
    try {
      if (tg.colorScheme === "light") document.body.classList.add("light");
    } catch (e) {}

    if (tg.BackButton) {
      tg.BackButton.onClick(function () {
        if (sheetOpen()) { closeSheet(); return; }
        if (STATE.view !== "home") { navigate("home"); return; }
      });
    }

    $("sheetBackdrop").onclick = closeSheet;
    $("refreshBtn").onclick = function () { haptic(); boot(true); };

    api("me").then(function (data) {
      STATE.me = data.admin;
      STATE.permissions = data.permissions;
      STATE.storeName = data.store.name;

      renderTabs();
      navigate("home");

      // Deep link from order notifications: /miniapp?order=<id>
      var params = new URLSearchParams(location.search);
      var orderId = params.get("order") || "";

      if (!orderId && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
        var startParam = String(tg.initDataUnsafe.start_param);
        if (startParam.indexOf("order:") === 0) orderId = startParam.slice(6);
      }

      if (orderId && hasPerm("orders")) {
        openOrder(orderId);
      }
    }).catch(function (error) {
      $("lock").hidden = false;
      $("lock").querySelector("p").textContent = error.message;
    });
  }

  boot();
})();


</script>
</body>
</html>`;
}

