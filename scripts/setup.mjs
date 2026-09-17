import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
<<<<<<< HEAD
import { applyMigrations } from "./apply-migrations.mjs";
// STORE_V2_TEST_PREPARATION
=======
>>>>>>> 09dde4a7b23f42fb789f088d2e1bc94f9d18eecf

const root = process.cwd();

let sensitiveValues = [
  process.env.CLOUDFLARE_API_TOKEN,
  process.env.BOT_TOKEN,
  process.env.TURNSTILE_SECRET_KEY
].filter(Boolean);

function redact(value) {
  let output = String(value);

  for (const secret of sensitiveValues) {
    output = output.replaceAll(secret, "[REDACTED]");
  }

  return output;
}

function fail(message) {
  throw new Error(message);
}

function log(message = "") {
  console.log(redact(message));
}

function runNode(file) {
  const result = spawnSync(
    process.execPath,
    [file],
    {
      cwd: root,
      stdio: "inherit"
    }
  );

  if (result.error || result.status !== 0) {
    fail("Project validation failed.");
  }
}

function runWrangler(args, input) {
  const executable = path.join(
    root,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js"
  );

  if (!fs.existsSync(executable)) {
    fail("Wrangler was not found. Run npm install first.");
  }

  log("Running: wrangler " + args.join(" "));

  const result = spawnSync(
    process.execPath,
    [executable, ...args],
    {
      cwd: root,
      encoding: "utf8",
      input,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        CI: "true",
        WRANGLER_SEND_METRICS: "false"
      }
    }
  );

  if (result.stdout) {
    process.stdout.write(redact(result.stdout));
  }

  if (result.stderr) {
    process.stderr.write(redact(result.stderr));
  }

  if (result.error) {
    fail("Could not start Wrangler: " + result.error.message);
  }

  if (result.status !== 0) {
    fail("Wrangler command failed.");
  }
}

function checksum(content) {
  return crypto
    .createHash("sha256")
    .update(content)
    .digest("hex");
}

function normalizeSQL(content) {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
}

async function main() {
  const nodeMajor = Number(
    process.versions.node.split(".")[0]
  );

  if (nodeMajor < 22) {
    fail("Node.js 22 or newer is required.");
  }

  if (!fs.existsSync(path.join(root, "package.json"))) {
    fail("Run setup from the project root.");
  }

  const required = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "BOT_TOKEN",
    "SHOP_SLUG"
  ];

  for (const key of required) {
    if (!process.env[key]?.trim()) {
      fail("Missing required variable: " + key);
    }
  }

  const account = process.env.CLOUDFLARE_ACCOUNT_ID.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN.trim();
  const botToken = process.env.BOT_TOKEN.trim();
  const slug = process.env.SHOP_SLUG.trim();
  const turnstileSecret =
    process.env.TURNSTILE_SECRET_KEY?.trim() || "";

  sensitiveValues = [
    token,
    botToken,
    turnstileSecret
  ].filter(Boolean);

  // Keep child processes consistent with the validated values.
  process.env.CLOUDFLARE_ACCOUNT_ID = account;
  process.env.CLOUDFLARE_API_TOKEN = token;

  if (!/^[a-f0-9]{32}$/i.test(account)) {
    fail("Invalid Cloudflare account ID.");
  }

  if (!/^[a-z][a-z0-9-]{2,40}$/.test(slug)) {
    fail(
      "SHOP_SLUG must start with a lowercase letter and contain " +
      "3-41 lowercase letters, digits or hyphens."
    );
  }

  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    fail("Invalid Telegram bot token format.");
  }

  log("Checking project files and JavaScript syntax...");
  runNode("scripts/check.mjs");

  async function cf(apiPath, method = "GET", body) {
    let response;

    try {
      response = await fetch(
        "https://api.cloudflare.com/client/v4" + apiPath,
        {
          method,
          signal: AbortSignal.timeout(60000),
          headers: {
            authorization: "Bearer " + token,
            "content-type": "application/json"
          },
          body:
            body === undefined
              ? undefined
              : JSON.stringify(body)
        }
      );
    } catch {
      fail(
        "Cloudflare API connection failed or timed out. " +
        "The request may have reached Cloudflare; retry setup safely."
      );
    }

    let data;

    try {
      data = await response.json();
    } catch {
      fail("Cloudflare returned an invalid JSON response.");
    }

    if (!response.ok || !data.success) {
      const details = (data.errors || [])
        .map(error => {
          return (
            "[" +
            (error.code ?? "unknown") +
            "] " +
            (error.message || "No description.")
          );
        })
        .join(" | ");

      fail(
        "Cloudflare API request failed (HTTP " +
        response.status +
        "): " +
        (details || "No error details returned.")
      );
    }

    return data.result;
  }

  async function telegram(method, payload = {}) {
    let response;

    try {
      response = await fetch(
        "https://api.telegram.org/bot" +
        botToken +
        "/" +
        method,
        {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );
    } catch {
      fail("Telegram API connection failed or timed out.");
    }

    let data;

    try {
      data = await response.json();
    } catch {
      fail("Telegram returned an invalid JSON response.");
    }

    if (!response.ok || !data.ok) {
      fail(
        "Telegram " +
        method +
        " failed: " +
        (data.description || "No error description.")
      );
    }

    return data.result;
  }

  log("Checking Telegram bot...");
  const bot = await telegram("getMe");

  log("Checking workers.dev subdomain...");

  let subdomain;

  try {
    subdomain = await cf(
      "/accounts/" + account + "/workers/subdomain"
    );
  } catch (error) {
    fail(
      error.message +
      "\nIf this account has no workers.dev subdomain, " +
      "create one in Workers & Pages and retry."
    );
  }

  if (!subdomain?.subdomain) {
    log("Registering a workers.dev subdomain...");

    subdomain = await cf(
      "/accounts/" + account + "/workers/subdomain",
      "PUT",
      {
        subdomain: "store-" + account.slice(0, 12)
      }
    );
  }

  if (!subdomain?.subdomain) {
    fail(
      "A workers.dev subdomain is required. " +
      "Create it in the Cloudflare dashboard and retry."
    );
  }

  log("Finding or creating the D1 database...");

  const databaseList = await cf(
    "/accounts/" +
    account +
    "/d1/database?name=" +
    encodeURIComponent(slug) +
    "&per_page=100"
  );

  if (!Array.isArray(databaseList)) {
    fail("Unexpected D1 database list response.");
  }

  let database = databaseList.find(
    item => item.name === slug
  );

  if (!database) {
    const initialAdmins = (process.env.ADMIN_IDS || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

    if (
      !initialAdmins.length ||
      initialAdmins.some(value => !/^[1-9]\d{4,19}$/.test(value))
    ) {
      fail(
        "Set ADMIN_IDS to valid numeric Telegram user IDs " +
        "before creating a new database."
      );
    }

    database = await cf(
      "/accounts/" + account + "/d1/database",
      "POST",
      { name: slug }
    );

    log("D1 database created.");
  } else {
    log("Existing D1 database found.");
  }

  const databaseId = database.uuid || database.id;

  if (!databaseId) {
    fail("Cloudflare did not return a database ID.");
  }

  async function query(sql, params = []) {
    const result = await cf(
      "/accounts/" +
      account +
      "/d1/database/" +
      databaseId +
      "/query",
      "POST",
      { sql, params }
    );

    if (!Array.isArray(result)) {
      fail("Unexpected D1 query response.");
    }

    for (const item of result) {
      if (item.success === false) {
        fail(
          "D1 query failed: " +
          JSON.stringify(
            item.errors || item.error || "Unknown D1 error."
          )
        );
      }
    }

    return result[0]?.results || [];
  }

  // Avoid accidentally applying the new schema to the old store.
  const existingTables = await query(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('products', 'store_migrations_v2');
  `);

  const tableNames = new Set(
    existingTables.map(item => item.name)
  );

  if (
    tableNames.has("products") &&
    !tableNames.has("store_migrations_v2")
  ) {
    fail(
      "This database appears to belong to an older store. " +
      "Choose a new SHOP_SLUG for a clean V2 installation. " +
      "No V2 migrations were applied."
    );
  }

  await query(`
    CREATE TABLE IF NOT EXISTS store_migrations_v2 (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('running', 'done')),
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);

<<<<<<< HEAD
  await applyMigrations({
    query,
    directory: path.join(root, "migrations")
  });
=======
  const migrationDirectory = path.join(root, "migrations");

  const migrationFiles = fs.readdirSync(migrationDirectory)
    .filter(file => /^\d+.*\.sql$/.test(file))
    .sort();

  if (!migrationFiles.length) {
    fail("No migration files were found.");
  }

  for (const file of migrationFiles) {
    const sql = normalizeSQL(
      fs.readFileSync(
        path.join(migrationDirectory, file),
        "utf8"
      )
    );

    const fingerprint = checksum(sql);

    const previous = await query(
      "SELECT * FROM store_migrations_v2 WHERE name=?",
      [file]
    );

    if (previous.length) {
      if (previous[0].checksum !== fingerprint) {
        fail(
          "Migration checksum mismatch: " +
          file +
          ". Do not edit an already-started migration. " +
          "Restore the original file or create a new migration."
        );
      }

      if (previous[0].state === "done") {
        log("Migration already applied: " + file);
        continue;
      }

      log("Resuming initial migration: " + file);
    } else {
      await query(
        "INSERT INTO store_migrations_v2(" +
        "name,checksum,state,started_at" +
        ") VALUES(?,?,'running',?)",
        [file, fingerprint, Date.now()]
      );
    }

    const statements = sql
      .split(/^\s*-- statement-breakpoint\s*$/m)
      .map(statement => statement.trim())
      .filter(Boolean);

    for (let index = 0; index < statements.length; index++) {
      log(
        "Applying " +
        file +
        " — statement " +
        (index + 1) +
        "/" +
        statements.length
      );

      try {
        await query(statements[index]);
      } catch (error) {
        log("");
        log("Failed SQL statement:");
        log(statements[index]);

        fail(
          "Migration failed: " +
          file +
          ", statement " +
          (index + 1) +
          ". " +
          error.message
        );
      }
    }

    await query(
      "UPDATE store_migrations_v2 " +
      "SET state='done',completed_at=? WHERE name=?",
      [Date.now(), file]
    );

    log("Migration completed: " + file);
  }
>>>>>>> 09dde4a7b23f42fb789f088d2e1bc94f9d18eecf

  log("Checking database safety triggers...");

  const triggerRows = await query(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'trigger';
  `);

  const triggers = new Set(
    triggerRows.map(item => item.name)
  );

  const requiredTriggers = [
    "product_image_limit",
    "validate_order_coupon",
    "reserve_order_coupon",
    "validate_order_item",
    "reserve_order_stock",
    "validate_order_status",
    "restore_order_stock",
    "restore_order_coupon",
    "advance_low_stock_cycle",
    "create_low_stock_notification",
<<<<<<< HEAD
    "create_notification_deliveries",
    "reserve_variant_stock",
    "restore_cancelled_variants",
    "protect_reserved_product_structure",
    "protect_paid_order",
    "protect_cancelled_payment",
    "advance_variant_low_stock_cycle",
    "create_variant_low_stock_notification"
=======
    "create_notification_deliveries"
>>>>>>> 09dde4a7b23f42fb789f088d2e1bc94f9d18eecf
  ];

  const missingTriggers = requiredTriggers.filter(
    name => !triggers.has(name)
  );

  if (missingTriggers.length) {
    fail(
      "Missing database triggers: " +
      missingTriggers.join(", ")
    );
  }

  const { DEFAULTS } = await import("../src/defaults.js");

  if (
    !DEFAULTS ||
    typeof DEFAULTS !== "object" ||
    Array.isArray(DEFAULTS)
  ) {
    fail("src/defaults.js must export the DEFAULTS object.");
  }

  log("Initializing editable settings...");

  // Small groups avoid excessive SQL parameter counts.
  const entries = Object.entries(DEFAULTS);

  for (let offset = 0; offset < entries.length; offset += 20) {
    const group = entries.slice(offset, offset + 20);

    await query(
      "INSERT OR IGNORE INTO settings(key,value) VALUES " +
      group.map(() => "(?,?)").join(","),
      group.flatMap(([key, value]) => [
        key,
        JSON.stringify(value)
      ])
    );
  }

  const adminCount = await query(
    "SELECT COUNT(*) AS total FROM admins"
  );

  if (!Number(adminCount[0]?.total)) {
    const admins = [
      ...new Set(
        (process.env.ADMIN_IDS || "")
          .split(",")
          .map(value => value.trim())
          .filter(Boolean)
      )
    ];

    if (
      !admins.length ||
      admins.some(value => !/^[1-9]\d{4,19}$/.test(value))
    ) {
      fail("ADMIN_IDS must contain valid numeric Telegram user IDs.");
    }

    for (const id of admins) {
      await query(
        "INSERT OR IGNORE INTO admins(id,created_at) VALUES(?,?)",
        [id, Date.now()]
      );
    }

    log("Initial administrators added.");
  } else {
    log(
      "Existing administrators preserved. " +
      "ADMIN_IDS was not re-applied."
    );
  }

  const siteURL =
    "https://" +
    slug +
    "." +
    subdomain.subdomain +
    ".workers.dev";

  const wranglerConfig = {
    "$schema": "./node_modules/wrangler/config-schema.json",
    name: slug,
    main: "src/worker.js",
    account_id: account,
    compatibility_date: "2025-03-01",
    workers_dev: true,
    preview_urls: false,
    d1_databases: [
      {
        binding: "DB",
        database_name: slug,
        database_id: databaseId
      }
    ],
    /*
     * Runtime switches visible in the dashboard (Workers > Settings >
     * Variables). Both default to "on"; set "off" there or here to
     * disable the Telegram Mini App or the customer-accounts module.
     */
    vars: {
      MINIAPP_ENABLED: "on",
      USERS_ENABLED: "on"
    },
    triggers: {
      crons: ["*/15 * * * *"]
    },
    observability: {
      enabled: false
    }
  };

  fs.writeFileSync(
    path.join(root, "wrangler.json"),
    JSON.stringify(wranglerConfig, null, 2) + "\n"
  );

  log("Deploying Worker...");
  runWrangler(["deploy"]);

  const webhookSecret = crypto
    .randomBytes(32)
    .toString("hex");

  sensitiveValues.push(webhookSecret);

  const secrets = {
    BOT_TOKEN: botToken,
    BOT_WEBHOOK_SECRET: webhookSecret
  };

  // An empty local optional value does not erase an existing secret.
  if (turnstileSecret) {
    secrets.TURNSTILE_SECRET_KEY = turnstileSecret;
  }

  log("Uploading Worker secrets...");
  runWrangler(
    ["secret", "bulk"],
    JSON.stringify(secrets)
  );

  log("Checking deployment health...");

  let healthy = false;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(
        siteURL + "/health",
        {
          signal: AbortSignal.timeout(10000),
          headers: {
            "cache-control": "no-cache"
          }
        }
      );

      const result = await response.json();

      if (response.ok && result.ok === true) {
        healthy = true;
        break;
      }
    } catch {
      // Allow time for deployment propagation.
    }

    await new Promise(resolve => {
      setTimeout(resolve, 3000);
    });
  }

  if (!healthy) {
    fail(
      "Worker was deployed, but the health check failed. " +
      "Open " +
      siteURL +
      "/health or run npm run logs, then retry setup. " +
      "Telegram webhook was not changed."
    );
  }

  log("Connecting Telegram webhook...");

  await telegram("setWebhook", {
    url: siteURL + "/telegram/webhook",
    secret_token: webhookSecret,
    allowed_updates: [
      "message",
      "callback_query"
    ],
    max_connections: 1,
    drop_pending_updates: false
  });

  await telegram("setMyCommands", {
    commands: [
      {
        command: "start",
        description: "مدیریت فروشگاه"
      },
      {
        command: "cancel",
        description: "لغو عملیات"
      },
      {
        command: "help",
        description: "راهنمای مدیریت"
      }
    ]
  });

  const webhook = await telegram("getWebhookInfo");

  if (
    webhook.url !== siteURL + "/telegram/webhook"
  ) {
    fail(
      "Webhook verification failed. " +
      "Run setup again after checking the bot configuration."
    );
  }

  log("");
  log("Installation completed successfully.");
  log("Store URL: " + siteURL);
  log("Bot URL: https://t.me/" + bot.username);
  log(
    "Every administrator must open the bot and send /start."
  );
  log(
    "Run a test order before accepting real customer orders."
  );
  log(
    "Do not commit .env, generated account configuration or database backups."
  );
}

main().catch(error => {
  console.error(
    redact(
      "Installation failed: " +
      String(error?.message || "Unknown installation error.")
    )
  );

  process.exitCode = 1;
});