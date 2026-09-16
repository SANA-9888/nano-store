export const SETTING_FIELDS = {
  store_name: ["نام فروشگاه", "text", "فروشگاه من"],
  tagline: ["شعار فروشگاه", "text", "انتخابی برای شما"],
  brand_color: ["رنگ برند", "color", "#637c68"],
  category_active_bg: ["رنگ پس‌زمینه دسته انتخاب‌شده", "colorempty", ""],
  category_active_color: ["رنگ متن دسته انتخاب‌شده", "colorempty", ""],
  logo: ["لوگو", "photo", ""],
  font: ["فونت سایت", "font", ""],

  default_theme: ["تم پیش‌فرض", "theme", "light"],
  theme_switch_enabled: ["تغییر حالت روشن و تاریک", "bool", true],

  announcement: ["متن اطلاع‌رسانی بالای صفحه", "long", ""],
  announcement_enabled: ["نوار اطلاع‌رسانی", "bool", false],

  slider_enabled: ["اسلایدر", "bool", true],
  slider_autoplay: ["حرکت خودکار اسلایدر", "bool", true],
  slider_seconds: ["فاصله اسلایدها، ثانیه", "seconds", 6],

  categories_enabled: ["دسته‌بندی تصویری", "bool", true],
  search_enabled: ["جست‌وجو", "bool", true],
  sorting_enabled: ["مرتب‌سازی", "bool", true],
  stock_visible: ["نمایش تعداد موجودی", "bool", true],

  cart_enabled: ["سبد خرید", "bool", true],
  orders_enabled: ["ثبت سفارش", "bool", true],
  order_notes_enabled: ["توضیحات سفارش", "bool", true],
  discounts_enabled: ["کد تخفیف", "bool", true],

  shipping_fee: ["هزینه ارسال، تومان", "integer", 0],
  free_shipping_over: ["ارسال رایگان از مبلغ؛ صفر غیرفعال", "integer", 0],

  payment_contact_enabled: ["ثبت سفارش با هماهنگی مدیر", "bool", true],
  payment_card_enabled: ["کارت‌به‌کارت", "bool", false],
  reservation_hours: ["مهلت پرداخت کارت‌به‌کارت، ساعت", "hours", 24],

  payment_gateway_enabled: ["پرداخت آنلاین با درگاه", "bool", false],
  // Legacy single pick; kept for backward compatibility. The active
  // set is payment_gateways (multi-select) managed from the bot panel.
  payment_gateway: ["درگاه پرداخت: zarinpal، zibal یا snapppay", "gateway", "zarinpal"],
  payment_gateways: ["درگاه‌های فعال؛ چند انتخابی", "gatewaylist", []],
  payment_gateway_merchant: ["کد پذیرنده درگاه (مرچنت‌آیدی)", "text", ""],
  payment_gateway_sandbox: ["حالت آزمایشی درگاه", "bool", false],

  default_sort: ["مرتب‌سازی پیش‌فرض: جدیدترین، ارزان‌ترین، گران‌ترین یا محبوب‌ترین", "sort", "new"],

  snapppay_username: ["نام کاربری اسنپ‌پی", "text", ""],
  snapppay_password: ["رمز عبور اسنپ‌پی", "text", ""],
  snapppay_client_id: ["شناسه کلاینت اسنپ‌پی", "text", ""],
  snapppay_client_secret: ["کلید مخفی اسنپ‌پی", "text", ""],
  snapppay_base_url: ["آدرس پایه API اسنپ‌پی؛ خالی یعنی پیش‌فرض", "text", ""],

  site_url: ["آدرس کامل سایت", "url", ""],

  contact_text: ["اطلاعات تماس مدیر", "long", "اطلاعات تماس را از ربات تنظیم کنید."],
  contact_links: ["لینک‌های تماس", "links", []],
  contact_enabled: ["بخش تماس", "bool", true],

  order_message: [
    "پیام پس از ثبت سفارش",
    "long",
    "سفارش شما ثبت اولیه شد. برای هماهنگی، کد سفارش را به مدیر ارسال کنید. ثبت اولیه به معنی تأیید پرداخت نیست."
  ],

  blog_enabled: ["مجله فروشگاه", "bool", true],
  faq_enabled: ["سؤالات متداول", "bool", true],

  popup_enabled: ["پاپ‌آپ", "bool", false],
  popup_title: ["عنوان پاپ‌آپ", "text", ""],
  popup_text: ["متن پاپ‌آپ", "long", ""],
  popup_image: ["عکس پاپ‌آپ", "photo", ""],
  popup_url: ["لینک پاپ‌آپ", "url", ""],
  popup_button: ["متن دکمه پاپ‌آپ", "text", "مشاهده"],
  popup_every_visit: ["پاپ‌آپ در هر بازدید", "bool", false],

  footer_text: ["متن پایین صفحه", "long", "با دقت انتخاب کنید؛ با ما در ارتباط باشید."],

  turnstile_enabled: ["Turnstile", "bool", false],
  turnstile_site_key: ["کلید عمومی Turnstile", "text", ""],

  sms_provider: ["سرویس پیامک", "smsprovider", "kavenegar"],
  sms_api_key: ["کلید API سرویس پیامک", "text", ""],
  sms_template: ["قالب کد تایید پیامک", "text", ""]
};

export const GATEWAYS = ["zarinpal", "zibal", "snapppay"];

export const SMS_PROVIDERS = ["kavenegar", "farazsms", "smsir"];

export const SMS_PROVIDER_LABELS = {
  kavenegar: "کاوه‌نگار",
  farazsms: "فراز اس‌ام‌اس",
  smsir: "SMS.ir"
};

export function smsProviderLabel(name) {
  return SMS_PROVIDER_LABELS[name] || name;
}

/*
 * Runtime-variable switches (Cloudflare "Variables and Secrets").
 * Default is ON: only an explicit off/false/0/no disables a module.
 * Accepts: on, off, true, false, 1, 0, yes, no (case-insensitive).
 */
export function envFlagOn(value) {
  if (value === undefined || value === null || value === "") return true;

  return !["off", "false", "0", "no"].includes(
    String(value).trim().toLowerCase()
  );
}

export const GATEWAY_LABELS = {
  zarinpal: "زرین‌پال",
  zibal: "زیبال",
  snapppay: "اسنپ‌پی"
};

export const SORT_OPTIONS = ["new", "cheap", "expensive", "pop"];

/*
 * Active online gateways. payment_gateways is the explicit multi-select;
 * shops configured before it fall back to the legacy single pick.
 */
export function activeGateways(config) {
  const list = Array.isArray(config?.payment_gateways)
    ? config.payment_gateways.filter(item => GATEWAYS.includes(item))
    : [];

  if (list.length) return [...new Set(list)];

  return GATEWAYS.includes(config?.payment_gateway)
    ? [config.payment_gateway]
    : [];
}

/*
 * Whether a specific gateway has enough credentials to accept a
 * payment. Zibal sandbox works without a merchant code; everything
 * else requires one (SnappPay requires its four OAuth values).
 */
export function gatewayReady(config, name) {
  if (!GATEWAYS.includes(name)) return false;

  if (name === "snapppay") {
    return Boolean(
      config?.snapppay_username &&
      config?.snapppay_password &&
      config?.snapppay_client_id &&
      config?.snapppay_client_secret
    );
  }

  if (name === "zibal") {
    return Boolean(config?.payment_gateway_merchant) ||
      Boolean(config?.payment_gateway_sandbox);
  }

  // zarinpal
  return Boolean(config?.payment_gateway_merchant);
}

export const DEFAULTS = Object.fromEntries(
  Object.entries(SETTING_FIELDS).map(([key, spec]) => [key, spec[2]])
);

export function digits(value) {
  return String(value)
    .replace(/[۰-۹]/g, x => String("۰۱۲۳۴۵۶۷۸۹".indexOf(x)))
    .replace(/[٠-٩]/g, x => String("٠١٢٣٤٥٦٧٨٩".indexOf(x)));
}

export function integer(value, max = 1e12) {
  const text = digits(value).trim().replace(/,/g, "");

  if (!/^\d+$/.test(text)) {
    throw new Error("Enter a non-negative integer.");
  }

  const number = Number(text);

  if (!Number.isSafeInteger(number) || number > max) {
    throw new Error("The number is outside the allowed range.");
  }

  return number;
}

export function safeURL(value) {
  if (!value) return "";

  const url = new URL(value);

  if (!["https:", "http:", "tel:"].includes(url.protocol)) {
    throw new Error("Allowed protocols: https, http, tel.");
  }

  if (url.username || url.password) {
    throw new Error("URLs must not contain credentials.");
  }

  return url.href;
}

export function parseSetting(key, input) {
  const field = SETTING_FIELDS[key];
  if (!field) throw new Error("Unknown setting.");

  const type = field[1];
  const text = String(input ?? "").trim();
  const value = text === "-" ? "" : text;

  if (type === "integer") return integer(value);
  if (type === "hours") {
    const hours = integer(value, 168);
    if (hours < 1) throw new Error("Use 1-168 hours.");
    return hours;
  }

  if (type === "seconds") {
    const seconds = integer(value, 30);
    if (seconds < 4) throw new Error("Use 4-30 seconds.");
    return seconds;
  }

  if (type === "color") {
    if (!/^#[a-f0-9]{6}$/i.test(value)) {
      throw new Error("Use a six-digit HEX color.");
    }
    return value.toLowerCase();
  }

  if (type === "theme") {
    if (!["light", "dark"].includes(value)) {
      throw new Error("Allowed values: light, dark.");
    }
    return value;
  }

  if (type === "colorempty") {
    // "" = automatic (follow the brand color and its computed contrast).
    if (!value) return "";

    if (!/^#[a-f0-9]{6}$/i.test(value)) {
      throw new Error("Use a six-digit HEX color or - for automatic.");
    }

    return value.toLowerCase();
  }

  if (type === "smsprovider") {
    const normalized = value
      .toLowerCase()
      .replace(/\u200c/g, "")
      .replace(/[\s._-]/g, "");

    const aliases = {
      kavenegar: "kavenegar",
      "کاوهنگار": "kavenegar",
      farazsms: "farazsms",
      faraz: "farazsms",
      ippanel: "farazsms",
      smsir: "smsir"
    };

    const mapped = aliases[normalized];

    if (!mapped) {
      throw new Error("Allowed values: kavenegar, farazsms, smsir.");
    }

    return mapped;
  }

  if (type === "gateway") {
    const item = value.toLowerCase();

    if (!GATEWAYS.includes(item)) {
      throw new Error("Allowed values: zarinpal, zibal, snapppay.");
    }

    return item;
  }

  if (type === "gatewaylist") {
    if (!value) return [];

    const items = value
      .split(/[,،\s]+/)
      .map(item => item.trim().toLowerCase())
      .filter(Boolean);

    if (items.some(item => !GATEWAYS.includes(item))) {
      throw new Error("Allowed values: zarinpal, zibal, snapppay.");
    }

    return [...new Set(items)];
  }

  if (type === "sort") {
    // ZWNJ is normalized to a plain space so both typed forms match.
    const normalized = value.replace(/\u200c/g, " ").trim().toLowerCase();

    const aliases = {
      "جدیدترین": "new",
      new: "new",
      "ارزان ترین": "cheap",
      cheap: "cheap",
      "گران ترین": "expensive",
      expensive: "expensive",
      "محبوب ترین": "pop",
      pop: "pop",
      popular: "pop"
    };

    const mapped = aliases[normalized];

    if (!mapped) {
      throw new Error("Allowed values: جدیدترین، ارزان‌ترین، گران‌ترین، محبوب‌ترین.");
    }

    return mapped;
  }

  if (type === "url") return safeURL(value);

  if (type === "links") {
    if (!value) return [];

    const lines = value.split("\n").filter(x => x.trim());
    if (lines.length > 8) throw new Error("Maximum 8 contact links.");

    return lines.map(line => {
      const at = line.indexOf("|");
      if (at < 1) throw new Error("Use: Title | URL");

      const label = line.slice(0, at).trim();
      const url = safeURL(line.slice(at + 1).trim());

      if (!url || label.length > 80) {
        throw new Error("Invalid contact link.");
      }

      return { label, url };
    });
  }

  if (["photo", "font", "bool"].includes(type)) {
    throw new Error("Use the corresponding upload or toggle control.");
  }

  if (value.length > (type === "long" ? 6000 : 250)) {
    throw new Error("Text is too long.");
  }

  if (key === "store_name" && !value) {
    throw new Error("Store name cannot be empty.");
  }

  return value;
}

/**
 * Input:
 * رنگ: مشکی
 * قرمز
 * سایز: کوچک
 * بزرگ
 *
 * Output:
 * [{name:"رنگ",values:["مشکی","قرمز"]}, ...]
 */
export function parseOptions(input) {
  const groups = [];
  let current;

  for (const raw of String(input).split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const separator = line.indexOf(":");

    if (separator !== -1) {
      const name = line.slice(0, separator).trim();
      const first = line.slice(separator + 1).trim();

      if (!name || name.length > 60) {
        throw new Error("Option names must contain 1-60 characters.");
      }

      if (groups.some(group => group.name === name)) {
        throw new Error("Duplicate option name: " + name);
      }

      current = { name, values: [] };
      groups.push(current);

      if (first) current.values.push(first);
    } else {
      if (!current) {
        throw new Error("Start with an option name followed by a colon.");
      }

      if (!current.values.includes(line)) {
        current.values.push(line);
      }
    }
  }

  if (!groups.length || groups.length > 4) {
    throw new Error("Use 1-4 option groups.");
  }

  for (const group of groups) {
    if (!group.values.length || group.values.length > 20) {
      throw new Error("Each option must contain 1-20 values.");
    }

    if (group.values.some(value => value.length > 80)) {
      throw new Error("Option values must not exceed 80 characters.");
    }
  }

  return groups;
}

export function combinations(schema, limit = 100) {
  let result = [{}];

  for (const group of schema) {
    if (result.length * group.values.length > limit) {
      throw new Error("Maximum " + limit + " variants per product.");
    }

    result = result.flatMap(previous =>
      group.values.map(value => ({
        ...previous,
        [group.name]: value
      }))
    );
  }

  return result;
}

/*
 * Contextual per-field help. The bot settings panel shows the matching
 * entry before the admin sends a new value: what the field does, every
 * accepted value/format and a copyable example.
 */
export const SETTING_HELP = {
  store_name:
    "نام فروشگاه در هدر، عنوان تب مرورگر و پیام‌ها نمایش داده می‌شود.\n" +
    "حداکثر ۲۵۰ نویسه؛ خالی پذیرفته نیست.\n" +
    "مثال: فروشگاه لباس آروین",
  tagline:
    "شعار کوتاه زیر نام فروشگاه در هدر سایت.\n" +
    "برای پاک‌کردن: -\n" +
    "مثال: بهترین کیفیت، سریع‌ترین ارسال",
  brand_color:
    "رنگ اصلی دکمه‌ها، لینک‌ها و اسلایدر.\n" +
    "قالب دقیق: # به‌همراه ۶ رقم هگز (حروف بزرگ/کوچک فرق ندارد).\n" +
    "مثال‌ها: #637c68 یا #2563eb یا #e11d48\n" +
    "متن روی رنگ‌های تیره خودکار سفید می‌شود.",
  category_active_bg:
    "پس‌زمینه چیپ دسته‌بندیِ انتخاب‌شده در ویترین (مثل «همه»).\n" +
    "خالی (= ارسال -) یعنی خودکار: همان رنگ برند.\n" +
    "قالب: # به‌همراه ۶ رقم هگز.\n" +
    "مثال: #1f2937 (سرمه‌ای تیره) یا #b91c1c (قرمز)",
  category_active_color:
    "رنگ متن چیپ دسته‌بندیِ انتخاب‌شده؛ برای کنتراست با پس‌زمینه تیره.\n" +
    "خالی (= ارسال -) یعنی خودکار: روی پس‌زمینه تیره سفید و روی روشن مشکی.\n" +
    "قالب: # به‌همراه ۶ رقم هگز.\n" +
    "مثال: #ffffff یا #fde68a\n" +
    "پیشنهاد: پس‌زمینه تیره ← متن روشن (#ffffff) و برعکس.",
  logo:
    "لوگوی هدر سایت. عکس را به‌شکل Photo ارسال کنید (PNG/JPG/WebP تا ۴MB).\n" +
    "بهترین شکل: مربع با پس‌زمینه شفاف. حذف: -",
  font:
    "فونت اختصاصی سایت. فایل را به‌شکل Document بفرستید.\n" +
    "پسوندهای مجاز: woff2، woff، ttf — حداکثر ۴MB.\n" +
    "مثال: Vazirmatn-Bold.woff2 — حذف: -",
  default_theme:
    "تم اولیه سایت برای بازدیدکننده‌ای که هنوز تمی انتخاب نکرده.\n" +
    "مقادیر مجاز: light یا dark\n" +
    "مثال: light",
  theme_switch_enabled:
    "دکمه تغییر تم روشن/تاریک برای بازدیدکننده. روشن/خاموش با دکمه.",
  announcement:
    "متن نوار اطلاع‌رسانی بالای سایت؛ فقط متن ساده، حداکثر ۶۰۰۰ نویسه.\n" +
    "مثال: ارسال سفارش‌های بالای ۵۰۰ هزار تومان رایگان است",
  announcement_enabled: "نمایش یا مخفی‌کردن نوار اطلاع‌رسانی. روشن/خاموش با دکمه.",
  slider_enabled: "نمایش اسلایدر بنر بالای سایت. روشن/خاموش با دکمه.",
  slider_autoplay: "چرخش خودکار اسلایدها. روشن/خاموش با دکمه.",
  slider_seconds:
    "فاصله زمانی تعویض خودکار اسلاید بر حسب ثانیه.\n" +
    "مجاز: عدد ۴ تا ۳۰ — مثال: 6",
  categories_enabled: "بخش دسته‌بندی‌های تصویری بالای ویترین. روشن/خاموش با دکمه.",
  search_enabled: "باکس جست‌وجوی محصولات در ویترین. روشن/خاموش با دکمه.",
  sorting_enabled: "نوار مرتب‌سازی (جدیدترین، محبوب‌ترین و…). روشن/خاموش با دکمه.",
  stock_visible: "نمایش تعداد موجودی روی کارت محصول. روشن/خاموش با دکمه.",
  cart_enabled: "سبد خرید برای مشتری. روشن/خاموش با دکمه.",
  orders_enabled: "امکان ثبت سفارش توسط مشتری. روشن/خاموش با دکمه.",
  order_notes_enabled: "فیلد توضیحات دلخواه مشتری هنگام سفارش. روشن/خاموش با دکمه.",
  discounts_enabled: "ورود کد تخفیف در مرحله پرداخت. روشن/خاموش با دکمه.",
  shipping_fee:
    "هزینه ارسال ثابت به تومان؛ ۰ یعنی رایگان.\n" +
    "فقط عدد — مثال: 45000",
  free_shipping_over:
    "از این مبلغ خرید، ارسال رایگان می‌شود؛ ۰ یعنی غیرفعال.\n" +
    "فقط عدد تومان — مثال: 1000000",
  payment_contact_enabled:
    "روش «ثبت سفارش با هماهنگی مدیر» (بدون پرداخت آنلاین). روشن/خاموش با دکمه.",
  payment_card_enabled:
    "روش کارت‌به‌کارت؛ کارت فعال از بخش «کارت‌ها» نمایش داده می‌شود.\n" +
    "روشن/خاموش با دکمه.",
  reservation_hours:
    "مهلت پرداخت سفارش کارت‌به‌کارت؛ پس از آن خودکار لغو و موجودی آزاد می‌شود.\n" +
    "مجاز: ۱ تا ۱۶۸ ساعت — مثال: 24",
  payment_gateway_enabled:
    "کلید فعال‌بودن پرداخت آنلاین. پیش از روشن‌کردن، حداقل یک درگاه از\n" +
    "بخش «درگاه پرداخت» را فعال و کامل کنید. روشن/خاموش با دکمه.",
  payment_gateway:
    "درگاه پیش‌فرض (قدیمی). مقادیر مجاز: zarinpal، zibal یا snapppay\n" +
    "فعال‌سازی همزمان چند درگاه از پنل «درگاه پرداخت» انجام می‌شود.",
  payment_gateway_merchant:
    "کد پذیرنده (مرچنت‌آیدی) زرین‌پال یا زیبال؛ برای اسنپ‌پی لازم نیست.\n" +
    "مثال: 71a2b3c4-... — برای زیبال در حالت آزمایشی خالی بماند.",
  payment_gateway_sandbox:
    "حالت آزمایشی درگاه (بدون پول واقعی). پیش از فروش واقعی خاموش کنید.",
  default_sort:
    "مرتب‌سازی اولیه ویترین تا مشتری خودش تغییر ندهد.\n" +
    "از دکمه‌های همین پنل انتخاب کنید؛ تایپ هم مجاز است.\n" +
    "مقادیر مجاز: جدیدترین، محبوب‌ترین، ارزان‌ترین، گران‌ترین\n" +
    "(انگلیسی: new، pop، cheap، expensive)\n" +
    "محبوب‌ترین یعنی بیشترین فروش موفق.",
  snapppay_username: "نام کاربری دریافتی از اسنپ‌پی. مثال: myshop-user",
  snapppay_password: "رمز عبور OAuth اسنپ‌پی؛ فقط از پنل اسنپ‌پی بگیرید.",
  snapppay_client_id: "شناسه کلاینت اسنپ‌پی. مثال: 0a1b2c3d-...",
  snapppay_client_secret: "کلید مخفی کلاینت اسنپ‌پی؛ محرمانه بماند.",
  snapppay_base_url:
    "آدرس پایه API اسنپ‌پی برای سرور آزمایشی؛ خالی یعنی سرور اصلی.\n" +
    "مثال: https://sandbox.finnotech.ir",
  site_url:
    "آدرس کامل سایت با https؛ برای درگاه، دکمه پنل مینی‌اپ و لینک‌ها لازم است.\n" +
    "مثال: https://myshop.workers.dev — بدون / انتهایی.",
  contact_text: "متن بخش «تماس با مدیر»؛ متن ساده، حداکثر ۶۰۰۰ نویسه.",
  contact_links:
    "هر لینک در یک خط با قالب: عنوان | آدرس\n" +
    "پروتکل‌های مجاز: https، http، tel — حداکثر ۸ خط.\n" +
    "مثال:\n" +
    "تلگرام | https://t.me/username\n" +
    "تماس | tel:+989121234567\n" +
    "اینستاگرام | https://instagram.com/username",
  contact_enabled: "نمایش بخش «با ما در ارتباط باشید». روشن/خاموش با دکمه.",
  order_message:
    "پیامی که بعد از ثبت سفارش به مشتری نمایش داده می‌شود.\n" +
    "متن ساده حداکثر ۶۰۰۰ نویسه؛ کد سفارش خودکار بالا و پایین آن چاپ می‌شود.",
  blog_enabled: "نمایش بخش «مجله فروشگاه» (عنوان نوشته‌ها). روشن/خاموش با دکمه.",
  faq_enabled: "نمایش بخش «سؤالات متداول». روشن/خاموش با دکمه.",
  popup_enabled: "پنجره خوش‌آمدگویی در ورود اول. روشن/خاموش با دکمه.",
  popup_title: "عنوان پاپ‌آپ؛ مثال: به فروشگاه ما خوش آمدید",
  popup_text: "متن پاپ‌آپ؛ متن ساده حداکثر ۶۰۰۰ نویسه.",
  popup_image: "عکس پاپ‌آپ؛ Photo تا ۴MB. حذف: -",
  popup_url:
    "لینک دکمه پاپ‌آپ؛ https یا http.\n" +
    "مثال: https://t.me/username — بدون لینک، دکمه نمایش داده نمی‌شود.",
  popup_button: "متن دکمه پاپ‌آپ؛ مثال: مشاهده محصولات",
  popup_every_visit:
    "روشن: پاپ‌آپ در هر بازدید دیده می‌شود؛ خاموش: فقط بار اول هر دستگاه.",
  footer_text: "متن پایین صفحه سایت؛ متن ساده حداکثر ۶۰۰۰ نویسه.",
  turnstile_enabled:
    "کپچای Cloudflare برای فرم سفارش. فقط بعد از تنظیم «کلید عمومی» و\n" +
    "Secret زیرساخت (TURNSTILE_SECRET_KEY) فعال شود.",
  turnstile_site_key:
    "کلید عمومی Turnstile (sitekey) — با 0x شروع می‌شود.\n" +
    "مثال: 0x4AAAAAAA...",
  sms_provider:
    "سرویس ارسال کد تایید ورود مشتریان.\n" +
    "از دکمه‌های همین پنل انتخاب کنید؛ مقادیر مجاز:\n" +
    "kavenegar (کاوه‌نگار)، farazsms (فراز اس‌ام‌اس)، smsir (SMS.ir)",
  sms_api_key:
    "کلید API سرویس انتخابی در «سرویس پیامک».\n" +
    "کاوه‌نگار: کلید از پنل کاوه‌نگار (بخش API).\n" +
    "فراز اس‌ام‌اس: کلید API از پنل farazsms.\n" +
    "SMS.ir: کلید API از پنل sms.ir.\n" +
    "کلید محرمانه است و هرگز به سایت مشتریان ارسال نمی‌شود.",
  sms_template:
    "قالب/تملیت کد تایید در پنل سرویس پیامک:\n" +
    "• کاوه‌نگار و فراز: نام قالب Verify که متغیرش %token است.\n" +
    "  مثال: shop-verify\n" +
    "• SMS.ir: شناسه عددی قالب (TemplateId).\n" +
    "  مثال: 1000123\n" +
    "در پنل سرویس، متغیر کد را مطابق راهنمای همان سرویس تعریف کنید."
};