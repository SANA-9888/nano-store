import { DEFAULTS } from "./defaults.js";

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function uid() {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function sha256(value) {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value))
  );

  return [...new Uint8Array(data)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

export async function rows(env, sql, values = []) {
  const result = await env.DB.prepare(sql).bind(...values).all();
  return result.results;
}

export async function one(env, sql, values = []) {
  return env.DB.prepare(sql).bind(...values).first();
}

export async function execute(env, sql, values = []) {
  return env.DB.prepare(sql).bind(...values).run();
}

/*
 * Read replicas for the public, write-free storefront reads.
 *
 * Bind the SAME D1 database up to two extra times in the Cloudflare
 * dashboard (DB_R1, DB_R2) after enabling read replication; the
 * storefront then spreads its read load across all of them. Without
 * those bindings everything still works on the primary binding.
 */
export function publicDb(env) {
  const replicas = [env.DB_R1, env.DB_R2].filter(Boolean);

  if (replicas.length && typeof env.DB.withReplicas === "function") {
    return env.DB.withReplicas(replicas);
  }

  return env.DB;
}

export async function rowsRead(env, sql, values = []) {
  const result = await publicDb(env).prepare(sql).bind(...values).all();
  return result.results;
}

export async function oneRead(env, sql, values = []) {
  return publicDb(env).prepare(sql).bind(...values).first();
}

/*
 * Short-TTL edge cache for hot public GETs (bootstrap/products).
 * Keyed by the full request URL, which already contains every filter;
 * a stale entry expires by itself in ~30s, so admin changes appear
 * quickly without any purge machinery. Cache API is best-effort:
 * any failure just falls through to a direct D1 read.
 */
const PUBLIC_CACHE_TTL = 30;

export async function cachedJSON(request, build) {
  const cache = (typeof caches !== "undefined" && caches.default) || null;
  let cacheKey = null;

  try {
    if (cache && request.method === "GET") {
      cacheKey = new Request(
        new URL(request.url).href,
        { method: "GET", headers: { "content-type": "application/json" } }
      );

      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }
  } catch {
    cacheKey = null;
  }

  const response = await build();

  try {
    if (cache && cacheKey) {
      const stored = new Response(response.clone().body, {
        status: response.status,
        headers: new Headers({
          "content-type": response.headers.get("content-type") ||
            "application/json; charset=utf-8",
          "cache-control": "public, max-age=" + PUBLIC_CACHE_TTL
        })
      });

      await cache.put(cacheKey, stored);
    }
  } catch {
    // Cache write failures must never break the response.
  }

  return response;
}

export async function getSettings(env) {
  const stored = await rows(env, "SELECT key,value FROM settings");
  const output = structuredClone(DEFAULTS);

  for (const item of stored) {
    if (!(item.key in DEFAULTS)) continue;

    try {
      output[item.key] = JSON.parse(item.value);
    } catch {
      // Keep the default for an invalid legacy value.
    }
  }

  return output;
}

export async function setSetting(env, key, value) {
  if (!(key in DEFAULTS)) throw new Error("Unknown setting.");

  await execute(
    env,
    "INSERT INTO settings(key,value) VALUES(?,?) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, JSON.stringify(value)]
  );
}

export function responseJSON(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function readBytes(request, maximum) {
  const declared = Number(request.headers.get("content-length") || 0);

  if (declared > maximum) {
    throw new AppError(413, "Request body is too large.");
  }

  const reader = request.body?.getReader();

  if (!reader) {
    throw new AppError(400, "Request body is required.");
  }

  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;

    if (total > maximum) {
      await reader.cancel();
      throw new AppError(413, "Request body is too large.");
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export async function readJSON(request, maximum = 30000) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new AppError(415, "Use application/json.");
  }

  try {
    const bytes = await readBytes(request, maximum);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "Invalid JSON.");
  }
}

export function requireOrigin(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    throw new AppError(403, "Invalid request origin.");
  }
}

export async function rateLimit(env, key, maximum, windowSeconds) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const hashed = await sha256(key + ":" + bucket);

  const result = await one(
    env,
    "INSERT INTO rate_limits(key,hits,expires_at) VALUES(?,1,?) " +
    "ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits",
    [hashed, Date.now() + windowSeconds * 2000]
  );

  if (result.hits > maximum) {
    throw new AppError(429, "Too many attempts. Try again later.");
  }
}

export function ipKey(request, action) {
  return action + ":" +
    (request.headers.get("CF-Connecting-IP") || "unknown");
}

export async function requireOrderAccess(env, request, orderId) {
  const token = request.headers.get("X-Order-Key") || "";

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw new AppError(404, "Order not found.");
  }

  const order = await one(
    env,
    "SELECT * FROM orders WHERE id=? AND access_hash=?",
    [orderId, await sha256(token)]
  );

  if (!order) {
    throw new AppError(404, "Order not found.");
  }

  return order;
}

export async function isAdmin(env, id) {
  return Boolean(
    await one(env, "SELECT id FROM admins WHERE id=?", [String(id)])
  );
}