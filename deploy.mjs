import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";

dotenv.config();

const E = process.env;
const root = process.cwd();

const wranglerPath = path.join(
  root,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js"
);

const configPath = "wrangler.generated.json";
const configArgs = ["--config", configPath];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fail(message) {
  throw new Error(message);
}

async function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function openUrl(value) {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error("فقط آدرس HTTPS مجاز است.");
  }

  let child;

  if (process.platform === "win32") {
    child = spawn(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", url.href],
      { detached: true, stdio: "ignore" }
    );
  } else if (process.platform === "darwin") {
    child = spawn("open", [url.href], {
      detached: true,
      stdio: "ignore"
    });
  } else {
    child = spawn("xdg-open", [url.href], {
      detached: true,
      stdio: "ignore"
    });
  }

  child.on("error", () => {
    console.log("این آدرس را در مرورگر باز کن:\n" + url.href);
  });

  child.unref();
}

function saveEnv(key, value) {
  let contents = fs.readFileSync(".env", "utf8");

  const line = `${key}=${JSON.stringify(String(value))}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  contents = pattern.test(contents)
    ? contents.replace(pattern, () => line)
    : contents + "\n" + line + "\n";

  fs.writeFileSync(".env", contents);
  E[key] = String(value);
}

// برای این نصب از OAuth استفاده می‌کنیم، نه کلید قدیمی موجود در محیط.
const childEnv = { ...E };

const cloudflareApiToken =
  (E.CLOUDFLARE_API_TOKEN || "").trim();

// Remove legacy credentials to avoid authentication conflicts.
for (const name of [
  "CF_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CF_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CF_EMAIL"
]) {
  delete childEnv[name];
}

if (cloudflareApiToken) {
  childEnv.CLOUDFLARE_API_TOKEN = cloudflareApiToken;
} else {
  delete childEnv.CLOUDFLARE_API_TOKEN;
}

delete childEnv.CI;
childEnv.WRANGLER_SEND_METRICS = "false";

function wrangler(args, options = {}) {
  const {
    capture = false,
    allowFailure = false,
    input
  } = options;

  return new Promise((resolve, reject) => {
    const piped = capture || input !== undefined;

    const child = spawn(
      process.execPath,
      [wranglerPath, ...args],
      {
        cwd: root,
        env: childEnv,
        stdio: [
          input !== undefined ? "pipe" : "inherit",
          piped ? "pipe" : "inherit",
          piped ? "pipe" : "inherit"
        ]
      }
    );

    let out = "";
    let err = "";

    if (piped) {
      child.stdout.on("data", chunk => {
        out += chunk.toString();
      });

      child.stderr.on("data", chunk => {
        err += chunk.toString();
      });
    }

    child.on("error", reject);

    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }

    child.on("close", code => {
      const clean = value =>
        value.replace(/\x1b\[[0-9;]*m/g, "");

      const result = {
        code,
        stdout: clean(out),
        stderr: clean(err)
      };

      if (code !== 0 && !allowFailure) {
        if (result.stdout) console.error(result.stdout);
        if (result.stderr) console.error(result.stderr);

        reject(new Error("اجرای Wrangler ناموفق بود؛ پیام بالا را بررسی کن."));
      } else {
        resolve(result);
      }
    });
  });
}

async function telegram(method, data = {}) {
  let response;

  try {
    response = await fetch(
      `https://api.telegram.org/bot${E.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(25000)
      }
    );
    } catch (error) {
    const causes = [
      error,
      error?.cause,
      ...(Array.isArray(error?.cause?.errors)
        ? error.cause.errors
        : [])
    ].filter(Boolean);

    const codes = [
      ...new Set(
        causes
          .map(item => item.code || item.name)
          .filter(Boolean)
      )
    ].join(", ");

    throw new Error(
      "Telegram API connection failed. " +
      "Network error codes: " + (codes || "UNKNOWN") + ". " +
      "Check internet access, proxy configuration, DNS, and HTTPS certificates."
    );
  }

  let body;

  try {
    body = await response.json();
  } catch {
    throw new Error("پاسخ تلگرام معتبر نبود.");
  }

  if (!body.ok) {
    if (body.error_code === 401 || body.error_code === 404) {
      throw new Error("توکن ربات معتبر نیست؛ TELEGRAM_BOT_TOKEN را بررسی کن.");
    }

    throw new Error(`تلگرام درخواست ${method} را نپذیرفت.`);
  }

  return body.result;
}

function parseJsonOutput(text) {
  try {
    return JSON.parse(text.trim());
  } catch {}

  // برخی نسخه‌ها پیش از JSON پیام کوتاه چاپ می‌کنند.
  for (const match of text.matchAll(/^[ \t]*(\[|\{)/gm)) {
    try {
      return JSON.parse(text.slice(match.index).trim());
    } catch {}
  }

  throw new Error("خروجی JSON ابزار Wrangler قابل خواندن نبود.");
}

const quoteSql = value =>
  "'" + String(value).replaceAll("'", "''") + "'";

async function identifyAdmin(bot) {
  if (E.TELEGRAM_ADMIN_IDS?.trim()) {
    if (!/^\d+(,\s*\d+)*$/.test(E.TELEGRAM_ADMIN_IDS.trim())) {
      fail("TELEGRAM_ADMIN_IDS باید شناسه‌های عددی با کامای انگلیسی باشد.");
    }

    return;
  }

  const webhook = await telegram("getWebhookInfo");

  if (webhook.url) {
    fail(
      "این ربات از قبل webhook دارد. برای حفظ اتصال قبلی آن را حذف نکردم.\n" +
      "شناسه مدیر را در TELEGRAM_ADMIN_IDS وارد کن، یا یک ربات تازه استفاده کن."
    );
  }

  const nonce = "setup_" + crypto.randomBytes(18).toString("hex");
  const link = `https://t.me/${bot.username}?start=${nonce}`;

  console.log(`
🤖 حالا مدیر فروشگاه را شناسایی می‌کنیم.

تلگرام باز می‌شود.
با حسابی که باید مدیر فروشگاه باشد، دکمه Start را بزن.

${link}
`);

  openUrl(link);

  const deadline = Date.now() + 5 * 60 * 1000;
  let offset;

  while (Date.now() < deadline) {
    const updates = await telegram("getUpdates", {
      ...(offset !== undefined ? { offset } : {}),
      timeout: 10,
      allowed_updates: ["message"]
    });

    for (const update of updates) {
      offset = update.update_id + 1;

      const message = update.message;

      if (
        message?.chat?.type !== "private" ||
        message.text !== `/start ${nonce}` ||
        message.from?.is_bot ||
        message.from?.id !== message.chat.id
      ) {
        continue;
      }

      const displayName = [
        message.from.first_name,
        message.from.last_name
      ].filter(Boolean).join(" ");

      console.log(`حساب پیدا شد: ${displayName}`);
      console.log(`شناسه عددی: ${message.from.id}`);

      const answer = await ask(
        "این حساب مدیر فروشگاه باشد؟ برای تأیید yes بنویس: "
      );

      if (answer.toLowerCase() !== "yes") {
        fail("انتخاب مدیر تأیید نشد. نصب بدون تغییر webhook متوقف شد.");
      }

      saveEnv("TELEGRAM_ADMIN_IDS", message.from.id);

      await telegram("sendMessage", {
        chat_id: message.from.id,
        text: "✅ حساب شما به‌عنوان مدیر این نصب انتخاب شد. راه‌اندازی فروشگاه در حال انجام است."
      });

      return;
    }

    await sleep(500);
  }

  fail("زمان شناسایی مدیر تمام شد. فایل نصب را دوباره اجرا کن و Start را بزن.");
}

async function identifyCloudflareAccount() {
  if (cloudflareApiToken) {
    const accountId =
      (E.CLOUDFLARE_ACCOUNT_ID || "").trim();

    if (!/^[a-f0-9]{32}$/i.test(accountId)) {
      throw new Error(
        "API token mode requires a valid CLOUDFLARE_ACCOUNT_ID."
      );
    }

    childEnv.CLOUDFLARE_ACCOUNT_ID = accountId;

    console.log(
      "Using Cloudflare API token authentication. Browser login is not required."
    );

    return accountId;
  }
  console.log("\n☁️ بررسی ورود به Cloudflare...");

  let result = await wrangler(["whoami"], {
    capture: true,
    allowFailure: true
  });

  let accountIds = [
    ...new Set(result.stdout.match(/\b[a-f0-9]{32}\b/gi) || [])
  ];

  if (result.code !== 0 || !accountIds.length) {
    console.log(`
مرورگر برای ورود رسمی Cloudflare باز می‌شود.
وارد حساب شو یا ثبت‌نام کن و دسترسی Wrangler را تأیید کن.
این پنجره را نبند.
`);

    await wrangler(["login"]);

    result = await wrangler(["whoami"], { capture: true });

    accountIds = [
      ...new Set(result.stdout.match(/\b[a-f0-9]{32}\b/gi) || [])
    ];
  }

  if (!accountIds.length) {
    fail(
      "شناسه حساب از خروجی Wrangler پیدا نشد.\n" +
      "ممکن است قالب خروجی ابزار تغییر کرده باشد یا حساب هنوز کامل نشده باشد."
    );
  }

  let accountId = E.CLOUDFLARE_ACCOUNT_ID?.trim();

  if (accountId && !accountIds.includes(accountId)) {
    fail(
      "CLOUDFLARE_ACCOUNT_ID با حساب‌های ورود فعلی مطابقت ندارد.\n" +
      "این مقدار را خالی کن یا با حساب درست وارد شو."
    );
  }

  if (!accountId && accountIds.length === 1) {
    accountId = accountIds[0];
  }

  if (!accountId) {
    console.log(result.stdout);
    console.log("چند حساب Cloudflare پیدا شد:\n");

    accountIds.forEach((value, index) => {
      console.log(`${index + 1}) ${value}`);
    });

    const answer = Number(await ask("شماره حساب موردنظر: "));

    if (
      !Number.isInteger(answer) ||
      answer < 1 ||
      answer > accountIds.length
    ) {
      fail("انتخاب حساب معتبر نیست.");
    }

    accountId = accountIds[answer - 1];
  }

  saveEnv("CLOUDFLARE_ACCOUNT_ID", accountId);
  childEnv.CLOUDFLARE_ACCOUNT_ID = accountId;

  return accountId;
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) {
    fail("Node.js 22 یا جدیدتر لازم است. نصب را از start.cmd اجرا کن.");
  }

  if (!fs.existsSync(".env")) {
    fail("فایل .env پیدا نشد.");
  }

  if (!fs.existsSync(wranglerPath)) {
    fail("Wrangler نصب نشده است. نصب را از start.cmd اجرا کن.");
  }

  if (
    !E.TELEGRAM_BOT_TOKEN ||
    !/^\d+:[A-Za-z0-9_-]{20,}$/.test(E.TELEGRAM_BOT_TOKEN.trim())
  ) {
    fail(
      "توکن ربات وارد نشده یا قالب آن معتبر نیست.\n" +
      "فایل .env را باز کن و TELEGRAM_BOT_TOKEN را از BotFather وارد کن."
    );
  }

  E.TELEGRAM_BOT_TOKEN = E.TELEGRAM_BOT_TOKEN.trim();

  const project = E.PROJECT_NAME || "vitrin-shop";

  if (!/^[a-z][a-z0-9-]{2,40}$/.test(project)) {
    fail("PROJECT_NAME باید ۳ تا ۴۱ کاراکتر انگلیسی کوچک، عدد یا خط تیره باشد.");
  }

  const brand = E.BRAND_COLOR || "#166454";

  if (!/^#[0-9a-f]{6}$/i.test(brand)) {
    fail('رنگ را داخل کوتیشن بنویس؛ مثال: BRAND_COLOR="#166454"');
  }

  const shipping = Number(E.SHIPPING_FEE || 0);

  if (
    !Number.isSafeInteger(shipping) ||
    shipping < 0 ||
    shipping > 1_000_000_000
  ) {
    fail("SHIPPING_FEE باید عدد صحیح و غیرمنفی معتبر باشد.");
  }

  if (
    Boolean(E.TURNSTILE_SITE_KEY) !==
    Boolean(E.TURNSTILE_SECRET_KEY)
  ) {
    fail("هر دو کلید Turnstile را تنظیم کن یا هر دو را خالی بگذار.");
  }

  if (E.PUBLIC_URL) {
    let custom;

    try {
      custom = new URL(E.PUBLIC_URL);
    } catch {
      fail("PUBLIC_URL آدرس معتبر نیست.");
    }

    if (
      custom.protocol !== "https:" ||
      custom.username ||
      custom.password ||
      custom.search ||
      custom.hash ||
      custom.pathname !== "/"
    ) {
      fail("PUBLIC_URL باید فقط مبدأ HTTPS باشد؛ مثل https://shop.example.com");
    }
  }

  console.log("\n🔎 بررسی توکن ربات...");
  const bot = await telegram("getMe");

  await identifyAdmin(bot);

  if (!E.TELEGRAM_WEBHOOK_SECRET) {
    saveEnv(
      "TELEGRAM_WEBHOOK_SECRET",
      crypto.randomBytes(32).toString("hex")
    );
  }

  if (!/^[A-Za-z0-9_-]{32,256}$/.test(E.TELEGRAM_WEBHOOK_SECRET)) {
    fail("TELEGRAM_WEBHOOK_SECRET معتبر نیست؛ آن را خالی کن تا دوباره ساخته شود.");
  }

  const accountId = await identifyCloudflareAccount();

  fs.mkdirSync(".deploy", { recursive: true });

  const defaults = {
    store_name: E.STORE_NAME || "ویترین",
    store_description: E.STORE_DESCRIPTION || "فروشگاه آنلاین شما",
    hero_title: E.HERO_TITLE || "انتخاب‌هایی برای بهتر زندگی کردن.",
    hero_subtitle: E.HERO_SUBTITLE || "محصولات منتخب را کشف کنید.",
    brand_color: brand,
    contact_phone: E.CONTACT_PHONE || "",
    contact_telegram: (E.CONTACT_TELEGRAM || "").replace(/^@/, ""),
    instagram_url: E.INSTAGRAM_URL || "",
    shipping_fee: String(shipping)
  };

  const config = {
    name: project,
    account_id: accountId,
    main: "src/worker.js",
    compatibility_date: "2025-04-01",
    workers_dev: true,
    vars: {
      DEFAULTS_JSON: JSON.stringify(defaults),
      TURNSTILE_SITE_KEY: E.TURNSTILE_SITE_KEY || ""
    },
    triggers: {
      crons: ["*/10 * * * *"]
    }
  };

  const writeConfig = () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify(config, null, 2)
    );
  };

  writeConfig();

  console.log("\n🗄️ بررسی دیتابیس...");

  const dbName = project + "-db";

  async function listDatabases() {
    const result = await wrangler(
      ["d1", "list", "--json", ...configArgs],
      { capture: true }
    );

    const parsed = parseJsonOutput(result.stdout);

    if (!Array.isArray(parsed)) {
      fail("فهرست دیتابیس‌ها ساختار مورد انتظار را ندارد.");
    }

    return parsed;
  }

  let databases = await listDatabases();
  let database = databases.find(item => item.name === dbName);

  if (!database) {
    await wrangler([
      "d1", "create", dbName,
      ...configArgs
    ]);

    for (let attempt = 0; attempt < 6; attempt++) {
      databases = await listDatabases();
      database = databases.find(item => item.name === dbName);

      if (database) break;
      await sleep(1500);
    }
  }

  const databaseId = database?.uuid || database?.id;

  if (!databaseId) {
    fail("دیتابیس پیدا نشد. کمی بعد فایل نصب را دوباره اجرا کن.");
  }

  config.d1_databases = [{
    binding: "DB",
    database_name: dbName,
    database_id: databaseId
  }];

  writeConfig();

  await wrangler([
    "d1", "execute", dbName,
    "--remote",
    "--file", "schema.sql",
    "--yes",
    ...configArgs
  ]);

  if (E.SEED_DEMO === "true") {
    const samples = [
      {
        id: "demo-ceramic",
        title: "گلدان سرامیکی آوا",
        description: "محصول نمونه برای نمایش ظاهر فروشگاه. پیش از فروش واقعی، مشخصات و تصویر آن را تغییر بده.",
        category: "خانه و دکور",
        price: 485000,
        stock: 12,
        specs: {
          "جنس": "سرامیک",
          "ارتفاع": "۲۴ سانتی‌متر",
          "رنگ": "کرم"
        }
      },
      {
        id: "demo-light",
        title: "چراغ رومیزی هاله",
        description: "محصول نمونه با نور گرم و طراحی مینیمال.",
        category: "روشنایی",
        price: 1290000,
        stock: 7,
        specs: {
          "رنگ نور": "آفتابی",
          "جنس بدنه": "فلز"
        }
      },
      {
        id: "demo-bag",
        title: "کیف روزمره رُستا",
        description: "محصول نمونه برای روزهای پررفت‌وآمد.",
        category: "سبک زندگی",
        price: 790000,
        stock: 9,
        specs: {
          "جنس": "پارچه",
          "ابعاد": "۳۵ × ۳۰ سانتی‌متر"
        }
      }
    ];

    const select = samples.map(p => `
      SELECT
        ${quoteSql(p.id)},
        ${quoteSql(p.title)},
        ${quoteSql(p.description)},
        ${quoteSql(p.category)},
        ${p.price},
        ${p.stock},
        ${quoteSql(JSON.stringify(p.specs))},
        1
    `).join(" UNION ALL ");

    const seedFile = path.join(".deploy", "seed.sql");

    fs.writeFileSync(seedFile, `
      INSERT OR IGNORE INTO products
      (id, title, description, category, price, stock, specs, active)
      SELECT * FROM (${select})
      WHERE NOT EXISTS (SELECT 1 FROM products);
    `);

    await wrangler([
      "d1", "execute", dbName,
      "--remote",
      "--file", seedFile,
      "--yes",
      ...configArgs
    ]);
  }

  console.log(`
🚀 انتشار اولیه فروشگاه...

اگر Cloudflare برای اولین استفاده نام زیردامنه workers.dev خواست،
یک نام انگلیسی انتخاب کن. این مرحله معمولاً فقط بار اول لازم است.
`);

  // اجرای تعاملی برای پیام‌های احتمالی اولین انتشار.
  await wrangler(["deploy", ...configArgs]);

  console.log("\n🔐 ذخیره کلیدها در Cloudflare Secrets...");

  const secrets = {
    TELEGRAM_BOT_TOKEN: E.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ADMIN_IDS: E.TELEGRAM_ADMIN_IDS,
    TELEGRAM_WEBHOOK_SECRET: E.TELEGRAM_WEBHOOK_SECRET,
    TURNSTILE_SECRET_KEY: E.TURNSTILE_SECRET_KEY || ""
  };

  await wrangler(
    ["secret", "bulk", ...configArgs],
    {
      input: JSON.stringify(secrets),
      capture: true
    }
  );

  // انتشار نهایی با خروجی قابل پردازش برای دریافت آدرس.
  // انتشار اول تعاملی بود تا راه‌اندازی اولیه حساب مسدود نشود.
  const deployment = await wrangler(
    ["deploy", ...configArgs],
    { capture: true }
  );

  console.log(deployment.stdout);

  if (deployment.stderr) {
    console.log(deployment.stderr);
  }

  const urls = deployment.stdout.match(
    /https:\/\/[a-z0-9.-]+\.workers\.dev\b/gi
  ) || [];

  const detected = urls.find(value =>
    new URL(value).hostname.startsWith(project + ".")
  );

  const publicUrl = E.PUBLIC_URL
    ? new URL(E.PUBLIC_URL).origin
    : detected;

  if (!publicUrl) {
    fail(
      "آدرس عمومی فروشگاه از خروجی انتشار پیدا نشد.\n" +
      "اگر workers.dev غیرفعال است، آن را در پنل فعال کن و دوباره اجرا کن."
    );
  }

  console.log("\n🩺 بررسی آماده‌بودن سایت...");

  let ready = false;

  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const response = await fetch(
        publicUrl + "/api/health",
        { signal: AbortSignal.timeout(10000) }
      );

      const result = await response.json();

      if (response.ok && result.ready) {
        ready = true;
        break;
      }
    } catch {}

    await sleep(2500);
  }

  if (!ready) {
    fail(
      "انتشار انجام شد، اما بررسی سلامت هنوز موفق نیست.\n" +
      "دسترسی workers.dev، تنظیمات دامنه و شبکه را بررسی و دوباره اجرا کن."
    );
  }

  console.log("\n🔗 اتصال webhook تلگرام...");

  await telegram("setWebhook", {
    url: publicUrl + "/api/telegram",
    secret_token: E.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
    max_connections: 1
  });

  await telegram("setMyCommands", {
    commands: [
      { command: "start", description: "مدیریت فروشگاه" },
      { command: "cancel", description: "لغو عملیات جاری" }
    ]
  });

  const hook = await telegram("getWebhookInfo");

  if (hook.url !== publicUrl + "/api/telegram") {
    fail("آدرس webhook با فروشگاه تطابق ندارد.");
  }

  const admins = E.TELEGRAM_ADMIN_IDS
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  for (const admin of admins) {
    try {
      await telegram("sendMessage", {
        chat_id: admin,
        text:
          "🎉 فروشگاه آماده شد!\n\n" +
          publicUrl +
          "\n\nبرای مدیریت محصولات، نوشته‌ها و سفارش‌ها /start را بفرست.",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🌐 مشاهده فروشگاه", url: publicUrl }]
          ]
        }
      });
    } catch {
      console.log(
        `⚠️ ارسال پیام به مدیر ${admin} ممکن نشد؛ این مدیر باید ابتدا ربات را Start کند.`
      );
    }
  }

  fs.writeFileSync(
    path.join(".deploy", "result.json"),
    JSON.stringify({
      url: publicUrl,
      bot: `https://t.me/${bot.username}`,
      database: dbName,
      deployedAt: new Date().toISOString()
    }, null, 2)
  );

  console.log(`
═══════════════════════════════════════
✅ فروشگاه با موفقیت راه‌اندازی شد

🌐 سایت:
${publicUrl}

🤖 مدیریت:
https://t.me/${bot.username}

برای مدیریت در تلگرام /start را بفرست.
═══════════════════════════════════════
`);

  openUrl(publicUrl);
}

function englishError(error) {
  const message = String(error?.message || error || "Unknown error");

  const translations = [
    [
      /Node\.js 22/,
      "Node.js 22 or newer is required. Run the installer using start.cmd."
    ],
    [
      /فایل \.env پیدا نشد/,
      "The .env file was not found in the project folder."
    ],
    [
      /Wrangler نصب نشده/,
      "Wrangler is not installed. Run start.cmd to install dependencies."
    ],
    [
      /توکن ربات وارد نشده/,
      "TELEGRAM_BOT_TOKEN is missing or has an invalid format. Copy the complete token from BotFather into .env."
    ],
    [
      /توکن ربات معتبر نیست/,
      "Telegram rejected the bot token. Check TELEGRAM_BOT_TOKEN in .env."
    ],
    [
      /اتصال به API تلگرام/,
      "Could not connect to the Telegram API. Check your internet connection and access to api.telegram.org."
    ],
    [
      /پاسخ تلگرام معتبر نبود/,
      "Telegram returned an invalid response. Check your connection and try again."
    ],
    [
      /تلگرام درخواست/,
      "Telegram rejected an API request. Check the bot configuration and try again."
    ],
    [
      /TELEGRAM_ADMIN_IDS باید/,
      "TELEGRAM_ADMIN_IDS must contain numeric IDs separated by English commas."
    ],
    [
      /از قبل webhook دارد/,
      "This bot already has a webhook. Use a new bot, or set TELEGRAM_ADMIN_IDS manually. The existing webhook was not removed."
    ],
    [
      /انتخاب مدیر تأیید نشد/,
      "Administrator selection was not confirmed. Installation stopped without changing the webhook."
    ],
    [
      /زمان شناسایی مدیر/,
      "Administrator detection timed out. Run start.cmd again and press Start using the Telegram link opened by the installer."
    ],
    [
      /TELEGRAM_WEBHOOK_SECRET معتبر نیست/,
      "TELEGRAM_WEBHOOK_SECRET is invalid. Set it to an empty value in .env and run the installer again."
    ],
    [
      /PROJECT_NAME باید/,
      "PROJECT_NAME must be 3-41 characters long, start with a lowercase English letter, and contain only lowercase English letters, numbers, or hyphens."
    ],
    [
      /رنگ را داخل کوتیشن/,
      'BRAND_COLOR is invalid. Use a quoted HEX color, for example: BRAND_COLOR="#166454".'
    ],
    [
      /SHIPPING_FEE باید/,
      "SHIPPING_FEE must be a non-negative whole number within the allowed range."
    ],
    [
      /هر دو کلید Turnstile/,
      "Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or leave both empty."
    ],
    [
      /PUBLIC_URL آدرس معتبر نیست/,
      "PUBLIC_URL is not a valid URL."
    ],
    [
      /PUBLIC_URL باید/,
      "PUBLIC_URL must be an HTTPS origin without a path, query, or fragment. Example: https://shop.example.com"
    ],
    [
      /CLOUDFLARE_ACCOUNT_ID با/,
      "CLOUDFLARE_ACCOUNT_ID does not match the currently logged-in accounts. Clear it in .env or log in to the correct Cloudflare account."
    ],
    [
      /شناسه حساب از خروجی/,
      "Could not detect a Cloudflare account ID from Wrangler output. Complete account setup and check the Wrangler output above."
    ],
    [
      /انتخاب حساب معتبر نیست/,
      "Invalid Cloudflare account selection. Enter one of the listed account numbers."
    ],
    [
      /خروجی JSON ابزار Wrangler/,
      "Could not parse Wrangler JSON output. The CLI output format may have changed."
    ],
    [
      /فهرست دیتابیس‌ها/,
      "Wrangler returned an unexpected database list format."
    ],
    [
      /دیتابیس پیدا نشد/,
      "The database could not be found after creation. Wait briefly and run the installer again."
    ],
    [
      /اجرای Wrangler ناموفق/,
      "A Wrangler command failed. Read the Cloudflare/Wrangler error printed above this message."
    ],
    [
      /آدرس عمومی فروشگاه/,
      "Could not detect the public workers.dev URL. Check that workers.dev is enabled, then run the installer again."
    ],
    [
      /بررسی سلامت هنوز موفق نیست/,
      "Deployment finished, but the health check failed. Check workers.dev availability, PUBLIC_URL, and your network connection."
    ],
    [
      /آدرس webhook با/,
      "The Telegram webhook URL does not match the deployed storefront URL."
    ],
    [
      /فقط آدرس HTTPS/,
      "Only HTTPS URLs are allowed."
    ]
  ];

  for (const [pattern, translation] of translations) {
    if (pattern.test(message)) return translation;
  }

  // Keep native English errors, such as filesystem errors.
  if (!/[\u0600-\u06FF]/.test(message)) {
    return message;
  }

  return "An unexpected deployment error occurred. See .deploy/error-details.txt for the original details.";
}

main().catch(error => {
  const message = englishError(error);

  // Do not include known secrets in the saved error report.
  const sensitiveValues = [
    E.TELEGRAM_BOT_TOKEN,
    E.TELEGRAM_WEBHOOK_SECRET,
    E.TURNSTILE_SECRET_KEY,
    E.CLOUDFLARE_API_TOKEN
  ].filter(Boolean);

  let details = String(error?.stack || error?.message || error);

  for (const value of sensitiveValues) {
    details = details.split(value).join("[REDACTED]");
  }

  let reportSaved = false;

  try {
    fs.mkdirSync(".deploy", { recursive: true });

    fs.writeFileSync(
      ".deploy/error-details.txt",
      [
        `Time: ${new Date().toISOString()}`,
        `Node.js: ${process.version}`,
        `Platform: ${process.platform}`,
        `Architecture: ${process.arch}`,
        "",
        `English summary: ${message}`,
        "",
        "Original error:",
        details
      ].join("\n"),
      "utf8"
    );

    reportSaved = true;
  } catch {
    // A logging failure must not hide the installation error.
  }

  console.error("\n=========================================");
  console.error("DEPLOYMENT FAILED");
  console.error("=========================================");
  console.error(message);

  if (reportSaved) {
    console.error("\nError report: .deploy/error-details.txt");
  }

  console.error("Full installation output: install.log");
  console.error("=========================================\n");

  process.exitCode = 1;
});