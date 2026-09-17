// STORE_V2_TEST_PREPARATION
// ============================================================
// Persian Store V2 — Cloudflare Worker Backend
// ============================================================

import storefrontHTML from "./storefront.js";

import {
  AppError,
  responseJSON,
  readJSON,
  rows,
  one,
  execute,
  rowsRead,
  oneRead,
  cachedJSON,
  getSettings,
  rateLimit,
  ipKey
} from "./db.js";

import {
  createOrder,
  getPrivateOrder,
  trackOrder,
  maintainOrders
} from "./orders.js";

import {
  startGatewayPayment,
  handleGatewayCallback
} from "./payments.js";

import {
  servePublicMedia,
  uploadReceipt
} from "./media.js";

import { handleBot } from "./bot.js";
import { deliverNotifications } from "./telegram.js";

import {
  miniAppPage,
  handleMiniAppAPI
} from "./miniapp.js";

import {
  accountPage,
  handleAccountAPI
} from "./users.js";

import { SORT_OPTIONS, envFlagOn } from "./defaults.js";

const PAGE_SIZE = 12;

function setSecurityHeaders(response, isHTML = false) {
  const headers = new Headers(response.headers);

  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");

  if (isHTML) {
    headers.set("content-security-policy", [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "font-src 'self' https://cdn.jsdelivr.net",
      "img-src 'self' data:",
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; "));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/*
 * The Mini App is embedded by Telegram (web.telegram.org) and must
 * therefore allow those frame ancestors; the storefront keeps DENY.
 */
function setMiniAppHeaders(response) {
  const headers = new Headers(response.headers);

  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("content-security-policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://telegram.org",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "font-src 'self' https://cdn.jsdelivr.net",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self' https://web.telegram.org https://telegram.org"
  ].join("; "));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function handleBootstrap(request, env) {
  const settings = await getSettings(env);

  // Gateway and SMS credentials are secrets; never expose them to the client.
  const {
    payment_gateway_merchant: _gatewayMerchant,
    snapppay_username: _snapUsername,
    snapppay_password: _snapPassword,
    snapppay_client_id: _snapClientId,
    snapppay_client_secret: _snapSecret,
    snapppay_base_url: _snapBase,
    sms_api_key: _smsKey,
    ...publicSettings
  } = settings;

  /*
   * Magazine payloads stay lean: the list ships titles (and cover ids)
   * only; the full body is fetched per post from /api/post/:id on demand.
   */
  const [categories, slides, posts, faqs, cards] = await Promise.all([
    settings.categories_enabled
      ? rowsRead(
          env,
          "SELECT id, name, image_id, position FROM categories " +
          "WHERE enabled = 1 ORDER BY position, created_at, id"
        )
      : [],

    settings.slider_enabled
      ? rowsRead(
          env,
          "SELECT id, image_id, title, description, button_text, " +
          "target_type, target_category_id, target_url, position FROM slides " +
          "WHERE enabled = 1 ORDER BY position, created_at, id LIMIT 5"
        )
      : [],

    settings.blog_enabled
      ? rowsRead(
          env,
          "SELECT id, title, image_id, created_at FROM posts " +
          "WHERE published = 1 ORDER BY created_at DESC LIMIT 30"
        )
      : [],

    settings.faq_enabled
      ? rowsRead(
          env,
          "SELECT id, question, answer, position FROM faqs " +
          "WHERE published = 1 ORDER BY position, created_at LIMIT 100"
        )
      : [],

    settings.payment_card_enabled
      ? rowsRead(
          env,
          "SELECT id FROM bank_cards " +
          "WHERE enabled = 1 ORDER BY position, created_at"
        )
      : []
  ]);

  return responseJSON({
    settings: publicSettings,
    categories,
    slides,
    posts,
    faqs,
    cards,
    users_module: envFlagOn(env.USERS_ENABLED)
  });
}

async function handleProducts(request, url, env) {
  const settings = await getSettings(env);

  const requestedPage = Number(url.searchParams.get("page") || 1);
  const page = Math.max(1, Math.min(100000, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));

  const search = settings.search_enabled
    ? (url.searchParams.get("q") || "").trim().slice(0, 100)
    : "";

  const categoryId = settings.categories_enabled
    ? (url.searchParams.get("category") || "").trim().slice(0, 64)
    : "";

  /*
   * Filter-sheet category picker: "cats" is a comma list of category
   * ids (OR within the list, AND with the chip selection above).
   */
  const extraCategoryIds = settings.categories_enabled
    ? (url.searchParams.get("cats") || "")
      .split(/[,،]/)
      .map(item => item.trim().slice(0, 64))
      .filter(item => /^[A-Za-z0-9_-]{1,64}$/.test(item))
      .slice(0, 12)
    : [];

  /*
   * A product counts as available when a simple/shared stock is left,
   * or when at least one enabled variant still has stock.
   */
  const AVAILABLE =
    "(CASE WHEN p.inventory_mode='variants' THEN EXISTS(" +
    "SELECT 1 FROM variants v WHERE v.product_id=p.id " +
    "AND v.enabled=1 AND v.stock>0" +
    ") ELSE p.stock>0 END)";

  const requestedSort = settings.sorting_enabled
    ? (url.searchParams.get("sort") || settings.default_sort || "new")
    : "new";

  const sort = SORT_OPTIONS.includes(requestedSort) ? requestedSort : "new";

  /*
   * Out-of-stock products always sink to the end, except on
   * "newest" which keeps the original order regardless of stock.
   */
  const orderClause = {
    new: "p.created_at DESC",
    cheap: AVAILABLE + " DESC, p.price ASC, p.created_at DESC",
    expensive: AVAILABLE + " DESC, p.price DESC, p.created_at DESC",
    pop: AVAILABLE + " DESC, p.sales_count DESC, p.created_at DESC"
  }[sort];

  let whereClause = "WHERE p.published = 1";
  const params = [];

  if (search) {
    whereClause += " AND (instr(lower(p.name), lower(?)) > 0 OR instr(lower(p.description), lower(?)) > 0)";
    params.push(search, search);
  }

  if (categoryId) {
    whereClause += " AND p.category_id = ?";
    params.push(categoryId);
  }

  if (extraCategoryIds.length) {
    whereClause +=
      " AND p.category_id IN (" +
      extraCategoryIds.map(() => "?").join(",") +
      ")";
    params.push(...extraCategoryIds);
  }

  // Optional price-range and availability filters (customer filter sheet).
  const minPrice = String(url.searchParams.get("min") || "");
  const maxPrice = String(url.searchParams.get("max") || "");
  const availOnly = url.searchParams.get("avail") === "1";

  if (/^\d{1,12}$/.test(minPrice)) {
    whereClause += " AND p.price >= ?";
    params.push(Number(minPrice));
  }

  if (/^\d{1,12}$/.test(maxPrice)) {
    whereClause += " AND p.price <= ?";
    params.push(Number(maxPrice));
  }

  if (availOnly) {
    whereClause += " AND " + AVAILABLE;
  }

  const countQuery = `SELECT COUNT(*) AS total FROM products p ${whereClause}`;
  const countResult = await oneRead(env, countQuery, params);
  const total = Number(countResult?.total || 0);

  const selectQuery = `
    SELECT 
      p.id,
      p.name,
      p.description,
      p.category_id,
      p.price,
      p.stock,
      p.inventory_mode,
      p.low_stock_threshold,
      p.sales_count,
      p.created_at,
      (
        SELECT pi.media_id 
        FROM product_images pi 
        WHERE pi.product_id = p.id 
        ORDER BY pi.position, pi.media_id 
        LIMIT 1
      ) AS primary_image
    FROM products p
    ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ? OFFSET ?
  `;

  const products = await rowsRead(env, selectQuery, [
    ...params,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE
  ]);

  return responseJSON({
    products,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE))
  });
}

/* Public post detail for the magazine dialog (title card -> full text). */
async function handlePostDetail(request, id, env) {
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new AppError(404, "Post not found.");
  }

  const post = await oneRead(
    env,
    "SELECT id, title, body, image_id, created_at FROM posts " +
    "WHERE id = ? AND published = 1",
    [id]
  );

  if (!post) {
    throw new AppError(404, "Post not found.");
  }

  return responseJSON({ post });
}

async function handleProductDetail(id, env) {
  if (!id || typeof id !== "string" || id.length > 64) {
    throw new AppError(404, "Product not found.");
  }

  const product = await one(
    env,
    "SELECT p.*, c.name AS category_name FROM products p " +
    "LEFT JOIN categories c ON c.id = p.category_id " +
    "WHERE p.id = ? AND p.published = 1",
    [id]
  );

  if (!product) {
    throw new AppError(404, "Product not found.");
  }

  const images = await rows(
    env,
    "SELECT media_id FROM product_images WHERE product_id = ? ORDER BY position, media_id",
    [id]
  );

  let variants = [];

  if (product.inventory_mode === "variants") {
    const variantRows = await rows(
      env,
      "SELECT id, signature, options, price, stock, low_stock_threshold FROM variants " +
      "WHERE product_id = ? AND enabled = 1 ORDER BY created_at, id",
      [id]
    );

    variants = variantRows.map(variant => ({
      ...variant,
      options: JSON.parse(variant.options)
    }));
  }

  return responseJSON({
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.category_id,
    categoryName: product.category_name || "",
    price: product.price,
    stock: product.stock,
    attributes: product.attributes,
    inventoryMode: product.inventory_mode,
    optionSchema: JSON.parse(product.option_schema || "[]"),
    images: images.map(item => item.media_id),
    variants
  });
}

async function handleTelegramWebhook(request, env, ctx) {
  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");

  if (!env.BOT_WEBHOOK_SECRET || secretHeader !== env.BOT_WEBHOOK_SECRET) {
    throw new AppError(403, "Invalid webhook secret.");
  }

  const update = await readJSON(request, 100000);

  if (!update || typeof update !== "object" || !Number.isInteger(update.update_id)) {
    throw new AppError(400, "Invalid Telegram update payload.");
  }

  // Atomic deduplication via D1
  const claimed = await one(
    env,
    "INSERT INTO telegram_updates(id, state, created_at, updated_at) " +
    "VALUES(?, 'processing', ?, ?) " +
    "ON CONFLICT(id) DO NOTHING RETURNING id",
    [update.update_id, Date.now(), Date.now()]
  );

  if (!claimed) {
    // Already seen or in progress. Acknowledge immediately to avoid loops.
    return responseJSON({ ok: true });
  }

  try {
    await handleBot(env, update, ctx);

    await execute(
      env,
      "UPDATE telegram_updates SET state = 'done', updated_at = ? WHERE id = ?",
      [Date.now(), update.update_id]
    );
  } catch (error) {
    // Release claimed status so Telegram can safely retry in network drops
    await execute(
      env,
      "DELETE FROM telegram_updates WHERE id = ?",
      [update.update_id]
    );

    throw new AppError(503, "Bot execution failed. Telegram may retry.");
  }

  return responseJSON({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      let response;

      // 1. Root storefront
      if (request.method === "GET" && url.pathname === "/") {
        response = new Response(storefrontHTML, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache"
          }
        });
        return setSecurityHeaders(response, true);
      }

      // 2. Health check
      if (request.method === "GET" && url.pathname === "/health") {
        await one(env, "SELECT 1");
        response = responseJSON({ ok: true, version: "2.0.0" });
      }

      // 3. Store bootstrap (public, edge-cached for ~30s)
      else if (request.method === "GET" && url.pathname === "/api/bootstrap") {
        response = await cachedJSON(request, () => handleBootstrap(request, env));
      }

      // 4. Products list (public, edge-cached for ~30s)
      else if (request.method === "GET" && url.pathname === "/api/products") {
        response = await cachedJSON(request, () => handleProducts(request, url, env));
      }

      // 4b. Magazine post detail (public, edge-cached for ~30s)
      else if (request.method === "GET" && url.pathname.startsWith("/api/post/")) {
        const postId = decodeURIComponent(url.pathname.slice("/api/post/".length));
        response = await cachedJSON(request, () => handlePostDetail(request, postId, env));
      }

      // 5. Product detail
      else if (request.method === "GET" && url.pathname.startsWith("/api/product/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/product/".length));
        response = await handleProductDetail(id, env);
      }

      // 6. Public media proxy
      else if (request.method === "GET" && url.pathname.startsWith("/media/")) {
        const mediaId = url.pathname.slice("/media/".length);
        response = await servePublicMedia(request, env, ctx, mediaId);
      }

      // 7. Orders: Create order
      else if (request.method === "POST" && url.pathname === "/api/orders") {
        const result = await createOrder(request, env, ctx);
        response = responseJSON(result, 201);
      }

      // 8. Orders: Get private order
      else if (request.method === "GET" && url.pathname.startsWith("/api/orders/")) {
        const orderId = decodeURIComponent(url.pathname.slice("/api/orders/".length));
        const result = await getPrivateOrder(request, env, orderId);
        response = responseJSON(result);
      }

      // 9. Orders: Upload card receipt
      else if (
        request.method === "POST" &&
        url.pathname.startsWith("/api/orders/") &&
        url.pathname.endsWith("/receipt")
      ) {
        const parts = url.pathname.split("/");
        const orderId = decodeURIComponent(parts[3]);
        const result = await uploadReceipt(request, env, ctx, orderId);
        response = responseJSON(result);
      }

      // 9. Orders: track an order by code + phone (no login required)
      else if (request.method === "POST" && url.pathname === "/api/orders/track") {
        const result = await trackOrder(request, env);
        response = responseJSON(result);
      }

      // 10. Payments: start an online gateway payment for an order
      else if (request.method === "POST" && url.pathname === "/api/pay/start") {
        response = responseJSON(await startGatewayPayment(request, env, ctx));
      }

      // 11. Payments: gateway return URL (redirect back from the PSP)
      else if (request.method === "GET" && url.pathname === "/pay/callback") {
        response = await handleGatewayCallback(url, env, ctx);
      }

      // 12. Telegram webhook
      else if (request.method === "POST" && url.pathname === "/telegram/webhook") {
        response = await handleTelegramWebhook(request, env, ctx);
      }

      // 13. Admin Mini App page (optional feature; see src/miniapp.js)
      else if (request.method === "GET" && url.pathname === "/miniapp") {
        if (!envFlagOn(env.MINIAPP_ENABLED)) {
          throw new AppError(404, "Endpoint not found.");
        }

        response = new Response(miniAppPage(), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache"
          }
        });

        return setMiniAppHeaders(response);
      }

      // 14. Admin Mini App API
      else if (url.pathname.startsWith("/miniapp/api/")) {
        if (!envFlagOn(env.MINIAPP_ENABLED)) {
          throw new AppError(404, "Endpoint not found.");
        }

        response = await handleMiniAppAPI(request, env, ctx);
      }

      // 15. Customer account page (optional module; see src/users.js)
      else if (request.method === "GET" && url.pathname === "/account") {
        if (!envFlagOn(env.USERS_ENABLED)) {
          throw new AppError(404, "Endpoint not found.");
        }

        response = new Response(accountPage(), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache"
          }
        });
        return setSecurityHeaders(response, true);
      }

      // 16. Customer account API (optional module; see src/users.js)
      else if (url.pathname.startsWith("/account/api/")) {
        if (!envFlagOn(env.USERS_ENABLED)) {
          throw new AppError(404, "Endpoint not found.");
        }

        response = await handleAccountAPI(request, env, ctx);
      }

      // 17. Robots.txt
      else if (request.method === "GET" && url.pathname === "/robots.txt") {
        response = new Response("User-agent: *\nAllow: /\nDisallow: /api/\n", {
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }

      // 404 handler
      else {
        throw new AppError(404, "Endpoint not found.");
      }

      return setSecurityHeaders(response);
    } catch (error) {
      const isKnown = error instanceof AppError;
      const status = isKnown ? error.status : 500;
      const message = isKnown ? error.message : "Internal server error.";

      if (!isKnown) {
        console.error("Unhandled Worker operation failed.");
      }

      return setSecurityHeaders(
        responseJSON({ error: message }, status)
      );
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await maintainOrders(env);
          await deliverNotifications(env, 10);
        } catch (error) {
          console.error("Scheduled maintenance failed.");
        }
      })()
    );
  }
};