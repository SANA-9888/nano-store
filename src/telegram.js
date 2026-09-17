import { rows, one, execute, getSettings } from "./db.js";
import { envFlagOn } from "./defaults.js";
import { adminHolds } from "./permissions.js";

export async function telegram(env, method, payload = {}) {
  let response;

  try {
    response = await fetch(
      "https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method,
      {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
  } catch {
    throw new Error("Telegram connection failed.");
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("Telegram returned an invalid response.");
  }

  if (!response.ok || !data.ok) {
    const error = new Error("Telegram API request failed.");
    error.telegramCode = data.error_code;
    error.retryAfter = Number(data.parameters?.retry_after || 0);
    error.notModified =
      data.error_code === 400 &&
      /message is not modified/i.test(String(data.description || ""));
    throw error;
  }

  return data.result;
}

export async function sendMessage(env, chatId, text, keyboard = []) {
  return telegram(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 4000),
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

export function button(text, data) {
  return { text, callback_data: data };
}

/*
 * Admin Mini App deep link. When the Mini App is deployed (env var
 * MINIAPP_ENABLED not off/false/0) and the public site URL is known,
 * order notifications open that exact order inside the Mini App.
 */
export async function miniAppOrderKeyboard(env, orderId) {
  const fallback = [[button("پنل مدیریت", "home")]];

  try {
    if (!envFlagOn(env.MINIAPP_ENABLED)) return fallback;

    const settings = await getSettings(env);
    const base = String(settings.site_url || "").replace(/\/+$/, "");

    if (!/^https:\/\//.test(base + "/")) return fallback;

    return [
      [{ text: "🛍 مشاهده سفارش", web_app: { url: base + "/miniapp?order=" + orderId } }],
      fallback[0]
    ];
  } catch {
    return fallback;
  }
}

export async function renderPanel(env, adminId, text, keyboard = []) {
  const id = String(adminId);
  const panel = await one(
    env,
    "SELECT * FROM bot_panels WHERE admin_id=?",
    [id]
  );

  if (panel) {
    try {
      return await telegram(env, "editMessageText", {
        chat_id: panel.chat_id,
        message_id: panel.message_id,
        text: String(text).slice(0, 4000),
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      if (error.notModified) return;

      // Only replace a missing/non-editable message.
      if (error.telegramCode !== 400) throw error;
    }
  }

  const sent = await sendMessage(env, id, text, keyboard);

  await execute(
    env,
    "INSERT INTO bot_panels(admin_id,chat_id,message_id,updated_at) " +
    "VALUES(?,?,?,?) ON CONFLICT(admin_id) DO UPDATE SET " +
    "chat_id=excluded.chat_id,message_id=excluded.message_id," +
    "updated_at=excluded.updated_at",
    [id, id, sent.message_id, Date.now()]
  );

  return sent;
}

function notificationText(job) {
  const value = JSON.parse(job.payload);

  if (job.kind === "low_stock") {
    const options = value.selection
      ? Object.entries(value.selection)
          .map(([key, item]) => key + ": " + item)
          .join("\n")
      : "";

    return [
      "⚠️ هشدار موجودی",
      value.name,
      options,
      "موجودی هنگام هشدار: " + value.stock,
      "آستانه: " + value.threshold,
      "برای بررسی مقدار فعلی، محصول را در پنل باز کنید."
    ].filter(Boolean).join("\n");
  }

  if (job.kind === "order_reminder") {
    return [
      "⏰ سفارش نیازمند پیگیری",
      "کد: " + value.code,
      "نام: " + value.name,
      "تلفن: " + value.phone,
      "لطفاً سفارش را بررسی و با مشتری هماهنگ کنید."
    ].join("\n");
  }

  return [
    "🛍 سفارش جدید",
    "کد: " + value.code,
    "نام: " + value.name,
    "تلفن: " + value.phone,
    "مبلغ: " + Number(value.total).toLocaleString("fa-IR") + " تومان",
    "روش: " + (
      value.payment_method === "card" ? "کارت‌به‌کارت" :
      value.payment_method === "gateway" ? "پرداخت آنلاین" :
      "هماهنگی با مدیر"
    ),
    "ثبت سفارش به معنی تأیید پرداخت نیست."
  ].join("\n");
}

export async function deliverNotifications(env, limit = 6) {
  const candidates = await rows(
    env,
    "SELECT d.job_id,d.admin_id FROM notification_deliveries d " +
    "WHERE d.sent_at IS NULL AND d.next_attempt_at<=? AND d.lease_until<=? " +
    "ORDER BY d.next_attempt_at LIMIT ?",
    [Date.now(), Date.now(), limit]
  );

  if (!candidates.length) return;

  /*
   * Section isolation: an administrator without the governing
   * permission never receives the notification (e.g. order messages
   * require the "orders" key, stock alerts the "products" key).
   * The delivery row is consumed so it is not retried forever.
   */
  const REQUIRED_PERMS = {
    order_new: "orders",
    order_reminder: "orders",
    low_stock: "products"
  };

  const adminIds = [...new Set(candidates.map(item => String(item.admin_id)))];
  const adminRows = await rows(
    env,
    "SELECT id,role,permissions FROM admins" +
    (adminIds.length
      ? " WHERE id IN (" + adminIds.map(() => "?").join(",") + ")"
      : ""),
    adminIds
  );

  const adminMap = new Map(adminRows.map(row => [String(row.id), row]));

  for (const candidate of candidates) {
    const now = Date.now();

    const claimed = await one(
      env,
      "UPDATE notification_deliveries SET lease_until=?,attempts=attempts+1 " +
      "WHERE job_id=? AND admin_id=? AND sent_at IS NULL " +
      "AND lease_until<=? RETURNING attempts",
      [
        now + 120000,
        candidate.job_id,
        candidate.admin_id,
        now
      ]
    );

    if (!claimed) continue;

    try {
      const job = await one(
        env,
        "SELECT * FROM notification_jobs WHERE id=?",
        [candidate.job_id]
      );

      if (!job) continue;

      const required = REQUIRED_PERMS[job.kind];

      if (
        required &&
        !adminHolds(adminMap.get(String(candidate.admin_id)), required)
      ) {
        await execute(
          env,
          "UPDATE notification_deliveries SET sent_at=?,lease_until=0 " +
          "WHERE job_id=? AND admin_id=?",
          [now, candidate.job_id, candidate.admin_id]
        );

        continue;
      }

      const isOrderJob = job.kind === "order_new" || job.kind === "order_reminder";
      const keyboard = isOrderJob
        ? await miniAppOrderKeyboard(env, job.entity_id)
        : [];

      await sendMessage(
        env,
        candidate.admin_id,
        notificationText(job),
        keyboard
      );

      await execute(
        env,
        "UPDATE notification_deliveries SET sent_at=?,lease_until=0 " +
        "WHERE job_id=? AND admin_id=?",
        [Date.now(), candidate.job_id, candidate.admin_id]
      );
    } catch (error) {
      const delay = Math.max(
        Number(error.retryAfter || 0) * 1000,
        Math.min(6 * 3600000, 30000 * 2 ** Math.min(claimed.attempts, 10))
      );

      await execute(
        env,
        "UPDATE notification_deliveries SET lease_until=0,next_attempt_at=? " +
        "WHERE job_id=? AND admin_id=?",
        [Date.now() + delay, candidate.job_id, candidate.admin_id]
      );
    }
  }
}

export async function collectOrderNotifications(env) {
  const pending = await rows(
    env,
    "SELECT id,code,name,phone,total,payment_method FROM orders o " +
    "WHERE NOT EXISTS (" +
    "SELECT 1 FROM notification_jobs j WHERE j.id='order:' || o.id" +
    ") ORDER BY created_at LIMIT 20"
  );

  for (const order of pending) {
    await execute(
      env,
      "INSERT OR IGNORE INTO notification_jobs(" +
      "id,kind,entity_id,payload,created_at) VALUES(?,'order_new',?,?,?)",
      ["order:" + order.id, order.id, JSON.stringify(order), Date.now()]
    );
  }

  const overdue = await rows(
    env,
    "SELECT id,code,name,phone FROM orders o " +
    "WHERE status='new' AND created_at<? AND NOT EXISTS (" +
    "SELECT 1 FROM notification_jobs j WHERE j.id='reminder:' || o.id" +
    ") ORDER BY created_at LIMIT 10",
    [Date.now() - 2 * 86400000]
  );

  for (const order of overdue) {
    await execute(
      env,
      "INSERT OR IGNORE INTO notification_jobs(" +
      "id,kind,entity_id,payload,created_at) VALUES(?,'order_reminder',?,?,?)",
      ["reminder:" + order.id, order.id, JSON.stringify(order), Date.now()]
    );
  }
}

/*
 * Immediate best-effort broadcast. When permissionKey is given, only
 * administrators holding that section receive the message — used for
 * order/payment/receipt events so restricted admins stay quiet.
 */
export async function notifyAdminsBestEffort(env, text, keyboard = [], permissionKey = "") {
  let admins = await rows(env, "SELECT id,role,permissions FROM admins");

  if (permissionKey) {
    admins = admins.filter(admin => adminHolds(admin, permissionKey));
  }

  const results = await Promise.allSettled(
    admins.map(admin => sendMessage(env, admin.id, text, keyboard))
  );

  return results.every(result => result.status === "fulfilled");
}