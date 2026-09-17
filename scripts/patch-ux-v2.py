from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path.cwd()
MARKER = "STORE_UX_PATCH_V1"


def fail(msg):
    raise SystemExit("ERROR: " + msg)


def once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        fail(f"{label}: expected 1 match, found {n}")
    return text.replace(old, new, 1)


def ensure(text, needle, label):
    if needle not in text:
        fail(label + ": missing expected code")


if not (ROOT / "package.json").exists():
    fail("Run from project root")

files = {
    "src/defaults.js": None,
    "src/bot.js": None,
    "src/media.js": None,
    "src/worker.js": None,
    "src/storefront.js": None,
    "src/orders.js": None,
}

for name in files:
    p = ROOT / name
    if not p.exists():
        fail("Missing " + name)
    files[name] = p.read_text(encoding="utf-8")

if all(MARKER in files[n] for n in files):
    print("Patch already applied.")
    raise SystemExit(0)

if any(MARKER in files[n] for n in files):
    fail("Partial patch detected. Restore backup first.")

# --------------------------------------------------------------------------
# defaults.js — brand ink mode + no structural change beyond settings
# --------------------------------------------------------------------------
d = files["src/defaults.js"]
d = once(
    d,
    'brand_color: ["رنگ برند", "color", "#637c68"],',
    'brand_color: ["رنگ برند", "color", "#637c68"],\n'
    '  brand_ink: ["رنگ متن روی دکمه‌های برند", "brandInk", "white"],',
    "brand_ink setting",
)
# parseSetting brandInk
if 'if (type === "theme")' in d and 'brandInk' not in d:
    d = once(
        d,
        'if (type === "theme") {\n'
        '    if (!["light", "dark"].includes(value)) {\n'
        '      throw new Error("Allowed values: light, dark.");\n'
        '    }\n'
        '    return value;\n'
        '  }',
        'if (type === "theme") {\n'
        '    if (!["light", "dark"].includes(value)) {\n'
        '      throw new Error("Allowed values: light, dark.");\n'
        '    }\n'
        '    return value;\n'
        '  }\n\n'
        '  if (type === "brandInk") {\n'
        '    // white = light text on dark/strong brand color\n'
        '    // black = dark text on light/soft brand color\n'
        '    if (!["white", "black"].includes(value)) {\n'
        '      throw new Error("Allowed values: white, black.");\n'
        '    }\n'
        '    return value;\n'
        '  }',
        "brandInk parser",
    )
d = f"// {MARKER}\n" + d
files["src/defaults.js"] = d

# --------------------------------------------------------------------------
# media.js — accept PNG/JPEG/WebP documents for images (logo etc.)
# --------------------------------------------------------------------------
m = files["src/media.js"]
old_save = '''export async function saveAdminMedia(env, message, kind) {
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
  }'''

new_save = '''export async function saveAdminMedia(env, message, kind) {
  let file = null;
  let expect = kind;

  if (kind === "photo") {
    // Prefer Photo; also accept image Documents (PNG with transparency).
    if (message.photo?.length) {
      file = message.photo.at(-1);
    } else if (message.document) {
      file = message.document;
    }
  } else {
    file = message.document || null;
  }

  if (!file) {
    throw new Error(
      kind === "photo"
        ? "Send an image as Photo, or as a PNG/JPEG/WebP Document."
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
    throw new Error(
      kind === "photo"
        ? "Unsupported image. Use PNG, JPEG or WebP."
        : "Unsupported or invalid media signature."
    );
  }

  // Documents claimed as fonts must not be stored as photos and vice versa.
  if (kind === "photo" && !String(mime).startsWith("image/")) {
    throw new Error("Unsupported image. Use PNG, JPEG or WebP.");
  }
  if (kind === "font" && !String(mime).startsWith("font/")) {
    throw new Error("Unsupported font file.");
  }'''

m = once(m, old_save, new_save, "saveAdminMedia images-as-document")
m = f"// {MARKER}\n" + m
files["src/media.js"] = m

# --------------------------------------------------------------------------
# bot.js — product original_price, brand ink help, force /start menu
# --------------------------------------------------------------------------
b = files["src/bot.js"]

# original_price field on products
if "original_price" not in b:
    b = once(
        b,
        'price: ["قیمت پایه، تومان", "integer"],\n',
        'price: ["قیمت فروش، تومان", "integer"],\n'
        '      original_price: ["قیمت قبلی برای نمایش تخفیف؛ خط تیره = بدون تخفیف", "originalPrice"],\n',
        "product discount field",
    )

# parse originalPrice in parseRecordValue — inject near integer branch
if 'type === "originalPrice"' not in b:
    b = once(
        b,
        'if (type === "integer") {\n    return integer(value);\n  }',
        'if (type === "integer") {\n    return integer(value);\n  }\n\n'
        '  if (type === "originalPrice") {\n'
        '    if (!value) return null;\n'
        '    return integer(value);\n'
        '  }',
        "originalPrice parser",
    )

# After updating price/original_price validate relationship
if "original_price validation" not in b:
    b = once(
        b,
        'const value = parseRecordValue(spec, input);\n\n  if (kind === "d") {',
        'const value = parseRecordValue(spec, input);\n\n'
        '  if (kind === "p" && (field === "price" || field === "original_price")) {\n'
        '    const nextPrice = field === "price" ? value : record.price;\n'
        '    const nextOriginal = field === "original_price" ? value : record.original_price;\n'
        '    if (nextOriginal != null && Number(nextOriginal) < Number(nextPrice)) {\n'
        '      throw new Error("Original/compare price must be >= selling price, or empty.");\n'
        '    }\n'
        '  }\n\n  if (kind === "d") {',
        "original_price validation",
    )

# displayField for original_price
if 'field === "original_price"' not in b:
    b = once(
        b,
        'if (field === "expires_at") {',
        'if (field === "original_price") {\n'
        '    return value == null || value === "" ? "بدون تخفیف نمایشی" : value;\n'
        '  }\n\n'
        '  if (field === "expires_at") {',
        "display original_price",
    )

# brand ink setting prompt text via settings help
b = once(
    b,
    '"Turnstile فقط بعد از تنظیم کلید عمومی و Secret زیرساخت فعال شود.",',
    '"Turnstile فقط بعد از تنظیم کلید عمومی و Secret زیرساخت فعال شود.\\n" +\n'
    '    "رنگ برند: بعد از انتخاب رنگ، «رنگ متن روی دکمه‌های برند» را هم تنظیم کنید.\\n" +\n'
    '    "اگر رنگ برند پررنگ/تیره است: white\\n" +\n'
    '    "اگر رنگ برند کمرنگ/روشن است: black\\n" +\n'
    '    "لوگو را Photo یا Document شفاف PNG بفرستید.",',
    "settings help brand/logo",
)

# Force fresh panel on /start
old_start = '''if (["start", "cancel", "menu"].includes(command)) {
          await showHome(env, adminId);
          return;
        }'''
new_start = '''if (["start", "cancel", "menu"].includes(command)) {
          // Always rebuild the home panel for /start.
          await execute(env,
            "DELETE FROM bot_panels WHERE admin_id=?",
            [adminId]
          );
          await clearSession(env, adminId);
          await showHome(env, adminId);
          return;
        }'''
if old_start in b:
    b = once(b, old_start, new_start, "force start menu")
else:
    # try looser match
    if "await showHome(env, adminId);" not in b:
        fail("Could not patch /start handler")

b = f"// {MARKER}\n" + b
files["src/bot.js"] = b

# --------------------------------------------------------------------------
# orders.js — track by code+phone
# --------------------------------------------------------------------------
o = files["src/orders.js"]
if "export async function trackOrder" not in o:
    o += '''

export async function trackOrder(request, env) {
  requireOrigin(request);
  await rateLimit(env, ipKey(request, "track"), 20, 600);

  const body = await readJSON(request, 4000);
  const code = String(body?.code || "").trim().toUpperCase();
  const phone = digits(String(body?.phone || "")).replace(/\\s/g, "");

  if (!/^S-[A-Z0-9]{8,20}$/.test(code) && !/^[A-Z0-9-]{6,32}$/.test(code)) {
    throw new AppError(400, "Enter a valid order code.");
  }
  if (!/^09\\d{9}$/.test(phone)) {
    throw new AppError(400, "Enter the mobile number used for the order.");
  }

  const order = await one(
    env,
    "SELECT code,status,payment_status,payment_method,total,created_at,paid_at,expires_at " +
    "FROM orders WHERE code=? AND phone=?",
    [code, phone]
  );

  // Same message whether missing or mismatch — avoid account enumeration detail.
  if (!order) {
    throw new AppError(404, "Order not found. Check the code and mobile number.");
  }

  return {
    code: order.code,
    status: order.status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    total: order.total,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    expiresAt: order.expires_at
  };
}
'''
o = f"// {MARKER}\n" + o
files["src/orders.js"] = o

# --------------------------------------------------------------------------
# worker.js — track endpoint + product fields
# --------------------------------------------------------------------------
w = files["src/worker.js"]
w = once(
    w,
    "createOrder,\n  getPrivateOrder,\n  maintainOrders\n} from \"./orders.js\";",
    "createOrder,\n  getPrivateOrder,\n  trackOrder,\n  maintainOrders\n} from \"./orders.js\";",
    "import trackOrder",
)

# include original_price in list/detail
w = once(
    w,
    "p.price,\n      p.stock,\n      p.inventory_mode,",
    "p.price,\n      p.original_price,\n      p.stock,\n      p.inventory_mode,",
    "list original_price",
)

if "original_price: product.original_price" not in w and "originalPrice" not in w:
    w = once(
        w,
        "price: product.price,\n    stock: product.stock,",
        "price: product.price,\n"
        "    originalPrice: product.original_price,\n"
        "    stock: product.stock,",
        "detail originalPrice",
    )

# track route before generic order GET if needed
if "/api/track-order" not in w:
    w = once(
        w,
        'else if (request.method === "POST" && url.pathname === "/api/orders") {\n'
        '        const result = await createOrder(request, env, ctx);\n'
        '        response = responseJSON(result, 201);\n'
        '      }',
        'else if (request.method === "POST" && url.pathname === "/api/orders") {\n'
        '        const result = await createOrder(request, env, ctx);\n'
        '        response = responseJSON(result, 201);\n'
        '      }\n\n'
        '      else if (request.method === "POST" && url.pathname === "/api/track-order") {\n'
        '        response = responseJSON(await trackOrder(request, env));\n'
        '      }',
        "track-order route",
    )

w = f"// {MARKER}\n" + w
files["src/worker.js"] = w

# --------------------------------------------------------------------------
# storefront.js — CSS + JS UX changes
# --------------------------------------------------------------------------
s = files["src/storefront.js"]

# --- CSS patches inside template ---
s = once(
    s,
    ".brand-home{\n"
    " display:flex;flex-direction:column;align-items:center;\n"
    " justify-content:center;min-width:0;padding:9px 0;\n"
    " color:var(--text);\n"
    "}\n"
    ".brand-home:hover{text-decoration:none}\n"
    "#store-logo{width:135px;height:58px;object-fit:contain}\n"
    "#store-name{\n"
    " max-width:100%;overflow:hidden;text-overflow:ellipsis;\n"
    " white-space:nowrap;font-size:1.13rem;\n"
    "}\n"
    "#tagline{\n"
    " display:block;max-width:100%;\n"
    " text-overflow:ellipsis;overflow:hidden;white-space:nowrap;\n"
    " font-size:.7rem;color:var(--muted);\n"
    "}",
    ".brand-home{\n"
    " display:flex;flex-direction:row;align-items:center;\n"
    " justify-content:center;gap:10px;min-width:0;padding:9px 0;\n"
    " color:var(--text);\n"
    "}\n"
    ".brand-home:hover{text-decoration:none}\n"
    ".brand-text{min-width:0;text-align:center}\n"
    "#store-logo{\n"
    " width:auto;height:44px;max-width:72px;object-fit:contain;flex-shrink:0;\n"
    "}\n"
    "#store-name{\n"
    " max-width:100%;overflow:hidden;text-overflow:ellipsis;\n"
    " white-space:nowrap;font-size:1.05rem;display:block;\n"
    "}\n"
    "#tagline{\n"
    " display:block;max-width:100%;\n"
    " text-overflow:ellipsis;overflow:hidden;white-space:nowrap;\n"
    " font-size:.68rem;color:var(--muted);\n"
    "}",
    "logo beside name CSS",
)

s = once(
    s,
    ".slider-shell{\n"
    " position:relative;overflow:hidden;\n"
    " border-radius:30px;border:1px solid var(--line);\n"
    " background:var(--soft);aspect-ratio:2.55;\n"
    "}",
    ".slider-shell{\n"
    " position:relative;overflow:hidden;\n"
    " border-radius:30px;border:1px solid var(--line);\n"
    " background:var(--soft);aspect-ratio:2.55;\n"
    "}\n"
    ".slider-nav{\n"
    " position:absolute;top:50%;transform:translateY(-50%);\n"
    " z-index:5;width:38px;height:38px;min-height:38px;padding:0;\n"
    " border:0;border-radius:50%;\n"
    " background:#00000033;color:#fff;font-size:1.2rem;\n"
    " display:grid;place-items:center;opacity:.35;\n"
    " backdrop-filter:blur(2px);\n"
    " transition:opacity .18s,background .18s;\n"
    "}\n"
    ".slider-nav:hover,.slider-nav:focus-visible{opacity:.85;background:#00000055}\n"
    ".slider-nav.prev{right:10px}\n"
    ".slider-nav.next{left:10px}\n"
    ".slider-shell:hover .slider-nav{opacity:.55}",
    "overlay slider arrows CSS",
)

# hide old controls block usage via CSS
s = once(
    s,
    ".slider-controls{\n"
    " display:flex;align-items:center;justify-content:center;\n"
    " gap:9px;margin-top:12px;\n"
    "}",
    ".slider-controls{display:none!important}",
    "hide bottom slider controls",
)

s = once(
    s,
    ".category-image{\n"
    " width:clamp(80px,13vw,145px);aspect-ratio:1;\n"
    " border-radius:50%;object-fit:cover;\n"
    " background:var(--soft);margin-bottom:17px;\n"
    "}\n"
    ".category-placeholder{\n"
    " display:grid;place-items:center;font-size:2rem;color:var(--brand);\n"
    "}\n"
    ".category-name{\n"
    " width:100%;text-align:center;padding:7px 14px;\n"
    " border-radius:99px;background:var(--soft);\n"
    " font-size:.9rem;font-weight:600;overflow-wrap:anywhere;\n"
    "}",
    ".category-image{\n"
    " width:84px;height:84px;aspect-ratio:1/1;\n"
    " border-radius:50%;object-fit:cover;object-position:center;\n"
    " background:var(--soft);margin-bottom:10px;\n"
    " flex-shrink:0;\n"
    "}\n"
    ".category-placeholder{\n"
    " display:grid;place-items:center;font-size:1.4rem;color:var(--brand);\n"
    "}\n"
    ".category-name{\n"
    " width:auto;max-width:100%;text-align:center;padding:5px 12px;\n"
    " border-radius:99px;background:var(--soft);\n"
    " font-size:.78rem;font-weight:600;overflow-wrap:anywhere;\n"
    "}",
    "category circle size",
)

# mobile category size
if ".category-image{width:115px}" in s:
    s = once(s, ".category-image{width:115px}", ".category-image{width:76px;height:76px}", "mobile cat size")
if ".category-image{width:95px}" in s:
    s = once(s, ".category-image{width:95px}", ".category-image{width:70px;height:70px}", "tiny cat size")

s = once(
    s,
    "#toast{\n"
    " position:fixed;bottom:110px;left:50%;transform:translateX(-50%);\n"
    " z-index:100;background:var(--text);color:var(--bg);\n"
    " padding:12px 19px;border-radius:15px;\n"
    " width:max-content;max-width:calc(100% - 30px);\n"
    " text-align:center;font-size:.87rem;box-shadow:var(--shadow);\n"
    "}",
    "#toast{\n"
    " position:fixed!important;\n"
    " left:50%!important;\n"
    " bottom:calc(88px + env(safe-area-inset-bottom))!important;\n"
    " top:auto!important;\n"
    " right:auto!important;\n"
    " transform:translateX(-50%)!important;\n"
    " z-index:9999!important;\n"
    " background:var(--text);color:var(--bg);\n"
    " padding:12px 18px;border-radius:15px;\n"
    " width:max-content;max-width:min(420px, calc(100% - 28px));\n"
    " text-align:center;font-size:.87rem;box-shadow:var(--shadow);\n"
    " pointer-events:none;\n"
    "}",
    "toast position",
)

# discount badge css
if ".discount-badge" not in s:
    s = once(
        s,
        ".badge{\n"
        " position:absolute;top:10px;right:10px;\n"
        " background:var(--surface);padding:3px 10px;\n"
        " border-radius:99px;font-size:.7rem;\n"
        "}",
        ".badge{\n"
        " position:absolute;top:10px;right:10px;\n"
        " background:var(--surface);padding:3px 10px;\n"
        " border-radius:99px;font-size:.7rem;\n"
        "}\n"
        ".discount-badge{\n"
        " position:absolute;top:10px;left:10px;\n"
        " background:#e45757;color:#fff;\n"
        " padding:4px 9px;border-radius:99px;\n"
        " font-size:.72rem;font-weight:700;\n"
        "}\n"
        ".price-old{\n"
        " font-size:.78rem;color:var(--muted);\n"
        " text-decoration:line-through;margin-left:6px;\n"
        " font-weight:500;\n"
        "}",
        "discount badge css",
    )

# HTML logo structure
s = once(
    s,
    '<a href="/" class="brand-home" aria-label="صفحه اصلی فروشگاه">\n'
    '   <img id="store-logo" alt="لوگوی فروشگاه" hidden>\n'
    '   <strong id="store-name">فروشگاه</strong>\n'
    '   <small id="tagline"></small>\n'
    '  </a>',
    '<a href="/" class="brand-home" aria-label="صفحه اصلی فروشگاه">\n'
    '   <img id="store-logo" alt="لوگوی فروشگاه" hidden>\n'
    '   <span class="brand-text">\n'
    '    <strong id="store-name">فروشگاه</strong>\n'
    '    <small id="tagline"></small>\n'
    '   </span>\n'
    '  </a>',
    "logo html structure",
)

# slider HTML: arrows inside shell
s = once(
    s,
    '<div id="slider" class="slider-shell" role="region" aria-roledescription="اسلایدر" aria-label="بنرهای فروشگاه">\n'
    '   <div id="slides"></div>\n'
    '  </div>\n'
    '  <div id="slider-controls" class="slider-controls">\n'
    '   <button id="slide-prev" class="icon" aria-label="اسلاید قبلی">‹</button>\n'
    '   <div id="slider-dots" class="slider-dots"></div>\n'
    '   <button id="slide-next" class="icon" aria-label="اسلاید بعدی">›</button>\n'
    '   <button id="slide-pause" class="icon" aria-label="توقف حرکت خودکار" aria-pressed="false">Ⅱ</button>\n'
    '  </div>',
    '<div id="slider" class="slider-shell" role="region" aria-roledescription="اسلایدر" aria-label="بنرهای فروشگاه">\n'
    '   <div id="slides"></div>\n'
    '   <button id="slide-prev" class="slider-nav prev" aria-label="اسلاید قبلی">›</button>\n'
    '   <button id="slide-next" class="slider-nav next" aria-label="اسلاید بعدی">‹</button>\n'
    '  </div>\n'
    '  <div id="slider-controls" class="slider-controls" hidden>\n'
    '   <div id="slider-dots" class="slider-dots"></div>\n'
    '   <button id="slide-pause" class="icon" hidden aria-hidden="true">Ⅱ</button>\n'
    '  </div>',
    "slider overlay arrows html",
)

# track order UI in menu + footer area
if 'id="track-dialog"' not in s:
    s = once(
        s,
        '<button id="menu-contact" data-jump="contact-section">تماس با مدیر</button>\n'
        ' </div>\n'
        '</dialog>',
        '<button id="menu-contact" data-jump="contact-section">تماس با مدیر</button>\n'
        '  <button id="menu-track">پیگیری سفارش</button>\n'
        ' </div>\n'
        '</dialog>\n\n'
        '<dialog id="track-dialog" aria-labelledby="track-title">\n'
        ' <div class="dialog-head">\n'
        '  <h2 id="track-title">پیگیری سفارش</h2>\n'
        '  <button class="icon" data-close aria-label="بستن">×</button>\n'
        ' </div>\n'
        ' <div class="dialog-body form-grid">\n'
        '  <p class="small muted">کد پیگیری و همان شماره موبایلی که هنگام سفارش وارد کرده‌اید را بنویسید.</p>\n'
        '  <label>کد پیگیری\n'
        '   <input id="track-code" maxlength="40" dir="ltr" autocomplete="off" placeholder="S-XXXXXXXXXXXX">\n'
        '  </label>\n'
        '  <label>شماره موبایل سفارش\n'
        '   <input id="track-phone" maxlength="20" type="tel" inputmode="tel" dir="ltr" placeholder="09123456789">\n'
        '  </label>\n'
        '  <div id="track-error" class="error" role="alert"></div>\n'
        '  <div id="track-result" class="panel" hidden></div>\n'
        '  <button id="track-submit" class="primary wide">مشاهده وضعیت</button>\n'
        ' </div>\n'
        '</dialog>',
        "track dialog",
    )

if 'id="footer-track"' not in s:
    s = once(
        s,
        '<button id="last-order-button" class="small" hidden>مشاهده آخرین سفارش این دستگاه</button>',
        '<button id="footer-track" class="small">پیگیری سفارش با کد</button>\n'
        '  <button id="last-order-button" class="small" hidden>مشاهده آخرین سفارش این دستگاه</button>',
        "footer track button",
    )

# JS: brand ink
s = once(
    s,
    "function applyBrand(color) {\n"
    "  const value = /^#[a-f0-9]{6}$/i.test(color || \"\") ? color : \"#637c68\";\n"
    "  document.documentElement.style.setProperty(\"--brand\", value);\n\n"
    "  const rgb = [1, 3, 5].map(start => {\n"
    "    const channel = parseInt(value.slice(start, start + 2), 16) / 255;\n"
    "    return channel <= 0.04045\n"
    "      ? channel / 12.92\n"
    "      : Math.pow((channel + 0.055) / 1.055, 2.4);\n"
    "  });\n\n"
    "  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;\n"
    "  document.documentElement.style.setProperty(\n"
    "    \"--brand-ink\",\n"
    "    luminance > 0.179 ? \"#101912\" : \"#ffffff\"\n"
    "  );\n"
    "  document.querySelector('meta[name=\"theme-color\"]').content = value;\n"
    "}",
    "function applyBrand(color, inkMode) {\n"
    "  const value = /^#[a-f0-9]{6}$/i.test(color || \"\") ? color : \"#637c68\";\n"
    "  document.documentElement.style.setProperty(\"--brand\", value);\n\n"
    "  let ink;\n"
    "  if (inkMode === \"white\") ink = \"#ffffff\";\n"
    "  else if (inkMode === \"black\") ink = \"#101912\";\n"
    "  else {\n"
    "    const rgb = [1, 3, 5].map(start => {\n"
    "      const channel = parseInt(value.slice(start, start + 2), 16) / 255;\n"
    "      return channel <= 0.04045\n"
    "        ? channel / 12.92\n"
    "        : Math.pow((channel + 0.055) / 1.055, 2.4);\n"
    "    });\n"
    "    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;\n"
    "    ink = luminance > 0.179 ? \"#101912\" : \"#ffffff\";\n"
    "  }\n\n"
    "  document.documentElement.style.setProperty(\"--brand-ink\", ink);\n"
    "  document.querySelector('meta[name=\"theme-color\"]').content = value;\n"
    "}",
    "applyBrand ink mode",
)

# applyBootstrap brand call
s = once(
    s,
    "applyBrand(S.brand_color);",
    "applyBrand(S.brand_color, S.brand_ink || \"white\");",
    "bootstrap brand ink",
)

# discount helpers + product card render — find product card price section
# Add helper before render if missing
if "function discountInfo" not in s:
    s = once(
        s,
        "function selectionText(selection) {",
        "function discountInfo(price, original) {\n"
        "  const p = Number(price);\n"
        "  const o = original == null || original === \"\" ? null : Number(original);\n"
        "  if (!Number.isFinite(p) || !Number.isFinite(o) || o <= p || o <= 0) {\n"
        "    return null;\n"
        "  }\n"
        "  const percent = Math.round((1 - (p / o)) * 100);\n"
        "  if (percent < 1) return null;\n"
        "  return { original: o, percent: Math.min(percent, 99) };\n"
        "}\n\n"
        "function selectionText(selection) {",
        "discountInfo helper",
    )

# product card badges and price - fragile; try common pattern
old_card_price = (
    "'<div class=\"price\">' +\n"
    "            (product.inventory_mode === \"variants\" ? '<small>قیمت پایه: </small>' : \"\") +\n"
    "            fa(product.price) + \" <small>تومان</small></div></div></button>\" +"
)
new_card_price = (
    "'<div class=\"price\">' +\n"
    "            (product.inventory_mode === \"variants\" ? '<small>قیمت پایه: </small>' : \"\") +\n"
    "            fa(product.price) + \" <small>تومان</small>\" +\n"
    "            (discountInfo(product.price, product.original_price)\n"
    "              ? '<span class=\"price-old\">' + fa(product.original_price) + \"</span>\"\n"
    "              : \"\") +\n"
    "            \"</div></div></button>\" +"
)

if old_card_price in s:
    s = once(s, old_card_price, new_card_price, "card discount price")

old_badge = (
    "(unavailable ? '<span class=\"badge\">ناموجود</span>' : \"\") + \"</div>\" +"
)
new_badge = (
    "(unavailable ? '<span class=\"badge\">ناموجود</span>' : \"\") +\n"
    "            (discountInfo(product.price, product.original_price)\n"
    "              ? '<span class=\"discount-badge\">' + fa(discountInfo(product.price, product.original_price).percent) + \"٪</span>\"\n"
    "              : \"\") +\n"
    "            \"</div>\" +"
)
if old_badge in s:
    s = once(s, old_badge, new_badge, "card discount badge")

# detail price with original
if "detail-original" not in s and "$(\"detail-price\")" in s:
    s = once(
        s,
        '$("detail-price").textContent = selected\n'
        '    ? money(selected.price)\n'
        '    : "قیمت پایه: " + money(product.price);',
        'const baseDisc = discountInfo(product.price, product.originalPrice);\n'
        '  const selectedDisc = selected\n'
        '    ? discountInfo(selected.price, product.originalPrice)\n'
        '    : baseDisc;\n'
        '  const shown = selected ? selected.price : product.price;\n'
        '  const disc = selected ? selectedDisc : baseDisc;\n'
        '  $("detail-price").innerHTML =\n'
        '    (selected ? "" : \'<small>قیمت پایه: </small>\') +\n'
        '    escapeHTML(money(shown)) +\n'
        '    (disc ? \' <span class="price-old">\' + escapeHTML(fa(disc.original)) + " تومان</span>" +\n'
        '      \' <span class="discount-badge" style="position:static;display:inline-block;margin-right:6px">\' +\n'
        '      escapeHTML(fa(disc.percent)) + "٪</span>\" : \"\");',
        "detail discount price",
    )

# track JS
if "track-submit" not in s.split("footer-track")[0] or "track-submit" not in s:
    # append track handlers before initializeStore()
    track_js = r'''
const TRACK_STATUS = {
  new: "ثبت اولیه",
  confirmed: "تأیید شده",
  sent: "ارسال شده",
  cancelled: "لغو شده"
};
const TRACK_PAY = {
  unpaid: "پرداخت تأیید نشده",
  review: "رسید در حال بررسی",
  paid: "پرداخت تأیید شده"
};

function openTrackDialog() {
  $("track-error").textContent = "";
  $("track-result").hidden = true;
  showDialog($("track-dialog"));
}

$("footer-track").onclick = openTrackDialog;
$("menu-dialog").addEventListener("click", event => {
  if (event.target && event.target.id === "menu-track") {
    openTrackDialog();
  }
});

$("track-submit").onclick = async () => {
  $("track-error").textContent = "";
  $("track-result").hidden = true;
  $("track-submit").disabled = true;
  try {
    const result = await api("/api/track-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: $("track-code").value,
        phone: $("track-phone").value
      })
    });
    $("track-result").hidden = false;
    $("track-result").innerHTML =
      "<p><strong>کد:</strong> " + escapeHTML(result.code) + "</p>" +
      "<p><strong>وضعیت سفارش:</strong> " + escapeHTML(TRACK_STATUS[result.status] || result.status) + "</p>" +
      "<p><strong>وضعیت پرداخت:</strong> " + escapeHTML(TRACK_PAY[result.paymentStatus] || result.paymentStatus) + "</p>" +
      "<p><strong>مبلغ:</strong> " + escapeHTML(money(result.total)) + "</p>" +
      "<p class=\"small muted\">تاریخ ثبت: " +
      escapeHTML(new Date(result.createdAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })) +
      "</p>" +
      (result.expiresAt && result.paymentStatus === "unpaid"
        ? "<p class=\"small\">مهلت پرداخت: " +
          escapeHTML(new Date(result.expiresAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })) +
          "</p>"
        : "") +
      "<p class=\"small muted\">برای جزئیات بیشتر با مدیر فروشگاه هماهنگ کنید.</p>";
  } catch (error) {
    $("track-error").textContent = error.message;
  } finally {
    $("track-submit").disabled = false;
  }
};

'''
    if "openTrackDialog" not in s:
        s = once(
            s,
            "updateCartBadge();\ninitializeStore();",
            track_js + "\nupdateCartBadge();\ninitializeStore();",
            "track handlers",
        )

# sliderPaused default false already; ensure autoplay default true when missing
# slide-pause may be null-safe
s = s.replace(
    '$("slide-pause").hidden = !autoAllowed || sliderItems.length < 2;',
    'if ($("slide-pause")) $("slide-pause").hidden = true;',
)
s = s.replace(
    '$("slide-pause").textContent = sliderPaused ? "▶" : "Ⅱ";\n'
    '  $("slide-pause").setAttribute(\n'
    '    "aria-label", sliderPaused ? "ادامه حرکت خودکار" : "توقف حرکت خودکار"\n'
    '  );\n'
    '  $("slide-pause").setAttribute("aria-pressed", String(sliderPaused));',
    '// pause control removed from UI; autoplay stays on unless user uses arrows (temporary pause)',
)

# Clicking arrows briefly pauses then resumes after a few cycles — keep pause on arrow as now (sliderPaused=true). 
# User asked default play — reset pause after timeout:
if "resume autoplay after arrow" not in s:
    s = once(
        s,
        '$("slide-prev").onclick = () => {\n'
        '  sliderPaused = true;\n'
        '  showSlide(sliderIndex - 1);\n'
        '};\n'
        '$("slide-next").onclick = () => {\n'
        '  sliderPaused = true;\n'
        '  showSlide(sliderIndex + 1);\n'
        '};',
        '$("slide-prev").onclick = () => {\n'
        '  sliderPaused = true;\n'
        '  showSlide(sliderIndex - 1);\n'
        '  setTimeout(() => { sliderPaused = false; updateSliderTimer(); }, 8000);\n'
        '};\n'
        '$("slide-next").onclick = () => {\n'
        '  sliderPaused = true;\n'
        '  showSlide(sliderIndex + 1);\n'
        '  setTimeout(() => { sliderPaused = false; updateSliderTimer(); }, 8000);\n'
        '};\n'
        '// resume autoplay after arrow',
        "arrow resume autoplay",
    )

# hide arrows when single slide — in showSlide/renderSlider
if 'slide-prev").hidden' not in s:
    s = once(
        s,
        '$("slider-controls").hidden = sliderItems.length < 2;\n  showSlide(0);',
        'const many = sliderItems.length > 1;\n'
        '  $("slider-controls").hidden = true;\n'
        '  $("slide-prev").hidden = !many;\n'
        '  $("slide-next").hidden = !many;\n'
        '  showSlide(0);',
        "hide arrows single slide",
    )

s = f"// {MARKER}\n" + s
files["src/storefront.js"] = s

# --------------------------------------------------------------------------
# write + validate
# --------------------------------------------------------------------------
backup = Path(tempfile.mkdtemp(prefix="store-ux-patch-"))
for name, content in files.items():
    dest = backup / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / name, dest)

print("Backup:", backup)

try:
    for name, content in files.items():
        (ROOT / name).write_text(content, encoding="utf-8")

    for name in files:
        subprocess.run(["node", "--check", str(ROOT / name)], check=True)

    subprocess.run(["npm", "run", "check"], cwd=ROOT, check=True)
except Exception as e:
    for name, content in files.items():
        # restore from backup
        shutil.copy2(backup / name, ROOT / name)
    fail("Validation failed, files restored. " + str(e))

print("UX patch applied.")
print("Next: npm run setup   # applies migration 0003 + deploy")
print("Then open bot and send /start")