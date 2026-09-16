// ============================================================
// Persian Store V2 — Catalog operations shared by the Telegram
// bot and the admin Mini App.
// ============================================================

import { sha256, one, rows, execute } from "./db.js";
import { combinations } from "./defaults.js";

export async function requireStructureEditable(env, productId) {
  const active = await one(
    env,
    "SELECT l.id FROM order_lines l " +
    "JOIN orders o ON o.id=l.order_id " +
    "WHERE l.product_id=? AND o.status IN ('new','confirmed') LIMIT 1",
    [productId]
  );

  if (active) {
    throw new Error(
      "This product has active orders. Its option structure cannot change."
    );
  }
}

/*
 * Applies a new inventory mode + option schema to a product.
 * The product returns to draft status; variants are rebuilt while
 * keeping the stock of identical previous combinations.
 */
export async function applyInventoryStructure(env, state) {
  const product = await one(
    env,
    "SELECT * FROM products WHERE id=?",
    [state.productId]
  );

  if (!product) throw new Error("Product not found.");

  await requireStructureEditable(env, product.id);

  if (!["simple", "shared", "variants"].includes(state.mode)) {
    throw new Error("Invalid inventory mode.");
  }

  const schema = state.mode === "simple" ? [] : state.schema;

  if (!Array.isArray(schema)) {
    throw new Error("Invalid option schema.");
  }

  const selections = state.mode === "variants"
    ? combinations(schema, 100)
    : [];

  const changingInventoryPool =
    (product.inventory_mode === "variants") !==
    (state.mode === "variants");

  const now = Date.now();

  const statements = [
    env.DB.prepare(
      "UPDATE products SET inventory_mode=?,option_schema=?," +
      "published=0,stock=?,updated_at=? WHERE id=?"
    ).bind(
      state.mode,
      JSON.stringify(schema),
      changingInventoryPool ? 0 : product.stock,
      now,
      product.id
    ),

    env.DB.prepare(
      "UPDATE variants SET enabled=0,updated_at=? WHERE product_id=?"
    ).bind(now, product.id)
  ];

  for (const selection of selections) {
    const canonical = Object.fromEntries(
      Object.entries(selection).sort(([a], [b]) => a.localeCompare(b))
    );

    const signature = await sha256(JSON.stringify(canonical));
    const variantId = (
      await sha256(product.id + ":" + signature)
    ).slice(0, 32);

    statements.push(
      env.DB.prepare(
        "INSERT INTO variants(" +
        "id,product_id,signature,options,stock,enabled," +
        "low_stock_threshold,created_at,updated_at" +
        ") VALUES(?,?,?,?,0,1,0,?,?) " +
        "ON CONFLICT(product_id,signature) DO UPDATE SET " +
        "options=excluded.options,enabled=1,updated_at=excluded.updated_at"
      ).bind(
        variantId,
        product.id,
        signature,
        JSON.stringify(selection),
        now,
        now
      )
    );
  }

  await env.DB.batch(statements);
}

/*
 * Publish-time validation for products, shared by the bot toggle and
 * the Mini App publish button.
 */
export async function validateProductPublish(env, record) {
  const schema = JSON.parse(record.option_schema);

  if (
    record.inventory_mode !== "simple" &&
    !schema.length
  ) {
    throw new Error("Configure the product options first.");
  }

  if (record.inventory_mode === "variants") {
    const count = await one(
      env,
      "SELECT COUNT(*) AS total FROM variants " +
      "WHERE product_id=? AND enabled=1",
      [record.id]
    );

    if (!count.total) {
      throw new Error("Create and enable at least one variant.");
    }
  }
}

/*
 * Products with order history are only hidden, never deleted, so
 * historical order lines keep their references.
 */
export async function deleteProduct(env, productId) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE products SET published=0,updated_at=? WHERE id=?"
    ).bind(Date.now(), productId),

    env.DB.prepare(
      "DELETE FROM products WHERE id=? AND NOT EXISTS(" +
      "SELECT 1 FROM order_lines WHERE product_id=?" +
      ")"
    ).bind(productId, productId)
  ]);
}

export async function setProductImages(env, productId, mediaIds) {
  const product = await one(
    env,
    "SELECT id FROM products WHERE id=?",
    [productId]
  );

  if (!product) throw new Error("Product not found.");

  if (
    !Array.isArray(mediaIds) ||
    mediaIds.length > 6 ||
    mediaIds.some(id => !/^[a-f0-9]{32}$/.test(String(id)))
  ) {
    throw new Error("Send 0-6 valid image identifiers.");
  }

  const now = Date.now();
  const statements = [
    env.DB.prepare(
      "DELETE FROM product_images WHERE product_id=?"
    ).bind(productId)
  ];

  mediaIds.forEach((mediaId, index) => {
    statements.push(
      env.DB.prepare(
        "INSERT INTO product_images(product_id,media_id,position) " +
        "VALUES(?,?,?)"
      ).bind(productId, mediaId, index)
    );
  });

  statements.push(
    env.DB.prepare(
      "UPDATE products SET updated_at=? WHERE id=?"
    ).bind(now, productId)
  );

  await env.DB.batch(statements);
}

export async function addProductImage(env, productId, mediaId) {
  const product = await one(
    env,
    "SELECT id FROM products WHERE id=?",
    [productId]
  );

  if (!product) throw new Error("Product not found.");

  const count = await one(
    env,
    "SELECT COUNT(*) AS total,COALESCE(MAX(position),-1) AS last " +
    "FROM product_images WHERE product_id=?",
    [productId]
  );

  if (count.total >= 6) {
    throw new Error("Maximum 6 images per product.");
  }

  await execute(
    env,
    "INSERT INTO product_images(product_id,media_id,position) VALUES(?,?,?)",
    [productId, mediaId, count.last + 1]
  );
}

export async function removeProductImage(env, productId, mediaId) {
  await execute(
    env,
    "DELETE FROM product_images WHERE product_id=? AND media_id=?",
    [productId, mediaId]
  );

  // Re-pack positions so the ordering stays dense (0,1,2...).
  const remaining = await rows(
    env,
    "SELECT media_id FROM product_images " +
    "WHERE product_id=? ORDER BY position,media_id",
    [productId]
  );

  for (let index = 0; index < remaining.length; index++) {
    await execute(
      env,
      "UPDATE product_images SET position=? " +
      "WHERE product_id=? AND media_id=?",
      [index, productId, remaining[index].media_id]
    );
  }
}
