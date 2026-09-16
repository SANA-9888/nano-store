import {
  AppError,
  uid,
  one,
  rows,
  execute,
  readBytes,
  requireOrigin,
  requireOrderAccess,
  rateLimit,
  ipKey
} from "./db.js";

import {
  telegram,
  notifyAdminsBestEffort
} from "./telegram.js";

const MAX_MEDIA = 4 * 1024 * 1024;

function imageType(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "image/jpeg";

  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10]
      .every((value, index) => bytes[index] === value)
  ) return "image/png";

  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";

  return null;
}

function fontType(bytes) {
  const signature = new TextDecoder().decode(bytes.slice(0, 4));

  if (signature === "wOF2") return "font/woff2";
  if (signature === "wOFF") return "font/woff";

  if (
    bytes[0] === 0 &&
    bytes[1] === 1 &&
    bytes[2] === 0 &&
    bytes[3] === 0
  ) return "font/ttf";

  return null;
}

async function telegramFile(env, fileId) {
  const info = await telegram(env, "getFile", {
    file_id: fileId
  });

  if (!info.file_path || Number(info.file_size || 0) > MAX_MEDIA) {
    throw new Error("Telegram file is unavailable or too large.");
  }

  let response;

  try {
    response = await fetch(
      "https://api.telegram.org/file/bot" +
      env.BOT_TOKEN +
      "/" +
      info.file_path,
      { signal: AbortSignal.timeout(20000) }
    );
  } catch {
    throw new Error("Telegram media download failed.");
  }

  if (!response.ok) {
    throw new Error("Telegram media download failed.");
  }

  return response;
}

export async function saveAdminMedia(env, message, kind) {
  const file = kind === "photo"
    ? message.photo?.at(-1)
    : message.document;

  if (!file) {
    throw new Error(
      kind === "photo"
        ? "Send an image as a Telegram Photo."
        : "Send a WOFF2, WOFF or TTF font Document."
    );
  }

  if (!file.file_size || file.file_size > MAX_MEDIA) {
    throw new Error("Maximum file size is 4 MiB.");
  }

  const upstream = await telegramFile(env, file.file_id);
  const bytes = await readBytes(upstream, MAX_MEDIA);

  const mime = kind === "photo"
    ? imageType(bytes)
    : fontType(bytes);

  if (!mime) {
    throw new Error("Unsupported or invalid media signature.");
  }

  const id = uid();

  await execute(
    env,
    "INSERT INTO media(id,file_id,kind,mime,size,created_at) VALUES(?,?,?,?,?,?)",
    [id, file.file_id, kind, mime, bytes.byteLength, Date.now()]
  );

  return id;
}

export async function servePublicMedia(request, env, ctx, id) {
  if (!/^[a-f0-9]{32}$/.test(id)) {
    throw new AppError(404, "Media not found.");
  }

  const key = new Request(
    new URL("/media/" + id, request.url).href,
    { method: "GET" }
  );

  const cached = await caches.default.match(key);
  if (cached) return cached;

  const media = await one(
    env,
    "SELECT file_id,mime FROM media WHERE id=?",
    [id]
  );

  if (!media) throw new AppError(404, "Media not found.");

  let bytes;

  try {
    bytes = await readBytes(
      await telegramFile(env, media.file_id),
      MAX_MEDIA
    );
  } catch {
    throw new AppError(502, "Media is temporarily unavailable.");
  }

  const response = new Response(bytes, {
    headers: {
      "content-type": media.mime,
      "cache-control": "public, max-age=86400, s-maxage=604800",
      "x-content-type-options": "nosniff"
    }
  });

  ctx.waitUntil(
    caches.default.put(key, response.clone()).catch(() => {
      console.error("Public media cache write failed.");
    })
  );

  return response;
}

async function uploadPrivatePhoto(env, chatId, bytes, mime, caption) {
  const form = new FormData();

  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set(
    "photo",
    new Blob([bytes], { type: mime }),
    "receipt." + (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg")
  );

  let response;
  let result;

  try {
    response = await fetch(
      "https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendPhoto",
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30000)
      }
    );

    result = await response.json();
  } catch {
    throw new Error("Private receipt upload failed.");
  }

  if (!response.ok || !result.ok || !result.result.photo?.length) {
    throw new Error("Telegram rejected the receipt image.");
  }

  return result.result.photo.at(-1).file_id;
}

/**
 * Expected request:
 * POST /api/orders/:id/receipt
 * X-Order-Key: private order token
 * Content-Type: image/jpeg | image/png | image/webp
 * Body: raw image bytes, not multipart/form-data.
 */
export async function uploadReceipt(request, env, ctx, orderId) {
  requireOrigin(request);

  await rateLimit(
    env,
    ipKey(request, "receipt"),
    10,
    600
  );

  const order = await requireOrderAccess(env, request, orderId);

  if (
    order.payment_method !== "card" ||
    !["new", "confirmed"].includes(order.status) ||
    order.payment_status === "paid"
  ) {
    throw new AppError(409, "This order does not accept receipts.");
  }

  if (
    order.expires_at &&
    order.expires_at <= Date.now() &&
    order.payment_status === "unpaid"
  ) {
    throw new AppError(409, "The payment deadline has expired.");
  }

  const count = await one(
    env,
    "SELECT COUNT(*) AS total FROM receipts WHERE order_id=?",
    [order.id]
  );

  if (count.total >= 3) {
    throw new AppError(429, "Maximum 3 receipts per order. Contact the manager.");
  }

  const bytes = await readBytes(request, MAX_MEDIA);
  const mime = imageType(bytes);

  if (!mime) {
    throw new AppError(415, "Upload a JPEG, PNG or WebP image.");
  }

  const admins = await rows(env, "SELECT id FROM admins ORDER BY created_at");
  let fileId;

  for (const admin of admins) {
    try {
      fileId = await uploadPrivatePhoto(
        env,
        admin.id,
        bytes,
        mime,
        "🧾 تصویر رسید برای بررسی\n" +
        "کد: " + order.code + "\n" +
        "این تصویر به‌تنهایی تأیید پرداخت نیست."
      );
      break;
    } catch {
      // Try another administrator who has started the bot.
    }
  }

  if (!fileId) {
    throw new AppError(
      503,
      "Receipt delivery is unavailable. Contact the store manager."
    );
  }

  const receiptId = uid();
  const now = Date.now();

  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO receipts(id,order_id,file_id,uploaded_at) " +
        "SELECT ?,id,?,? FROM orders " +
        "WHERE id=? AND status IN ('new','confirmed') " +
        "AND payment_status IN ('unpaid','review') " +
        "AND (expires_at IS NULL OR expires_at>?) " +
        "AND (SELECT COUNT(*) FROM receipts WHERE order_id=?)<3"
      ).bind(receiptId, fileId, now, order.id, now, order.id),

      env.DB.prepare(
        "UPDATE orders SET payment_status='review',expires_at=NULL,updated_at=? " +
        "WHERE id=? AND EXISTS(SELECT 1 FROM receipts WHERE id=?)"
      ).bind(now, order.id, receiptId)
    ]);
  } catch {
    throw new AppError(409, "Order changed while receiving the receipt.");
  }

  const saved = await one(
    env,
    "SELECT id FROM receipts WHERE id=?",
    [receiptId]
  );

  if (!saved) {
    throw new AppError(409, "Order changed. Contact the manager before paying again.");
  }

  ctx.waitUntil(
    notifyAdminsBestEffort(
      env,
      "🧾 رسید جدید در انتظار بررسی\nکد سفارش: " + order.code +
      "\nبرای مشاهده رسید و تأیید دستی، سفارش را در پنل باز کنید."
    ).catch(() => {})
  );

  return {
    ok: true,
    payment_status: "review"
  };
}

export async function uploadProductImage(env, adminId, bytes) {
  const admin = await one(
    env,
    "SELECT id FROM admins WHERE id=?",
    [String(adminId)]
  );

  if (!admin) throw new AppError(403, "Access denied.");

  if (bytes.byteLength > MAX_MEDIA) {
    throw new AppError(413, "حجم تصویر حداکثر ۴ مگابایت است.");
  }

  const mime = imageType(bytes);

  if (!mime) {
    throw new AppError(415, "فرمت تصویر پشتیبانی نمی‌شود؛ JPEG، PNG یا WebP.");
  }

  /*
   * Product images are stored as Telegram file_ids (same storage as bot
   * uploads): the picture is posted to the acting administrator's private
   * chat to obtain a stable file_id, then registered in the media table.
   */
  const fileId = await uploadPrivatePhoto(
    env,
    admin.id,
    bytes,
    mime,
    "🖼 تصویر آپلودشده از مینی‌اپ مدیریت"
  );

  const id = uid();

  await execute(
    env,
    "INSERT INTO media(id,file_id,kind,mime,size,created_at) VALUES(?,?,?,?,?,?)",
    [id, fileId, "photo", mime, bytes.byteLength, Date.now()]
  );

  return id;
}

export async function sendReceiptToAdmin(env, receiptId, adminId) {
  const admin = await one(
    env,
    "SELECT id FROM admins WHERE id=?",
    [String(adminId)]
  );

  if (!admin) throw new Error("Access denied.");

  const receipt = await one(
    env,
    "SELECT r.file_id,o.code FROM receipts r " +
    "JOIN orders o ON o.id=r.order_id WHERE r.id=?",
    [receiptId]
  );

  if (!receipt) throw new Error("Receipt not found.");

  return telegram(env, "sendPhoto", {
    chat_id: String(adminId),
    photo: receipt.file_id,
    caption: "رسید سفارش " + receipt.code + "\nنیازمند بررسی دستی"
  });
}