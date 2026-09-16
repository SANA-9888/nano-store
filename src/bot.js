// ============================================================
// Persian Store V2 — Telegram administration
// PART 1 OF 3
// Append parts 2 and 3 directly below this part.
// ============================================================

import {
  SETTING_FIELDS,
  SETTING_HELP,
  parseSetting,
  parseOptions,
  combinations,
  digits,
  integer,
  safeURL,
  GATEWAYS,
  SMS_PROVIDERS,
  smsProviderLabel,
  SORT_OPTIONS,
  activeGateways,
  gatewayReady,
  envFlagOn
} from "./defaults.js";

import {
  uid,
  sha256,
  rows,
  one,
  execute,
  getSettings,
  setSetting
} from "./db.js";

import {
  telegram,
  button as B,
  renderPanel,
  deliverNotifications
} from "./telegram.js";

import {
  saveAdminMedia,
  sendReceiptToAdmin
} from "./media.js";

import {
  markPaidManually,
  changeOrderStatus
} from "./orders.js";

import { logAdminAction } from "./audit.js";

import {
  applyInventoryStructure,
  validateProductPublish,
  deleteProduct,
  requireStructureEditable
} from "./catalog.js";

const PAGE_SIZE = 6;
const SESSION_DURATION = 30 * 60 * 1000;

const ORDER_STATUS = {
  new: "جدید",
  confirmed: "تأییدشده",
  sent: "ارسال‌شده",
  cancelled: "لغوشده"
};

const PAYMENT_STATUS = {
  unpaid: "پرداخت‌نشده",
  review: "در انتظار بررسی رسید",
  paid: "پرداخت‌شده"
};

const INVENTORY_LABELS = {
  simple: "ساده؛ بدون گزینه",
  shared: "گزینه‌های انتخابی با موجودی مشترک",
  variants: "موجودی مستقل ترکیب‌ها"
};

/*
 * Access levels. The owner manages administrators; a lower-level
 * administrator can never add, remove or change other administrators.
 */
const ROLES = {
  owner: "مدیر اصلی",
  admin: "مدیر",
  operator: "اپراتور سفارش",
  custom: "دسترسی سفارشی"
};

/*
 * Fine-grained permission keys. Every home section maps to its own
 * key, so a manager can be granted e.g. only products without
 * slider/cards/discounts. Legacy roles map onto these; an admin with
 * role='custom' carries an explicit list in admins.permissions.
 */
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

const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

// "stats" is readable by every role and is therefore not listed here.
const ROLE_PERMISSIONS = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter(key => key !== "admins"),
  operator: ["orders"]
};

/*
 * Old permission keys (before the fine-grained split) are expanded on
 * read. "catalog" intentionally does NOT grant discounts/cards: those
 * were the leaks reported by the shop owner.
 */
const LEGACY_EXPANSION = {
  catalog: ["products", "categories", "slider", "posts", "faq"],
  orders: ["orders"],
  gateway: ["gateway"],
  settings: ["settings"],
  admins: ["admins"]
};

/* Which permission governs each editable record kind. */
const MODEL_PERMISSIONS = {
  p: "products",
  c: "categories",
  s: "slider",
  w: "posts",
  f: "faq",
  d: "discounts",
  k: "cards"
};

const GATEWAY_LABELS = {
  zarinpal: "زرین‌پال",
  zibal: "زیبال",
  snapppay: "اسنپ‌پی"
};

function gatewayLabel(name) {
  return GATEWAY_LABELS[name] || name;
}

function accessOf(row) {
  if (row.role === "owner") {
    return { role: "owner", perms: [...ALL_PERMISSIONS], isOwner: true };
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
      else if (ALL_PERMISSIONS.includes(key)) expanded.push(key);
    }

    return {
      role: "custom",
      perms: [...new Set(expanded)],
      isOwner: false
    };
  }

  const role = ROLES[row.role] ? row.role : "admin";

  return { role, perms: [...ROLE_PERMISSIONS[role]], isOwner: false };
}

function roleAllows(access, permission) {
  return access.isOwner || access.perms.includes(permission);
}

function accessLabel(access) {
  if (access.role === "custom") {
    return access.perms.length
      ? "دسترسی سفارشی (" + access.perms.length.toLocaleString("fa-IR") + " بخش)"
      : "دسترسی سفارشی";
  }

  return roleLabel(access.role);
}

function describeAccess(access) {
  return access.isOwner
    ? "همه بخش‌ها + مدیریت مدیران"
    : access.perms.length
      ? access.perms.map(key => PERMISSIONS[key]).join("، ")
      : "بدون بخش فعال";
}

/*
 * A manager can only hand out permissions they hold themselves; the
 * owner is exempt. Used for both quick roles and custom checklists.
 */
function canGrantKeys(access, keys) {
  return access.isOwner || keys.every(key => access.perms.includes(key));
}

function canGrantRole(access, role) {
  if (role === "owner") return access.isOwner;
  return canGrantKeys(access, ROLE_PERMISSIONS[role] || []);
}

function roleLabel(role) {
  return ROLES[role] || role || "مدیر";
}

/*
 * Resolves the access level of an administrator.
 *
 * Migrations can only add columns (the installer supports no
 * data-changing statements), so existing shops are healed here: as long
 * as no owner exists, the oldest administrator is promoted to owner.
 */
async function loadAccess(env, adminId) {
  const id = String(adminId);
  const admin = await one(
    env,
    "SELECT id,role,permissions FROM admins WHERE id=?",
    [id]
  );

  if (!admin) return null;

  if (admin.role !== "owner") {
    const owner = await one(
      env,
      "SELECT id FROM admins WHERE role='owner' LIMIT 1"
    );

    if (!owner) {
      await execute(
        env,
        "UPDATE admins SET role='owner' " +
        "WHERE id=(SELECT id FROM admins ORDER BY created_at,id LIMIT 1)"
      );

      const fresh = await one(
        env,
        "SELECT role,permissions FROM admins WHERE id=?",
        [id]
      );

      admin.role = fresh?.role || "admin";
      admin.permissions = fresh?.permissions || "";
    }
  }

  return accessOf(admin);
}

// All interpolated SQL identifiers must come from this registry.
// Never use Telegram text as a table or column identifier.
const MODELS = {
  p: {
    table: "products",
    title: "محصولات",
    name: "name",
    toggle: "published",
    fields: {
      name: ["نام محصول", "required", 200],
      description: ["توضیحات محصول", "long", 6000],
      price: ["قیمت پایه، تومان", "integer"],
      stock: ["موجودی مشترک", "stock"],
      attributes: ["ویژگی‌های توصیفی", "long", 6000],
      low_stock_threshold: ["آستانه هشدار موجودی؛ صفر خاموش", "stock"]
    }
  },

  c: {
    table: "categories",
    title: "دسته‌بندی‌ها",
    name: "name",
    toggle: "enabled",
    photo: "image_id",
    fields: {
      name: ["نام دسته‌بندی", "required", 120],
      position: ["ترتیب نمایش", "position"]
    }
  },

  s: {
    table: "slides",
    title: "اسلایدها",
    name: "title",
    toggle: "enabled",
    photo: "image_id",
    fields: {
      title: ["عنوان اختیاری", "text", 200],
      description: ["توضیح کوتاه", "text", 500],
      button_text: ["متن دکمه", "text", 80],
      position: ["ترتیب نمایش", "position"]
    }
  },

  w: {
    table: "posts",
    title: "نوشته‌ها",
    name: "title",
    toggle: "published",
    photo: "image_id",
    fields: {
      title: ["عنوان نوشته", "required", 200],
      body: ["متن نوشته", "long", 12000]
    }
  },

  f: {
    table: "faqs",
    title: "سؤالات متداول",
    name: "question",
    toggle: "published",
    fields: {
      question: ["پرسش", "required", 250],
      answer: ["پاسخ", "long", 6000],
      position: ["ترتیب نمایش", "position"]
    }
  },

  d: {
    table: "coupons",
    title: "کدهای تخفیف",
    name: "code",
    toggle: "enabled",
    fields: {
      code: ["کد تخفیف", "coupon"],
      type: ["نوع؛ percent یا fixed", "discountType"],
      amount: ["درصد یا مبلغ تخفیف", "integer"],
      minimum: ["حداقل مبلغ کالاها", "integer"],
      max_uses: ["سقف استفاده؛ صفر نامحدود", "integer"],
      expires_at: ["زمان انقضا؛ خط تیره بدون انقضا", "date"]
    }
  },

  k: {
    table: "bank_cards",
    title: "کارت‌های بانکی",
    name: "label",
    toggle: "enabled",
    fields: {
      label: ["عنوان کارت", "text", 120],
      bank_name: ["نام بانک", "required", 100],
      holder_name: ["نام صاحب حساب", "required", 150],
      card_number: ["شماره کارت", "card"],
      position: ["ترتیب نمایش", "position"]
    }
  }
};

const HELP = {
  home:
    "مدیریت فروشگاه از همین پنل انجام می‌شود.\n" +
    "برای توقف ورود اطلاعات /cancel بفرستید.\n" +
    "هر فرم پس از ۳۰ دقیقه منقضی می‌شود.\n" +
    "پیام‌های خطا انگلیسی و راهنمای استفاده فارسی هستند.\n" +
    "اعلان‌های سفارش و پیش‌نمایش عکس، پیام جداگانه دارند.",

  p:
    "محصول ابتدا پیش‌نویس است؛ پس از تکمیل، آن را منتشر کنید.\n" +
    "عکس‌ها فقط به‌شکل Photo، حداکثر ۶ عکس و هرکدام ۴ مگابایت.\n\n" +
    "حالت موجودی:\n" +
    "ساده: بدون انتخاب گزینه.\n" +
    "مشترک: رنگ، سایز یا گزینه‌های دیگر از یک موجودی کم می‌شوند.\n" +
    "تنوع: هر ترکیب موجودی و قیمت اختیاری مستقل دارد.\n\n" +
    "محصول دارای سابقه سفارش به‌جای حذف پنهان می‌شود.\n" +
    "ساختار گزینه‌های محصول دارای سفارش فعال قابل تغییر نیست.",

  options:
    "هر خط دارای «:» یک ویژگی جدید شروع می‌کند.\n" +
    "خط‌های بعدی، گزینه‌های همان ویژگی‌اند.\n\n" +
    "رنگ: مشکی\nطلایی\nقرمز\n\nسایز: کوچک\nبزرگ\nمتوسط\n\n" +
    "پیش از ذخیره، پیش‌نمایش نشان داده می‌شود.\n" +
    "حداکثر ۴ گروه و در حالت تنوع حداکثر ۱۰۰ ترکیب.\n" +
    "توضیحات ساده مثل جنس و نحوه شست‌وشو را در «ویژگی‌های توصیفی» بنویسید.",

  variants:
    "هر ترکیب مانند «قرمز / بزرگ» موجودی مستقل دارد.\n" +
    "قیمت اختصاصی خالی یعنی استفاده از قیمت پایه محصول.\n" +
    "ترکیب‌های غیرقابل فروش را غیرفعال کنید.\n" +
    "آستانه ۵ یعنی هشدار هنگام موجودی کمتر از ۵؛ صفر یعنی خاموش.\n" +
    "تا موجودی دوباره به آستانه نرسد، کاهش‌های بعدی هشدار تکراری ندارند.",

  c:
    "برای هر دسته، نام، عکس و ترتیب نمایش تعیین کنید.\n" +
    "عدد کمتر بالاتر نمایش داده می‌شود.\n" +
    "عکس را به‌شکل Photo بفرستید.\n" +
    "غیرفعال‌کردن دسته، خود محصولات آن را پنهان نمی‌کند.",

  s:
    "برای هر اسلاید عکس، عنوان، توضیح و دکمه تعریف کنید.\n" +
    "مقصد می‌تواند دسته‌بندی یا لینک باشد.\n" +
    "بدون مقصد، اسلاید فقط نمایشی است.\n" +
    "تصویر افقی و نوشته کم برای موبایل بهتر است.\n" +
    "حرکت خودکار و زمان تعویض از تنظیمات کنترل می‌شوند.",

  w:
    "نوشته با عنوان، متن و عکس شاخص اختیاری ساخته می‌شود.\n" +
    "پس از انتشار، به‌شکل کارت در مجله نمایش داده می‌شود.\n" +
    "HTML و کد اجرایی پذیرفته نمی‌شوند.\n" +
    "برای متن طولانی از ورود چندبخشی استفاده کنید؛ هر پیام به پیش‌نویس اضافه می‌شود.",

  f:
    "پرسش و پاسخ را وارد و انتشار را فعال کنید.\n" +
    "ترتیب کمتر، بالاتر نمایش داده می‌شود.",

  d:
    "percent یعنی درصد و fixed یعنی مبلغ ثابت تومان.\n" +
    "درصد باید بین صفر و صد باشد.\n" +
    "حداقل خرید بر مبلغ کالاها پیش از ارسال اعمال می‌شود.\n" +
    "سقف صفر یعنی نامحدود.\n" +
    "نمونه انقضا: 2030-12-31T23:59:59Z\n" +
    "خط تیره یعنی بدون انقضا.\n" +
    "لغو سفارش سهمیه مصرف‌شده تخفیف را آزاد می‌کند.",

  k:
    "نام بانک، نام صاحب حساب و شماره کارت را وارد کنید.\n" +
    "کارت تازه تا تکمیل اطلاعات غیرفعال می‌ماند.\n" +
    "برای استفاده، روش کارت‌به‌کارت را هم از تنظیمات فعال کنید.\n" +
    "شماره کارت پس از ثبت سفارش برای مشتری نمایش داده می‌شود.\n" +
    "رمز، CVV2، تاریخ انقضا یا اطلاعات ورود بانک را ارسال نکنید.",

  orders:
    "سفارش و پرداخت دو وضعیت مستقل دارند.\n" +
    "رسید مشتری به معنی پرداخت قطعی نیست؛ حساب بانکی را بررسی کنید.\n" +
    "تأیید دستی پرداخت نیازمند تأیید نهایی شماست.\n" +
    "لغو سفارش پرداخت‌شده در این نسخه مجاز نیست؛ بازپرداخت جداگانه لازم دارد.\n" +
    "لغو سفارش پرداخت‌نشده موجودی را یک‌بار آزاد می‌کند.",

  settings:
    "گزینه‌های روشن/خاموش با دکمه تغییر می‌کنند.\n" +
    "«مرتب‌سازی پیش‌فرض» و «سرویس پیامک» پیکر دکمه‌ای دارند؛\n" +
    "بقیه فیلدها با ارسال مقدار تنظیم می‌شوند.\n" +
    "پیش از ارسال هر مقدار، راهنمای همان فیلد با مثال نمایش داده می‌شود.\n" +
    "برای حذف مقدار اختیاری، خط تیره بفرستید.\n" +
    "عکس: Photo؛ فونت: Document با پسوند woff2، woff یا ttf.\n" +
    "کلید و قالب پیامک برای کد تایید ورود مشتریان است\n" +
    "(کاوه‌نگار، فراز اس‌ام‌اس یا SMS.ir از پیکر «سرویس پیامک»).\n\n" +
    "فرمت لینک‌ها، هر مورد در یک خط:\n" +
    "تلگرام | https://t.me/username\n" +
    "تماس | tel:+989121234567\n\n" +
    "Turnstile فقط بعد از تنظیم کلید عمومی و Secret زیرساخت فعال شود.",

  admins:
    "دسترسی‌ها به‌صورت چک‌باکسی و ریزدانه قابل ترکیب است:\n" +
    "محصولات، دسته‌بندی‌ها، اسلایدر، نوشته‌ها، پرسش‌ها، تخفیف‌ها،\n" +
    "کارت‌ها، سفارش‌ها، درگاه پرداخت، تنظیمات، تنظیمات پیامک،\n" +
    "کاربران سایت و مدیریت مدیران.\n" +
    "• مدیر اصلی: دسترسی کامل و ثابت + گزارش فعالیت + تغییر نام مدیران.\n" +
    "• مدیر/اپراتور: سطوح آماده.\n" +
    "• دسترسی سفارشی: ترکیب دلخواه از بخش‌ها.\n\n" +
    "نام نمایشی: با ✏️ کنار هر مدیر، مدیر اصلی می‌تواند نام دلخواه\n" +
    "(مثلاً «رضا — انبار») ثبت کند؛ گزارش فعالیت همان نام را نشان می‌دهد.\n" +
    "در فهرست مدیران، هم نام و هم شناسه عددی دیده می‌شود.\n\n" +
    "هر مدیر فقط می‌تواند دسترسی‌هایی بدهد که خودش دارد.\n" +
    "حذف مدیران فقط توسط مدیر اصلی انجام می‌شود.\n" +
    "گزارش فعالیت مدیران (ضد خیانت) فقط برای مدیر اصلی است.\n\n" +
    "شناسه عددی حساب را وارد کنید؛ نه username یا شناسه گروه.\n" +
    "هر مدیر باید ربات را Start کند.\n" +
    "آخرین مدیر اصلی قابل حذف یا تنزل نیست.",

  gateway:
    "درگاه پرداخت، فروش مستقیم با کارت بانکی است؛ تأیید پرداخت خودکار است.\n\n" +
    "درگاه‌ها: زرین‌پال، زیبال و اسنپ‌پی (پرداخت اقساطی).\n" +
    "می‌توانید چند درگاه را همزمان فعال نگه دارید؛\n" +
    "مشتری هنگام پرداخت، درگاه دلخواهش را انتخاب می‌کند.\n\n" +
    "راه‌اندازی زرین‌پال/زیبال:\n" +
    "۱. کد پذیرنده بگیرید. ۲. درگاه را از فهرست، فعال (✅) کنید.\n" +
    "۳. آدرس https://آدرس-سایت/pay/callback را در پنل درگاه ثبت کنید.\n\n" +
    "راه‌اندازی اسنپ‌پی:\n" +
    "۱. نام کاربری، رمز، شناسه کلاینت و کلید مخفی را از پشتیبانی اسنپ‌پی بگیرید.\n" +
    "۲. اطلاعات را در «اطلاعات اسنپ‌پی» وارد کنید.\n" +
    "۳. درگاه را فعال کنید؛ آدرس بازگشت خودکار ثبت می‌شود.\n\n" +
    "حداقل مبلغ سفارش آنلاین ۱۰,۰۰۰ تومان است.\n" +
    "حالت آزمایشی: زیبال با کد پذیرنده خالی (merchant=zibal)، زرین‌پال با پنل sandbox و اسنپ‌پی با سرور آزمایشی کار می‌کند.\n" +
    "در حالت آزمایشی، پول واقعی جابه‌جا نمی‌شود؛ پیش از انتشار حتماً خاموش کنید.\n\n" +
    "سفارش‌های آنلاین پرداخت‌نشده به‌صورت خودکار لغو نمی‌شوند؛\n" +
    "سفارش‌های رهاشده را از بخش سفارش‌ها لغو کنید تا موجودی آزاد شود.",

  logs:
    "گزارش فعالیت، ضد خیانت مدیران است و فقط مدیر اصلی می‌بیند.\n\n" +
    "دو بخش دارد:\n" +
    "• محصولات و محتوا: ساخت/ویرایش/حذف محصولات، دسته‌ها، اسلایدر،\n" +
    "  نوشته‌ها، پرسش‌ها، تخفیف‌ها، کارت‌ها و تغییر موجودی واریانت‌ها.\n" +
    "• سفارش‌ها: تایید پرداخت دستی و تغییر وضعیت سفارش.\n\n" +
    "رویدادها ۹۰ روز نگه داشته می‌شوند و شامل زمان، بخش،\n" +
    "عمل و نام رکورد هستند.\n" +
    "برای خوانا شدن گزارش، از ✏️ در بخش مدیران برای هر مدیر\n" +
    "نام نمایشی بگذارید.",

  stats:
    "آمار کلی فروشگاه: تعداد محصولات منتشرشده، سفارش‌ها بر اساس\n" +
    "وضعیت، فروش کل موفق و پرداخت‌های آنلاین.\n" +
    "این بخش برای همه مدیران باز است و اطلاعاتی حذف نمی‌کند."
};

function cut(value, length = 160) {
  const text = String(value ?? "");
  return text.length > length
    ? text.slice(0, length) + "…"
    : text;
}

function pageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100000, Math.floor(number)))
    : 0;
}

function money(value) {
  return Number(value || 0).toLocaleString("fa-IR") + " تومان";
}

function selectionLabel(value) {
  const selection = typeof value === "string"
    ? JSON.parse(value)
    : value;

  return Object.entries(selection || {})
    .map(([name, option]) => name + ": " + option)
    .join(" / ");
}

function nav(back = "home", help = "home") {
  return [
    B("↩️ بازگشت / لغو", back),
    B("📖 راهنما", "help:" + help)
  ];
}

function paging(prefix, page, hasNext) {
  const result = [];

  if (page > 0) {
    result.push(B("قبلی", prefix + ":" + (page - 1)));
  }

  if (hasNext) {
    result.push(B("بعدی", prefix + ":" + (page + 1)));
  }

  return result;
}

async function getSession(env, adminId) {
  const record = await one(
    env,
    "SELECT state FROM bot_sessions WHERE admin_id=? AND expires_at>?",
    [String(adminId), Date.now()]
  );

  return record ? JSON.parse(record.state) : null;
}

async function putSession(env, adminId, state) {
  await execute(
    env,
    "INSERT INTO bot_sessions(admin_id,state,expires_at) VALUES(?,?,?) " +
    "ON CONFLICT(admin_id) DO UPDATE SET " +
    "state=excluded.state,expires_at=excluded.expires_at",
    [
      String(adminId),
      JSON.stringify(state),
      Date.now() + SESSION_DURATION
    ]
  );
}

async function clearSession(env, adminId) {
  await execute(
    env,
    "DELETE FROM bot_sessions WHERE admin_id=?",
    [String(adminId)]
  );
}

async function prompt(
  env,
  adminId,
  state,
  title,
  back = "home",
  help = "home",
  current = ""
) {
  await putSession(env, adminId, {
    ...state,
    back,
    help
  });

  return renderPanel(
    env,
    adminId,
    title +
      (current !== ""
        ? "\n\nمقدار فعلی:\n" + cut(current, 1500)
        : "") +
      "\n\nمقدار جدید را ارسال کنید.\n" +
      "برای پاک‌کردن مقدار اختیاری: -\n" +
      "برای لغو: /cancel",
    [nav(back, help)]
  );
}

function homeKeyboard(access) {
  const has = permission => roleAllows(access, permission);
  const keyboard = [];

  /*
   * Compact two-per-row grid: every section button is collected in a
   * stable order and chunked into pairs, so the panel stays short and
   * tidy no matter which permission subset is active.
   */
  const sections = [];

  if (has("products")) sections.push(B("🛍 محصولات", "list:p:0"));
  if (has("categories")) sections.push(B("🗂 دسته‌بندی‌ها", "list:c:0"));
  if (has("slider")) sections.push(B("🖼 اسلایدر", "list:s:0"));
  if (has("posts")) sections.push(B("✍️ نوشته‌ها", "list:w:0"));
  if (has("faq")) sections.push(B("❓ پرسش‌ها", "list:f:0"));
  if (has("discounts")) sections.push(B("🎟 تخفیف‌ها", "list:d:0"));
  if (has("cards")) sections.push(B("💳 کارت‌ها", "list:k:0"));

  for (let index = 0; index < sections.length; index += 2) {
    keyboard.push(sections.slice(index, index + 2));
  }

  if (has("orders")) {
    keyboard.push([B("📦 سفارش‌ها", "orders:0"), B("🔍 جستجوی سفارش", "findorder")]);
  }

  const manageRows = [];

  if (has("gateway")) manageRows.push(B("🏦 درگاه پرداخت", "gateway"));
  if (has("settings")) manageRows.push(B("🎨 تنظیمات", "settings:0"));
  if (manageRows.length) keyboard.push(manageRows);

  const peopleRows = [];

  if (has("admins")) peopleRows.push(B("👥 مدیران", "admins"));

  // The anti-abuse activity report is reserved for the shop owner.
  if (access.isOwner) peopleRows.push(B("🕵️ گزارش فعالیت", "logs"));
  if (peopleRows.length) keyboard.push(peopleRows);

  keyboard.push([B("📊 آمار", "stats"), B("📖 راهنما", "help:home")]);

  return keyboard;
}

function homeText(access) {
  return "مدیریت فروشگاه\n" +
    "سطح دسترسی شما: " + accessLabel(access) + "\n" +
    describeAccess(access);
}

async function showHome(env, adminId, access, fresh = false) {
  await clearSession(env, adminId);

  if (fresh) {
    /*
     * /start must deliver the panel again as a brand-new message.
     * renderPanel edits the stored panel message; dropping the stored
     * reference makes it send a fresh one instead.
     */
    await execute(
      env,
      "DELETE FROM bot_panels WHERE admin_id=?",
      [String(adminId)]
    );
  }

  const keyboard = homeKeyboard(access);

  // The Mini App launcher rides on top of the home panel when deployed.
  if (envFlagOn(env.MINIAPP_ENABLED)) {
    try {
      const settings = await getSettings(env);
      const base = String(settings.site_url || "").replace(/\/+$/, "");

      if (/^https:\/\//.test(base + "/")) {
        keyboard.unshift([
          { text: "🚀 پنل مدیریت (مینی‌اپ)", web_app: { url: base + "/miniapp" } }
        ]);
      }
    } catch {
      // Home without the launcher is still fully usable.
    }
  }

  return renderPanel(
    env,
    adminId,
    homeText(access),
    keyboard
  );
}

function snapppayReady(settings) {
  return Boolean(
    settings.snapppay_username &&
    settings.snapppay_password &&
    settings.snapppay_client_id &&
    settings.snapppay_client_secret
  );
}

function maskCredential(value) {
  const text = String(value || "");

  if (!text) return "تنظیم نشده";

  return text.slice(0, 3) + "•••" + (text.length > 6 ? " (" + text.length.toLocaleString("fa-IR") + " کاراکتر)" : "");
}

function gatewayReadyHint(name) {
  if (name === "snapppay") {
    return "ابتدا هر چهار مقدار اطلاعات اسنپ‌پی را در «اطلاعات اسنپ‌پی» تکمیل کنید.";
  }

  if (name === "zibal") {
    return "ابتدا کد پذیرنده زیبال را تنظیم کنید؛ یا برای تست، حالت آزمایشی را روشن کنید.";
  }

  return "ابتدا کد پذیرنده (مرچنت‌آیدی) زرین‌پال را تنظیم کنید.";
}

async function showGateway(env, adminId) {
  await clearSession(env, adminId);

  const settings = await getSettings(env);
  const active = new Set(activeGateways(settings));
  const merchant = settings.payment_gateway_merchant || "تنظیم نشده";
  const callbackURL = settings.site_url
    ? settings.site_url.replace(/\/+$/, "") + "/pay/callback"
    : "";

  const text = [
    "🏦 درگاه پرداخت آنلاین",
    "وضعیت: " + (settings.payment_gateway_enabled ? "فعال ✅" : "غیرفعال ⛔"),
    "درگاه‌های فعال: " +
      (active.size ? [...active].map(gatewayLabel).join("، ") : "هیچ"),
    "با فعال‌بودن چند درگاه، مشتری هنگام پرداخت یکی را انتخاب می‌کند.",
    "",
    "کد پذیرنده: " + cut(merchant, 60),
    "حالت آزمایشی: " + (settings.payment_gateway_sandbox ? "روشن 🧪" : "خاموش"),
    "",
    "آدرس بازگشت پرداخت (Callback) برای همه درگاه‌ها یکی است:",
    callbackURL || "پس از تنظیم «آدرس کامل سایت» یا اولین سفارش آنلاین نمایش داده می‌شود.",
    "",
    "این آدرس را در پنل هر درگاه ثبت کنید.\n" +
      "آدرس سایت به‌شکل https://example.workers.dev است."
  ].join("\n");

  return renderPanel(env, adminId, text, [
    [
      B(
        settings.payment_gateway_enabled ? "⛔ غیرفعال کردن درگاه" : "✅ فعال کردن درگاه",
        "gatewaytoggle"
      )
    ],
    GATEWAYS.map(name =>
      B(
        gatewayLabel(name) + (active.has(name) ? " ✅" : " ⬜"),
        "gatewayuse:" + name
      )
    ),
    [B("✏️ کد پذیرنده (مرچنت‌آیدی)", "gatewaymerchant")],
    [B("🔐 اطلاعات اسنپ‌پی", "snapppaypanel")],
    [B("🧪 تغییر حالت آزمایشی", "gatewaysandbox")],
    [B("📖 راهنمای درگاه", "help:gateway")],
    nav("home", "gateway")
  ]);
}

async function showSnapppayPanel(env, adminId) {
  await clearSession(env, adminId);

  const settings = await getSettings(env);
  const ready = snapppayReady(settings);
  const base = settings.snapppay_base_url
    ? cut(settings.snapppay_base_url, 90)
    : "پیش‌فرض (" + (settings.payment_gateway_sandbox ? "سرور آزمایشی" : "api.snapp-pay.ir") + ")";

  const text = [
    "🔐 اطلاعات درگاه اسنپ‌پی",
    "وضعیت اعتبارنامه: " + (ready ? "کامل ✅" : "ناقص ⛔"),
    "",
    "نام کاربری: " + maskCredential(settings.snapppay_username),
    "رمز عبور: " + maskCredential(settings.snapppay_password),
    "شناسه کلاینت: " + maskCredential(settings.snapppay_client_id),
    "کلید مخفی: " + maskCredential(settings.snapppay_client_secret),
    "آدرس پایه API: " + base,
    "",
    "این چهار مقدار را از پشتیبانی اسنپ‌پی دریافت می‌کنید.\n" +
      "پس از تکمیل، درگاه «اسنپ‌پی» را انتخاب و فعال کنید."
  ].join("\n");

  return renderPanel(env, adminId, text, [
    [B("نام کاربری", "snapppayfield:username")],
    [B("رمز عبور", "snapppayfield:password")],
    [B("شناسه کلاینت", "snapppayfield:clientid")],
    [B("کلید مخفی", "snapppayfield:secret")],
    [B("آدرس پایه API (اختیاری)", "snapppayfield:baseurl")],
    nav("gateway", "gateway")
  ]);
}

async function showHelp(env, adminId, section = "home") {
  // Per-field help: "help:field:<key>" -> SETTING_HELP of that setting.
  if (String(section).startsWith("field:")) {
    const key = section.slice("field:".length);

    return renderPanel(
      env,
      adminId,
      "📖 راهنمای فیلد «" + key + "»\n\n" +
        (SETTING_HELP[key] || "راهنمای جداگانه‌ای برای این فیلد ثبت نشده است."),
      [[B("🏠 خانه / لغو", "home")]]
    );
  }

  return renderPanel(
    env,
    adminId,
    HELP[section] || HELP.home,
    [[B("🏠 خانه / لغو", "home")]]
  );
}

/* Button picker for default_sort — no typing, no Persian/English drift. */
async function showSortPicker(env, adminId) {
  const settings = await getSettings(env);
  const current = SORT_OPTIONS.includes(settings.default_sort)
    ? settings.default_sort
    : "new";

  const labels = {
    new: "🆕 جدیدترین",
    pop: "🔥 محبوب‌ترین",
    cheap: "💵 ارزان‌ترین",
    expensive: "💎 گران‌ترین"
  };

  const keyboard = SORT_OPTIONS.map(value => [
    B(
      (value === current ? "✅ " : "") + labels[value],
      "sortpick:" + value
    )
  ]);

  keyboard.push([
    B("📖 راهنمای این تنظیم", "help:field:default_sort"),
    ...nav("settings:0", "settings")
  ]);

  return renderPanel(
    env,
    adminId,
    "مرتب‌سازی پیش‌فرض ویترین\n" +
      "حالت فعلی: " + labels[current] + "\n\n" +
      SETTING_HELP.default_sort,
    keyboard
  );
}

/* Button picker for the SMS provider (Kavenegar / FarazSMS / SMS.ir). */
async function showSmsProviderPicker(env, adminId) {
  const settings = await getSettings(env);
  const current = SMS_PROVIDERS.includes(settings.sms_provider)
    ? settings.sms_provider
    : "kavenegar";

  const keyboard = SMS_PROVIDERS.map(value => [
    B(
      (value === current ? "✅ " : "") + smsProviderLabel(value),
      "smsprovpick:" + value
    )
  ]);

  keyboard.push([
    B("📖 راهنمای این تنظیم", "help:field:sms_provider"),
    ...nav("settings:0", "settings")
  ]);

  return renderPanel(
    env,
    adminId,
    "سرویس پیامک کد تایید\n" +
      "سرویس فعلی: " + smsProviderLabel(current) + "\n\n" +
      SETTING_HELP.sms_provider,
    keyboard
  );
}

async function showList(env, adminId, kind, requestedPage = 0) {
  const model = MODELS[kind];
  if (!model) throw new Error("Unknown section.");

  const page = pageNumber(requestedPage);

  const records = await rows(
    env,
    `SELECT * FROM ${model.table}
     ORDER BY created_at DESC, id
     LIMIT ? OFFSET ?`,
    [PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  const keyboard = records.slice(0, PAGE_SIZE).map(record => {
    const title = kind === "k"
      ? record.label || record.bank_name || "کارت بدون عنوان"
      : record[model.name] || "بدون عنوان";

    return [
      B(
        (record[model.toggle] ? "🟢 " : "⚪ ") + cut(title, 35),
        `edit:${kind}:${record.id}`
      )
    ];
  });

  keyboard.push([B("➕ ایجاد", "new:" + kind)]);

  const pager = paging(
    "list:" + kind,
    page,
    records.length > PAGE_SIZE
  );

  if (pager.length) keyboard.push(pager);
  keyboard.push(nav("home", kind));

  return renderPanel(
    env,
    adminId,
    model.title +
      " — صفحه " + (page + 1).toLocaleString("fa-IR") +
      (!records.length ? "\nهنوز موردی ثبت نشده است." : ""),
    keyboard
  );
}

async function getRecord(env, kind, recordId) {
  const model = MODELS[kind];
  if (!model) throw new Error("Unknown record type.");

  const record = await one(
    env,
    `SELECT * FROM ${model.table} WHERE id=?`,
    [recordId]
  );

  if (!record) throw new Error("Record not found.");
  return record;
}

function displayField(field, value) {
  if (field === "expires_at") {
    return value
      ? new Date(value).toISOString()
      : "بدون انقضا";
  }

  if (field === "card_number") {
    return String(value || "").replace(/(.{4})(?=.)/g, "$1 ");
  }

  return value === null || value === ""
    ? "—"
    : cut(value, 140);
}

async function showEditor(env, adminId, kind, recordId) {
  const model = MODELS[kind];
  const record = await getRecord(env, kind, recordId);

  const text = [model.title];

  for (const [field, [label]] of Object.entries(model.fields)) {
    if (
      kind === "p" &&
      record.inventory_mode === "variants" &&
      ["stock", "low_stock_threshold"].includes(field)
    ) {
      continue;
    }

    text.push(label + ": " + displayField(field, record[field]));
  }

  text.push(
    "وضعیت: " + (record[model.toggle] ? "فعال / منتشرشده" : "غیرفعال / پیش‌نویس")
  );

  if (kind === "d") {
    text.push("استفاده فعلی: " + record.used);
  }

  const keyboard = [];

  for (const [field, [label]] of Object.entries(model.fields)) {
    if (
      kind === "p" &&
      record.inventory_mode === "variants" &&
      ["stock", "low_stock_threshold"].includes(field)
    ) {
      continue;
    }

    keyboard.push([
      B(label, `field:${kind}:${recordId}:${field}`)
    ]);
  }

  if (kind === "p") {
    text.push(
      "حالت موجودی: " +
      (INVENTORY_LABELS[record.inventory_mode] || record.inventory_mode)
    );

    const category = record.category_id
      ? await one(
          env,
          "SELECT name FROM categories WHERE id=?",
          [record.category_id]
        )
      : null;

    text.push("دسته‌بندی: " + (category?.name || "بدون دسته"));

    keyboard.push([
      B("🗂 انتخاب دسته", `pickcat:p:${recordId}:0`)
    ]);

    keyboard.push([
      B("⚙️ حالت موجودی و گزینه‌ها", "inventory:" + recordId)
    ]);

    if (record.inventory_mode === "variants") {
      keyboard.push([
        B("🎛 مدیریت ترکیب‌ها", `variants:${recordId}:0`)
      ]);
    }

    keyboard.push([
      B("📷 تصاویر محصول", "images:" + recordId)
    ]);
  }

  if (model.photo) {
    keyboard.push([
      B("🖼 ارسال / تعویض عکس", `photo:${kind}:${recordId}`),
      B("حذف عکس", `clearphoto:${kind}:${recordId}`)
    ]);
  }

  if (kind === "s") {
    text.push("نوع مقصد: " + record.target_type);

    keyboard.push([
      B("🔗 مقصد اسلاید", "target:" + recordId)
    ]);
  }

  keyboard.push([
    B(
      record[model.toggle] ? "⛔ غیرفعال‌کردن" : "✅ فعال / منتشرکردن",
      `toggle:${kind}:${recordId}`
    )
  ]);

  keyboard.push([
    B("🗑 حذف", `delete:${kind}:${recordId}`)
  ]);

  keyboard.push(nav("list:" + kind + ":0", kind));

  return renderPanel(
    env,
    adminId,
    text.join("\n\n"),
    keyboard
  );
}

/* Page index of a setting on the filtered settings keyboard. */
function settingsKeyIndex(key) {
  const keys = Object.keys(SETTING_FIELDS).filter(
    item => SETTING_FIELDS[item][1] !== "gatewaylist"
  );

  return keys.indexOf(key);
}

async function showSettings(env, adminId, requestedPage = 0) {
  // The multi-select gateway list is managed inside the gateway panel,
  // not as a free-text setting.
  const keys = Object.keys(SETTING_FIELDS).filter(
    key => SETTING_FIELDS[key][1] !== "gatewaylist"
  );
  const maximumPage = Math.max(0, Math.ceil(keys.length / PAGE_SIZE) - 1);
  const page = Math.min(pageNumber(requestedPage), maximumPage);
  const settings = await getSettings(env);

  const keyboard = keys
    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    .map(key => {
      const [label, type] = SETTING_FIELDS[key];

      return [
        B(
          label +
            (type === "bool"
              ? settings[key] ? " ✅" : " ⛔"
              : ""),
          "setting:" + key
        )
      ];
    });

  const pager = paging(
    "settings",
    page,
    (page + 1) * PAGE_SIZE < keys.length
  );

  if (pager.length) keyboard.push(pager);
  keyboard.push(nav("home", "settings"));

  return renderPanel(
    env,
    adminId,
    "تنظیمات فروشگاه — صفحه " +
      (page + 1).toLocaleString("fa-IR") +
      "\nتغییرات پس از تازه‌سازی سایت نمایش داده می‌شوند.",
    keyboard
  );
}


function parseCardNumber(input) {
  const number = digits(input).replace(/[\s-]/g, "");

  if (!/^\d{16}$/.test(number) || /^(\d)\1{15}$/.test(number)) {
    throw new Error("Enter a valid 16-digit bank card number.");
  }

  let sum = 0;

  for (let index = 0; index < number.length; index++) {
    let value = Number(number[index]) * (index % 2 === 0 ? 2 : 1);
    if (value > 9) value -= 9;
    sum += value;
  }

  if (sum % 10 !== 0) {
    throw new Error("The bank card checksum is invalid.");
  }

  // A valid checksum does not verify ownership or account activity.
  return number;
}

function parseRecordValue(spec, input) {
  const [, type, maximum] = spec;
  const raw = String(input ?? "").trim();
  const value = raw === "-" ? "" : raw;

  if (type === "integer") {
    return integer(value);
  }

  if (type === "stock") {
    return integer(value, 1000000000);
  }

  if (type === "position") {
    return integer(value, 1000000);
  }

  if (type === "card") {
    return parseCardNumber(value);
  }

  if (type === "coupon") {
    const code = digits(value).toUpperCase();

    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      throw new Error(
        "Use 3-32 English letters, digits, underscores or hyphens."
      );
    }

    return code;
  }

  if (type === "discountType") {
    if (!["percent", "fixed"].includes(value)) {
      throw new Error("Allowed values: percent, fixed.");
    }

    return value;
  }

  if (type === "date") {
    if (!value) return null;

    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
      throw new Error(
        "Use UTC format: 2030-12-31T23:59:59Z, or -."
      );
    }

    const timestamp = Date.parse(value);

    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString() !== value.replace("Z", ".000Z")
    ) {
      throw new Error("Invalid calendar date.");
    }

    return timestamp;
  }

  if (type === "required" && !value) {
    throw new Error("This field cannot be empty.");
  }

  if (value.length > (maximum || 250)) {
    throw new Error("Text exceeds the allowed length.");
  }

  return value;
}

async function createRecord(env, kind, updateId) {
  const model = MODELS[kind];
  if (!model) throw new Error("Unknown record type.");

  // Stable IDs prevent duplicate records if the same update is retried.
  const id = (await sha256(
    "bot-create:" + kind + ":" + String(updateId)
  )).slice(0, 32);

  const now = Date.now();

  if (kind === "c") {
    await execute(
      env,
      "INSERT OR IGNORE INTO categories(" +
      "id,name,enabled,created_at,updated_at" +
      ") VALUES(?,'دسته جدید',0,?,?)",
      [id, now, now]
    );
  } else if (kind === "d") {
    await execute(
      env,
      "INSERT OR IGNORE INTO coupons(" +
      "id,code,enabled,created_at,updated_at" +
      ") VALUES(?,?,0,?,?)",
      [id, "OFF" + id.slice(0, 10).toUpperCase(), now, now]
    );
  } else if (kind === "k") {
    await execute(
      env,
      "INSERT OR IGNORE INTO bank_cards(" +
      "id,bank_name,holder_name,card_number,label," +
      "enabled,created_at,updated_at" +
      ") VALUES(?,'','','0000000000000000','کارت جدید',0,?,?)",
      [id, now, now]
    );
  } else {
    await execute(
      env,
      `INSERT OR IGNORE INTO ${model.table}(
        id,created_at,updated_at
      ) VALUES(?,?,?)`,
      [id, now, now]
    );
  }

  return id;
}

async function updateRecordField(
  env,
  kind,
  recordId,
  field,
  input
) {
  const model = MODELS[kind];
  const spec = model?.fields[field];

  if (!spec) throw new Error("Unknown editable field.");

  const record = await getRecord(env, kind, recordId);

  if (
    kind === "p" &&
    record.inventory_mode === "variants" &&
    ["stock", "low_stock_threshold"].includes(field)
  ) {
    throw new Error(
      "Edit stock and alert thresholds on the individual variants."
    );
  }

  const value = parseRecordValue(spec, input);

  if (kind === "d") {
    const resultingType = field === "type" ? value : record.type;
    const resultingAmount = field === "amount" ? value : record.amount;

    if (resultingType === "percent" && resultingAmount > 100) {
      throw new Error(
        "Percentage must not exceed 100. Reduce the amount before switching type."
      );
    }

    await execute(
      env,
      `UPDATE coupons SET ${field}=?,version=version+1,updated_at=?
       WHERE id=?`,
      [value, Date.now(), recordId]
    );

    return;
  }

  await execute(
    env,
    `UPDATE ${model.table} SET ${field}=?,updated_at=? WHERE id=?`,
    [value, Date.now(), recordId]
  );
}

async function setRecordEnabled(env, kind, recordId, enabled) {
  const model = MODELS[kind];
  const record = await getRecord(env, kind, recordId);

  if (!model?.toggle) {
    throw new Error("This record has no visibility control.");
  }

  const desired = enabled ? 1 : 0;

  if (desired) {
    if (kind === "k") {
      if (!record.bank_name.trim() || !record.holder_name.trim()) {
        throw new Error("Complete the bank name and account holder first.");
      }

      parseCardNumber(record.card_number);
    }

    if (kind === "s") {
      if (!record.image_id) {
        throw new Error("Upload the slide image before enabling it.");
      }

      if (record.target_type === "url") {
        if (!record.target_url) {
          throw new Error("Set the slide destination URL.");
        }
        safeURL(record.target_url);
      }

      if (record.target_type === "category") {
        const category = await one(
          env,
          "SELECT id FROM categories WHERE id=? AND enabled=1",
          [record.target_category_id]
        );

        if (!category) {
          throw new Error("Choose an enabled destination category.");
        }
      }

      const count = await one(
        env,
        "SELECT COUNT(*) AS total FROM slides WHERE enabled=1 AND id!=?",
        [recordId]
      );

      if (count.total >= 5) {
        throw new Error("Maximum 5 enabled slides.");
      }
    }

    if (kind === "w" && !record.body.trim()) {
      throw new Error("Write the post body before publishing it.");
    }

    if (kind === "f" && !record.answer.trim()) {
      throw new Error("Write the answer before publishing it.");
    }

    if (kind === "p") {
      await validateProductPublish(env, record);
    }

    if (kind === "d") {
      if (record.type === "percent" && record.amount > 100) {
        throw new Error("Percentage must not exceed 100.");
      }

      if (record.expires_at && record.expires_at <= Date.now()) {
        throw new Error("The coupon has already expired.");
      }
    }
  }

  if (kind === "d") {
    await execute(
      env,
      "UPDATE coupons SET enabled=?,version=version+1,updated_at=? WHERE id=?",
      [desired, Date.now(), recordId]
    );
  } else {
    await execute(
      env,
      `UPDATE ${model.table}
       SET ${model.toggle}=?,updated_at=?
       WHERE id=?`,
      [desired, Date.now(), recordId]
    );
  }
}

async function deleteRecord(env, kind, recordId) {
  const model = MODELS[kind];
  if (!model) throw new Error("Unknown record type.");

  if (kind === "p") {
    await deleteProduct(env, recordId);
    return;
  }

  if (kind === "d") {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE coupons SET enabled=0,version=version+1,updated_at=? WHERE id=?"
      ).bind(Date.now(), recordId),

      env.DB.prepare(
        "DELETE FROM coupons WHERE id=? AND NOT EXISTS(" +
        "SELECT 1 FROM orders WHERE coupon_id=?" +
        ")"
      ).bind(recordId, recordId)
    ]);

    return;
  }

  await execute(
    env,
    `DELETE FROM ${model.table} WHERE id=?`,
    [recordId]
  );
}

async function showDeleteConfirmation(env, adminId, kind, recordId) {
  const record = await getRecord(env, kind, recordId);
  const model = MODELS[kind];

  let message =
    "این مورد حذف شود؟\n\n" +
    cut(record[model.name] || model.title, 200);

  if (kind === "p") {
    message +=
      "\n\nمحصول دارای سابقه سفارش فقط پنهان می‌شود؛ " +
      "اطلاعات سفارش‌های قبلی حفظ می‌شوند.";
  }

  if (kind === "d") {
    message +=
      "\n\nتخفیف دارای سابقه سفارش فقط غیرفعال می‌شود.";
  }

  if (kind === "c") {
    message +=
      "\n\nمحصولات حذف نمی‌شوند؛ دسته‌بندی آن‌ها خالی می‌شود. " +
      "مقصد اسلایدهای متصل را بعداً بررسی کنید.";
  }

  return renderPanel(
    env,
    adminId,
    message,
    [
      [B("بله، حذف شود", `deleteyes:${kind}:${recordId}`)],
      nav(`edit:${kind}:${recordId}`, kind)
    ]
  );
}

async function showCategoryPicker(
  env,
  adminId,
  ownerKind,
  ownerId,
  requestedPage = 0
) {
  if (!["p", "s"].includes(ownerKind)) {
    throw new Error("Invalid category picker.");
  }

  await getRecord(env, ownerKind, ownerId);
  await putSession(env, adminId, {
  action: "categoryPicker",
  ownerKind,
  ownerId
});
  

  const page = pageNumber(requestedPage);

  const records = await rows(
    env,
    "SELECT id,name,enabled FROM categories " +
    "ORDER BY position,created_at,id LIMIT ? OFFSET ?",
    [PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  const keyboard = records.slice(0, PAGE_SIZE).map(category => [
    B(
      (category.enabled ? "" : "⚪ ") + cut(category.name, 35),
      "setcat:" + category.id
    )
  ]);

  if (ownerKind === "p") {
    keyboard.push([
      B("بدون دسته‌بندی", "setcat:none")
    ]);
  }

  const pager = paging(
    `pickcat:${ownerKind}:${ownerId}`,
    page,
    records.length > PAGE_SIZE
  );

  if (pager.length) keyboard.push(pager);

  keyboard.push(
    nav(
      ownerKind === "p"
        ? "edit:p:" + ownerId
        : "target:" + ownerId,
      ownerKind
    )
  );

  return renderPanel(
    env,
    adminId,
    "دسته‌بندی را انتخاب کنید.\n" +
      "علامت سفید یعنی دسته در فهرست عمومی غیرفعال است.",
    keyboard
  );
}

async function showSlideTarget(env, adminId, slideId) {
  const slide = await getRecord(env, "s", slideId);

  return renderPanel(
    env,
    adminId,
    "مقصد اسلاید\n\n" +
      "نوع فعلی: " + slide.target_type +
      (slide.target_url ? "\n" + cut(slide.target_url, 500) : ""),
    [
      [B("بدون مقصد", "targetnone:" + slideId)],
      [B("انتخاب دسته‌بندی", `pickcat:s:${slideId}:0`)],
      [B("لینک دلخواه", "targeturl:" + slideId)],
      nav("edit:s:" + slideId, "s")
    ]
  );
}

async function showImages(env, adminId, productId) {
  const product = await getRecord(env, "p", productId);

  const images = await rows(
    env,
    "SELECT media_id,position FROM product_images " +
    "WHERE product_id=? ORDER BY position,media_id",
    [productId]
  );

  const keyboard = images.map((image, index) => [
    B(
      "نمایش عکس " + (index + 1).toLocaleString("fa-IR"),
      "imageview:" + image.media_id
    ),
    B(
      "حذف",
      `imagedel:${productId}:${index}`
    )
  ]);

  if (images.length < 6) {
    keyboard.push([
      B("➕ افزودن عکس", "imageadd:" + productId)
    ]);
  }

  keyboard.push(nav("edit:p:" + productId, "p"));

  return renderPanel(
    env,
    adminId,
    "تصاویر «" + cut(product.name, 100) + "»\n" +
      "تعداد: " + images.length.toLocaleString("fa-IR") + " از ۶\n" +
      "اولین تصویر، عکس اصلی محصول است.\n" +
      "برای جابه‌جایی در این نسخه، عکس را حذف و دوباره اضافه کنید.",
    keyboard
  );
}

async function showInventory(env, adminId, productId) {
  const product = await getRecord(env, "p", productId);
  const schema = JSON.parse(product.option_schema);

  const summary = schema.length
    ? schema.map(group =>
        group.name + ": " + group.values.join("، ")
      ).join("\n")
    : "هنوز گزینه‌ای تعریف نشده است.";

  return renderPanel(
    env,
    adminId,
    "حالت موجودی محصول\n\n" +
      "فعلی: " + INVENTORY_LABELS[product.inventory_mode] +
      "\n\n" + cut(summary, 1800) +
      "\n\nتغییر حالت ابتدا پیش‌نمایش دارد و بدون تأیید ذخیره نمی‌شود.\n" +
      "محصول دارای سفارش فعال اجازه تغییر ساختار ندارد.",
    [
      [B("ساده؛ بدون گزینه", `mode:${productId}:simple`)],
      [B("گزینه‌ها با موجودی مشترک", `mode:${productId}:shared`)],
      [B("ترکیب‌ها با موجودی مستقل", `mode:${productId}:variants`)],
      ...(product.inventory_mode === "variants"
        ? [[B("مدیریت ترکیب‌ها", `variants:${productId}:0`)]]
        : []),
      nav("edit:p:" + productId, "options")
    ]
  );
}

async function showVariants(env, adminId, productId, requestedPage = 0) {
  const product = await getRecord(env, "p", productId);

  if (product.inventory_mode !== "variants") {
    throw new Error("This product does not use independent variants.");
  }

  const page = pageNumber(requestedPage);

  const records = await rows(
    env,
    "SELECT * FROM variants WHERE product_id=? " +
    "ORDER BY created_at,id LIMIT ? OFFSET ?",
    [productId, PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  const keyboard = records.slice(0, PAGE_SIZE).map(variant => [
    B(
      (variant.enabled ? "🟢 " : "⚪ ") +
        cut(selectionLabel(variant.options), 35) +
        " · " + Number(variant.stock).toLocaleString("fa-IR"),
      "variant:" + variant.id
    )
  ]);

  keyboard.push([
    B("📝 ویرایش گروهی موجودی و قیمت", "variantbulk:" + productId)
  ]);

  keyboard.push([
    B("🔔 آستانه هشدار همه ترکیب‌ها", "variantthreshold:" + productId)
  ]);

  const pager = paging(
    "variants:" + productId,
    page,
    records.length > PAGE_SIZE
  );

  if (pager.length) keyboard.push(pager);

  keyboard.push(nav("inventory:" + productId, "variants"));

  return renderPanel(
    env,
    adminId,
    "ترکیب‌های «" + cut(product.name, 100) + "»\n" +
      "صفحه " + (page + 1).toLocaleString("fa-IR") +
      "\nعدد کنار هر ترکیب، موجودی قابل فروش فعلی است.",
    keyboard
  );
}

async function getVariant(env, variantId) {
  const variant = await one(
    env,
    "SELECT v.*,p.name AS product_name,p.price AS base_price," +
    "p.inventory_mode AS product_inventory_mode " +
    "FROM variants v JOIN products p ON p.id=v.product_id " +
    "WHERE v.id=?",
    [variantId]
  );

  if (!variant) throw new Error("Variant not found.");

  if (variant.product_inventory_mode !== "variants") {
    throw new Error("The product no longer uses independent variants.");
  }

  return variant;
}

async function showVariant(env, adminId, variantId) {
  const variant = await getVariant(env, variantId);

  return renderPanel(
    env,
    adminId,
    [
      variant.product_name,
      selectionLabel(variant.options),
      "",
      "موجودی: " + Number(variant.stock).toLocaleString("fa-IR"),
      "قیمت: " +
        (variant.price === null
          ? money(variant.base_price) + " — قیمت پایه"
          : money(variant.price)),
      "آستانه هشدار: " +
        (variant.low_stock_threshold
          ? Number(variant.low_stock_threshold).toLocaleString("fa-IR")
          : "خاموش"),
      "وضعیت: " + (variant.enabled ? "فعال" : "غیرفعال")
    ].join("\n"),
    [
      [B("موجودی", `vfield:${variantId}:stock`)],
      [B("قیمت اختصاصی؛ خط تیره قیمت پایه", `vfield:${variantId}:price`)],
      [B("آستانه هشدار", `vfield:${variantId}:threshold`)],
      [
        B(
          variant.enabled ? "غیرفعال‌کردن" : "فعال‌کردن",
          `vtoggle:${variantId}:${variant.enabled ? 0 : 1}`
        )
      ],
      nav(`variants:${variant.product_id}:0`, "variants")
    ]
  );
}

async function showOrders(env, adminId, requestedPage = 0) {
  const page = pageNumber(requestedPage);

  const records = await rows(
    env,
    "SELECT id,code,name,status,payment_status FROM orders " +
    "ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
    [PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  const keyboard = records.slice(0, PAGE_SIZE).map(order => [
    B(
      order.code +
        " · " + ORDER_STATUS[order.status] +
        (order.payment_status === "review" ? " 🧾" : "") +
        (order.payment_status === "paid" ? " 💳" : ""),
      "order:" + order.id
    )
  ]);

  keyboard.push([
    B("🔎 جست‌وجو با کد یا موبایل", "findorder")
  ]);

  const pager = paging(
    "orders",
    page,
    records.length > PAGE_SIZE
  );

  if (pager.length) keyboard.push(pager);
  keyboard.push(nav("home", "orders"));

  return renderPanel(
    env,
    adminId,
    "سفارش‌ها — صفحه " + (page + 1).toLocaleString("fa-IR") +
      "\n🧾 نیازمند بررسی رسید · 💳 پرداخت تأییدشده" +
      (!records.length ? "\nهنوز سفارشی ثبت نشده است." : ""),
    keyboard
  );
}

async function showOrder(env, adminId, orderId, requestedPage = 0) {
  const order = await one(
    env,
    "SELECT * FROM orders WHERE id=?",
    [orderId]
  );

  if (!order) throw new Error("Order not found.");

  const lines = await rows(
    env,
    "SELECT * FROM order_lines WHERE order_id=? ORDER BY id",
    [orderId]
  );

  const receiptCount = await one(
    env,
    "SELECT COUNT(*) AS total FROM receipts WHERE order_id=?",
    [orderId]
  );

  const content = [
    "کد: " + order.code,
    "سفارش: " + ORDER_STATUS[order.status],
    "پرداخت: " + PAYMENT_STATUS[order.payment_status],
    "روش: " +
      (order.gateway
        ? "پرداخت آنلاین (" + gatewayLabel(order.gateway) + ")"
        : order.payment_method === "card"
          ? "کارت‌به‌کارت"
          : "هماهنگی با مدیر"),
    "",
    "نام: " + order.name,
    "موبایل: " + order.phone,
    "نشانی: " + order.address,
    "کد پستی: " + (order.postal || "—"),
    "توضیحات: " + (order.note || "—"),
    "",
    "کالاها: " + money(order.subtotal),
    "ارسال: " + money(order.shipping),
    "تخفیف: " + money(order.discount),
    "کد تخفیف: " + (order.coupon_code || "—"),
    "مبلغ نهایی: " + money(order.total),
    "",
    "ثبت: " + new Date(order.created_at).toLocaleString("fa-IR", {
      timeZone: "Asia/Tehran"
    }),
    ...(order.expires_at
      ? [
          "پایان مهلت: " +
          new Date(order.expires_at).toLocaleString("fa-IR", {
            timeZone: "Asia/Tehran"
          })
        ]
      : []),
    ...(order.paid_at
      ? [
          "تأیید پرداخت: " +
          new Date(order.paid_at).toLocaleString("fa-IR", {
            timeZone: "Asia/Tehran"
          })
        ]
      : []),
    "",
    "اقلام سفارش:",
    ...lines.map((line, index) => {
      const selected = selectionLabel(line.selection);

      return [
        (index + 1).toLocaleString("fa-IR") + ". " + line.name,
        selected,
        "تعداد: " + Number(line.quantity).toLocaleString("fa-IR"),
        "قیمت واحد: " + money(line.price),
        "جمع: " + money(line.price * line.quantity)
      ].filter(Boolean).join("\n");
    })
  ].join("\n");

  // Keep long order details inside the existing panel.
  const chunkSize = 3100;
  const totalPages = Math.max(1, Math.ceil(content.length / chunkSize));
  const page = Math.min(pageNumber(requestedPage), totalPages - 1);

  const keyboard = [];
  const pager = paging(
    "orderpage:" + orderId,
    page,
    page + 1 < totalPages
  );

  if (pager.length) keyboard.push(pager);

  if (receiptCount.total) {
    keyboard.push([
      B(
        "🧾 رسیدها (" +
          Number(receiptCount.total).toLocaleString("fa-IR") + ")",
        "receipts:" + orderId
      )
    ]);
  }

  if (
    ["new", "confirmed"].includes(order.status) &&
    order.payment_status !== "paid"
  ) {
    keyboard.push([
      B("💳 بررسی و تأیید دستی پرداخت", "approvepay:" + orderId)
    ]);
  }

  if (order.status === "new") {
    keyboard.push([
      B("✅ تأیید سفارش", "statusask:" + orderId + ":confirmed")
    ]);
  }

  if (order.status === "confirmed") {
    keyboard.push([
      B("🚚 ثبت ارسال", "statusask:" + orderId + ":sent")
    ]);
  }

  if (
    ["new", "confirmed"].includes(order.status) &&
    order.payment_status !== "paid"
  ) {
    keyboard.push([
      B("❌ لغو و آزادسازی موجودی", "statusask:" + orderId + ":cancelled")
    ]);
  }

  keyboard.push(nav("orders:0", "orders"));

  return renderPanel(
    env,
    adminId,
    content.slice(page * chunkSize, (page + 1) * chunkSize) +
      (totalPages > 1
        ? "\n\nصفحه " + (page + 1).toLocaleString("fa-IR") +
          " از " + totalPages.toLocaleString("fa-IR")
        : ""),
    keyboard
  );
}

async function showOrderStatusConfirmation(
  env,
  adminId,
  orderId,
  nextStatus
) {
  if (!["confirmed", "sent", "cancelled"].includes(nextStatus)) {
    throw new Error("Invalid order status.");
  }

  const order = await one(
    env,
    "SELECT code,status,payment_status FROM orders WHERE id=?",
    [orderId]
  );

  if (!order) throw new Error("Order not found.");

  const allowed =
    (order.status === "new" &&
      ["confirmed", "cancelled"].includes(nextStatus)) ||
    (order.status === "confirmed" &&
      ["sent", "cancelled"].includes(nextStatus));

  if (!allowed) {
    throw new Error("This status transition is no longer available.");
  }

  if (nextStatus === "cancelled" && order.payment_status === "paid") {
    throw new Error("Paid orders require a separate refund workflow.");
  }

  let message =
    "سفارش " + order.code +
    "\nوضعیت به «" + ORDER_STATUS[nextStatus] + "» تغییر کند؟";

  if (nextStatus === "cancelled") {
    message +=
      "\n\nموجودی آزاد می‌شود. این کار به معنی بازپرداخت وجه نیست.";
  }

  if (nextStatus === "sent" && order.payment_status !== "paid") {
    message +=
      "\n\n⚠️ پرداخت این سفارش هنوز تأیید نشده است.";
  }

  return renderPanel(
    env,
    adminId,
    message,
    [
      [B("بله، انجام شود", `statusdo:${orderId}:${nextStatus}`)],
      nav("order:" + orderId, "orders")
    ]
  );
}

async function showPaymentConfirmation(env, adminId, orderId) {
  const order = await one(
    env,
    "SELECT code,total,status,payment_status FROM orders WHERE id=?",
    [orderId]
  );

  if (!order) throw new Error("Order not found.");

  if (!["new", "confirmed"].includes(order.status)) {
    throw new Error("This order cannot be marked as paid.");
  }

  if (order.payment_status === "paid") {
    return showOrder(env, adminId, orderId);
  }

  return renderPanel(
    env,
    adminId,
    "تأیید دستی دریافت وجه\n\n" +
      "سفارش: " + order.code +
      "\nمبلغ: " + money(order.total) +
      "\n\nآیا ورود این مبلغ را در حساب بانکی خود بررسی کرده‌اید؟\n" +
      "تصویر رسید به‌تنهایی کافی نیست.\n" +
      "این عملیات تأیید آنلاین بانک نیست و با شناسه شما ثبت می‌شود.",
    [
      [B("بله، دریافت وجه را بررسی کردم", "approvepayyes:" + orderId)],
      nav("order:" + orderId, "orders")
    ]
  );
}

async function showReceipts(env, adminId, orderId) {
  const order = await one(
    env,
    "SELECT code FROM orders WHERE id=?",
    [orderId]
  );

  if (!order) throw new Error("Order not found.");

  const receipts = await rows(
    env,
    "SELECT id,uploaded_at FROM receipts WHERE order_id=? " +
    "ORDER BY uploaded_at DESC LIMIT 10",
    [orderId]
  );

  const keyboard = receipts.map((receipt, index) => [
    B(
      "نمایش رسید " + (index + 1).toLocaleString("fa-IR") +
        " · " + new Date(receipt.uploaded_at).toLocaleDateString("fa-IR", {
          timeZone: "Asia/Tehran"
        }),
      "receiptview:" + receipt.id
    )
  ]);

  keyboard.push(nav("order:" + orderId, "orders"));

  return renderPanel(
    env,
    adminId,
    "رسیدهای سفارش " + order.code +
      "\nرسید در یک پیام تصویری جداگانه برای شما نمایش داده می‌شود." +
      (!receipts.length ? "\nرسیدی ثبت نشده است." : ""),
    keyboard
  );
}

async function showOrderSearchResults(env, adminId, input) {
  const query = digits(String(input)).trim().toUpperCase();

  if (!query || query.length > 40) {
    throw new Error("Enter a complete order code or mobile number.");
  }

  const records = await rows(
    env,
    "SELECT id,code,name,status FROM orders " +
    "WHERE code=? OR phone=? ORDER BY created_at DESC LIMIT 20",
    [query, query]
  );

  return renderPanel(
    env,
    adminId,
    records.length
      ? "نتیجه جست‌وجو — حداکثر ۲۰ سفارش اخیر"
      : "سفارشی پیدا نشد.",
    [
      ...records.map(order => [
        B(
          order.code + " · " + cut(order.name, 20) +
            " · " + ORDER_STATUS[order.status],
          "order:" + order.id
        )
      ]),
      nav("orders:0", "orders")
    ]
  );
}

async function showAdmins(env, adminId, access, requestedPage = 0) {
  const page = pageNumber(requestedPage);

  const admins = await rows(
    env,
    "SELECT id,name,role,permissions FROM admins ORDER BY created_at,id LIMIT ? OFFSET ?",
    [PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  const owners = await one(
    env,
    "SELECT COUNT(*) AS total FROM admins WHERE role='owner'"
  );

  const keyboard = admins.slice(0, PAGE_SIZE).map(admin => {
    const lastOwner =
      admin.role === "owner" && Number(owners?.total || 0) < 2;

    const displayName = String(admin.name || "").trim();

    const row = [
      B(
        "👤 " + (displayName ? displayName + " (" + admin.id + ")" : admin.id) +
          " — " + accessLabel(accessOf(admin)) +
          (admin.id === String(adminId) ? " (شما)" : ""),
        "adminrole:" + admin.id
      )
    ];

    // Renaming and removing administrators is reserved to the owner.
    if (access.isOwner) {
      row.push(B("✏️", "adminname:" + admin.id));

      if (!lastOwner) {
        row.push(B("🗑", "deladmin:" + admin.id));
      }
    }

    return row;
  });

  keyboard.push([B("➕ افزودن مدیر", "addadmin")]);

  const pager = paging(
    "adminpage",
    page,
    admins.length > PAGE_SIZE
  );

  if (pager.length) keyboard.push(pager);
  keyboard.push(nav("home", "admins"));

  return renderPanel(
    env,
    adminId,
    "مدیران فروشگاه\n" +
      "برای دیدن یا تغییر دسترسی‌ها روی یک مدیر بزنید.\n" +
      "دسترسی هر مدیر می‌تواند ترکیب چک‌باکسی از بخش‌ها باشد.\n" +
      "✏️ نام نمایشی مدیر (برای گزارش فعالیت) — فقط مدیر اصلی.\n" +
      "حذف مدیران فقط با مدیر اصلی.",
    keyboard
  );
}

async function showAdminRole(env, adminId, access, targetId) {
  const target = await one(
    env,
    "SELECT id,name,role,permissions FROM admins WHERE id=?",
    [String(targetId)]
  );

  if (!target) throw new Error("Administrator not found.");

  const targetAccess = accessOf(target);
  const owners = await one(
    env,
    "SELECT COUNT(*) AS total FROM admins WHERE role='owner'"
  );

  const lastOwner =
    target.role === "owner" && Number(owners?.total || 0) < 2;

  const shownName = String(target.name || "").trim();

  const text = [
    "🔑 دسترسی‌های مدیر " +
      (shownName ? shownName + " (" + target.id + ")" : target.id),
    "سطح فعلی: " + accessLabel(targetAccess),
    "بخش‌ها: " + describeAccess(targetAccess)
  ];

  const keyboard = [];

  if (target.role === "owner") {
    text.push(
      "",
      "مدیر اصلی دسترسی کامل و ثابت دارد و قابل تغییر نیست."
    );
  } else {
    text.push(
      "",
      "یک سطح آماده انتخاب کنید یا دسترسی سفارشی چک‌باکسی بسازید:"
    );

    for (const role of ["owner", "admin", "operator"]) {
      if (role === target.role) continue;
      if (!canGrantRole(access, role)) continue;

      keyboard.push([
        B(roleLabel(role), "adminroleset:" + target.id + ":" + role)
      ]);
    }

    keyboard.push([
      B("🎲 دسترسی سفارشی (چک‌باکس)", "admincustom:" + target.id)
    ]);
  }

  if (access.isOwner) {
    keyboard.push([B("✏️ تغییر نام نمایشی", "adminname:" + target.id)]);

    if (lastOwner) {
      text.push("", "آخرین مدیر اصلی قابل حذف نیست.");
    } else {
      keyboard.push([B("🗑 حذف این مدیر", "deladmin:" + target.id)]);
    }
  }

  keyboard.push(nav("admins", "admins"));

  return renderPanel(
    env,
    adminId,
    text.join("\n"),
    keyboard
  );
}

/*
 * Checkbox permission editor. Every toggle is persisted immediately by
 * switching the target to role='custom'; the checked state always comes
 * from the database, so no save button is needed.
 */
async function showAdminCustom(env, adminId, access, targetId) {
  const target = await one(
    env,
    "SELECT id,role,permissions FROM admins WHERE id=?",
    [String(targetId)]
  );

  if (!target) throw new Error("Administrator not found.");

  const targetAccess = accessOf(target);

  if (target.role === "owner") {
    throw new Error("مدیر اصلی دسترسی کامل و ثابت دارد.");
  }

  if (target.id === String(adminId) && !access.isOwner) {
    // Changing your own permissions is owner-only, same rule as adminperm.
    throw new Error("تغییر دسترسی خودتان فقط توسط مدیر اصلی انجام می‌شود.");
  }

  const checked = new Set(targetAccess.perms);

  const notes = [];

  if (!access.isOwner) {
    notes.push(
      "شما فقط می‌توانید بخش‌هایی را بدهید که خودتان دارید؛\n" +
      "بخش‌های غیرمجاز با 🔒 مشخص شده‌اند."
    );
  }

  notes.push(
    "هر لمس، همان لحظه ذخیره می‌شود و سطح مدیر به «دسترسی سفارشی» تبدیل می‌شود."
  );

  const keyboard = ALL_PERMISSIONS.map(key => {
    const locked = !access.isOwner && !access.perms.includes(key);

    return [
      B(
        (checked.has(key) ? "✅ " : "⬜ ") +
          PERMISSIONS[key] +
          (locked ? " 🔒" : ""),
        "adminperm:" + target.id + ":" + key
      )
    ];
  });

  keyboard.push(nav("adminrole:" + target.id, "admins"));

  return renderPanel(
    env,
    adminId,
    [
      "🎛 دسترسی سفارشی مدیر " + target.id,
      "سطح فعلی: " + accessLabel(targetAccess),
      "",
      ...notes
    ].join("\n"),
    keyboard
  );
}

async function showStats(env, adminId) {
  const now = Date.now();

  const [orders, products, variants, best] = await Promise.all([
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
      `SELECT
        COUNT(*) AS total,
        SUM(published=1) AS published,
        COALESCE(SUM(
          stock * (inventory_mode IN ('simple','shared'))
        ),0) AS units
       FROM products`
    ),

    one(
      env,
      "SELECT COUNT(*) AS total,COALESCE(SUM(v.stock),0) AS units " +
      "FROM variants v JOIN products p ON p.id=v.product_id " +
      "WHERE p.inventory_mode='variants' AND v.enabled=1"
    ),

    rows(
      env,
      "SELECT l.product_id,MAX(l.name) AS name,SUM(l.quantity) AS quantity " +
      "FROM order_lines l JOIN orders o ON o.id=l.order_id " +
      "WHERE o.payment_status='paid' AND o.status!='cancelled' " +
      "GROUP BY l.product_id ORDER BY quantity DESC LIMIT 5"
    )
  ]);

  return renderPanel(
    env,
    adminId,
    [
      "📊 آمار فروشگاه",
      "",
      "کل سفارش‌ها: " + Number(orders.total || 0).toLocaleString("fa-IR"),
      "جدید: " + Number(orders.new_count || 0).toLocaleString("fa-IR"),
      "تأییدشده: " + Number(orders.confirmed_count || 0).toLocaleString("fa-IR"),
      "ارسال‌شده: " + Number(orders.sent_count || 0).toLocaleString("fa-IR"),
      "لغوشده: " + Number(orders.cancelled_count || 0).toLocaleString("fa-IR"),
      "رسید نیازمند بررسی: " + Number(orders.review_count || 0).toLocaleString("fa-IR"),
      "",
      "پرداخت‌های تأییدشده: " + money(orders.paid_total),
      "پرداخت‌های تأییدشده ۳۰ روز اخیر: " + money(orders.paid_month),
      "",
      "تعداد محصولات: " + Number(products.total || 0).toLocaleString("fa-IR"),
      "محصولات منتشرشده: " + Number(products.published || 0).toLocaleString("fa-IR"),
      "موجودی آزاد ساده/مشترک: " + Number(products.units || 0).toLocaleString("fa-IR"),
      "موجودی آزاد تنوع‌های فعال: " + Number(variants.units || 0).toLocaleString("fa-IR"),
      "",
      "پرفروش‌ها بر اساس سفارش پرداخت‌شده:",
      ...best.map(item =>
        cut(item.name, 80) + " — " +
        Number(item.quantity).toLocaleString("fa-IR")
      ),
      "",
      "این گزارش سود خالص، تسویه بانکی یا سند حسابداری رسمی نیست."
    ].join("\n"),
    [[B("↻ تازه‌سازی", "stats"), B("🏠 خانه", "home")]]
  );
}

/*
 * Owner-only activity report. Two sections mirror the audit log:
 * catalog (products/content) and orders. It answers "what has each
 * administrator (by numeric ID) been doing?".
 */
const LOG_PAGE_SIZE = 8;

async function showLogAdmins(env, adminId, access, requestedPage = 0) {
  if (!access.isOwner) {
    throw new Error("گزارش فعالیت فقط برای مدیر اصلی قابل مشاهده است.");
  }

  await clearSession(env, adminId);

  const page = pageNumber(requestedPage);

  const admins = await rows(
    env,
    "SELECT id,name,role,permissions FROM admins ORDER BY created_at,id LIMIT ? OFFSET ?",
    [PAGE_SIZE + 1, page * PAGE_SIZE]
  );

  const keyboard = admins.slice(0, PAGE_SIZE).map(admin => {
    const displayName = String(admin.name || "").trim();

    return [
      B(
        "👤 " + (displayName ? displayName + " (" + admin.id + ")" : admin.id) +
          " — " + accessLabel(accessOf(admin)),
        "logsel:" + admin.id
      )
    ];
  });

  const pager = paging("logs", page, admins.length > PAGE_SIZE);

  if (pager.length) keyboard.push(pager);
  keyboard.push(nav("home", "admins"));

  return renderPanel(
    env,
    adminId,
    "🕵️ گزارش فعالیت مدیران\n" +
      "یک مدیر را انتخاب کنید تا کارهایش را ببینید.",
    keyboard
  );
}

async function showLogSections(env, adminId, access, targetId) {
  if (!access.isOwner) {
    throw new Error("گزارش فعالیت فقط برای مدیر اصلی قابل مشاهده است.");
  }

  await clearSession(env, adminId);

  const target = await one(
    env,
    "SELECT id,name,role,permissions FROM admins WHERE id=?",
    [String(targetId)]
  );

  if (!target) throw new Error("Administrator not found.");

  const counts = await one(
    env,
    "SELECT " +
    "SUM(section='catalog') AS catalog, " +
    "SUM(section='orders') AS orders " +
    "FROM admin_logs WHERE admin_id=?",
    [String(targetId)]
  );

  const shownName = String(target.name || "").trim();

  return renderPanel(
    env,
    adminId,
    "🕵️ فعالیت مدیر " +
      (shownName ? shownName + " (" + target.id + ")" : target.id) + "\n" +
      "سطح فعلی: " + accessLabel(accessOf(target)) + "\n\n" +
      "رویدادهای ثبت‌شده (۹۰ روز اخیر):\n" +
      "محصولات و محتوا: " + Number(counts?.catalog || 0).toLocaleString("fa-IR") + "\n" +
      "سفارش‌ها: " + Number(counts?.orders || 0).toLocaleString("fa-IR"),
    [
      [B("🛍 محصولات و محتوا", "logview:" + target.id + ":catalog:0")],
      [B("📦 سفارش‌ها", "logview:" + target.id + ":orders:0")],
      nav("logs", "admins")
    ]
  );
}

async function showLogView(env, adminId, access, targetId, section, requestedPage = 0) {
  if (!access.isOwner) {
    throw new Error("گزارش فعالیت فقط برای مدیر اصلی قابل مشاهده است.");
  }

  await clearSession(env, adminId);

  const page = pageNumber(requestedPage);
  const safeSection = section === "orders" ? "orders" : "catalog";

  const target = await one(
    env,
    "SELECT id,name FROM admins WHERE id=?",
    [String(targetId)]
  );

  const shownName = String(target?.name || "").trim();
  const targetLabel = shownName
    ? shownName + " (" + targetId + ")"
    : String(targetId);

  const events = await rows(
    env,
    "SELECT action,target,detail,created_at FROM admin_logs " +
    "WHERE admin_id=? AND section=? " +
    "ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
    [String(targetId), safeSection, LOG_PAGE_SIZE + 1, page * LOG_PAGE_SIZE]
  );

  const hasMore = events.length > LOG_PAGE_SIZE;

  const lines = events.slice(0, LOG_PAGE_SIZE).map(event => {
    const time = new Date(event.created_at).toLocaleString("fa-IR", {
      timeZone: "Asia/Tehran"
    });

    return "🕒 " + time + "\n" +
      "• " + event.action +
      (event.target ? "\n  «" + cut(event.target, 70) + "»" : "") +
      (event.detail ? "\n  " + cut(event.detail, 90) : "");
  });

  const keyboard = [];

  const pager = paging(
    "logview:" + targetId + ":" + safeSection,
    page,
    hasMore
  );

  if (pager.length) keyboard.push(pager);
  keyboard.push([B("↩ بازگشت", "logsel:" + targetId)]);
  keyboard.push(nav("home", "admins"));

  return renderPanel(
    env,
    adminId,
    (safeSection === "orders" ? "📦 فعالیت سفارش‌های " : "🛍 فعالیت محصولات و محتوای ") +
      targetLabel + "\n" +
      "صفحه " + (page + 1).toLocaleString("fa-IR") + "\n\n" +
      (lines.length ? lines.join("\n\n") : "رویدادی ثبت نشده است."),
    keyboard
  );
}


// ============================================================
// Persian Store V2 — Telegram administration
// PART 3 OF 3
// Append this below PART 2.
// ============================================================

async function showInventoryPreview(env, adminId, state) {
  const product = await getRecord(env, "p", state.productId);

  await requireStructureEditable(env, product.id);

  const schema = state.schema || [];
  const count = state.mode === "variants"
    ? combinations(schema, 100).length
    : 0;

  await putSession(env, adminId, {
    ...state,
    action: "inventoryConfirm"
  });

  return renderPanel(
    env,
    adminId,
    [
      "پیش‌نمایش ساختار محصول",
      "",
      product.name,
      "حالت جدید: " + INVENTORY_LABELS[state.mode],
      "",
      ...schema.map(group =>
        group.name + ": " + group.values.join("، ")
      ),
      ...(count ? ["", "تعداد ترکیب‌ها: " + count] : []),
      "",
      "پس از ذخیره، محصول پیش‌نویس می‌شود.",
      "ترکیب‌های جدید با موجودی صفر ساخته می‌شوند.",
      "موجودی ترکیب‌های قبلیِ یکسان حفظ می‌شود.",
      "ترکیب‌های حذف‌شده غیرفعال می‌شوند؛ سابقه سفارش حفظ می‌شود.",
      "در تغییر بین موجودی مستقل و مشترک، موجودی مشترک صفر می‌شود.",
      "بعد از بررسی موجودی و قیمت، دوباره محصول را منتشر کنید."
    ].join("\n"),
    [
      [B("✅ تأیید و ذخیره ساختار", "inventorysave")],
      nav("inventory:" + product.id, "options")
    ]
  );
}

async function showBulkVariants(
  env,
  adminId,
  productId,
  requestedPage = 0
) {
  const product = await getRecord(env, "p", productId);

  if (product.inventory_mode !== "variants") {
    throw new Error("This product does not use independent variants.");
  }

  const variants = await rows(
    env,
    "SELECT id,options,stock,price FROM variants " +
    "WHERE product_id=? ORDER BY created_at,id LIMIT 100",
    [productId]
  );

  if (!variants.length) {
    throw new Error("No variants were found.");
  }

  const perPage = 10;
  const pages = Math.max(1, Math.ceil(variants.length / perPage));
  const page = Math.min(pageNumber(requestedPage), pages - 1);

  const visible = variants.slice(
    page * perPage,
    (page + 1) * perPage
  );

  await putSession(env, adminId, {
    action: "variantBulk",
    productId,
    ids: variants.map(variant => variant.id),
    page
  });

  const keyboard = [];
  const pager = paging(
    "variantbulkpage:" + productId,
    page,
    page + 1 < pages
  );

  if (pager.length) keyboard.push(pager);
  keyboard.push(nav("variants:" + productId + ":0", "variants"));

  return renderPanel(
    env,
    adminId,
    [
      "ویرایش گروهی ترکیب‌ها",
      "هر خط: شماره | موجودی | قیمت اختیاری",
      "قیمت «-» یعنی قیمت پایه؛ حذف ستون قیمت یعنی حفظ قیمت فعلی.",
      "",
      "مثال:",
      "1 | 8 | -",
      "2 | 3 | 250000",
      "",
      "فهرست صفحه " + (page + 1) + ":",
      ...visible.map((variant, index) => {
        const number = page * perPage + index + 1;

        return (
          number + ") " + cut(selectionLabel(variant.options), 120) +
          "\nموجودی: " + variant.stock +
          " | قیمت: " +
          (variant.price === null ? "پایه" : variant.price)
        );
      }),
      "",
      "تغییرات را در یک پیام بفرستید.",
      "فقط ردیف‌هایی که ارسال می‌کنید تغییر می‌کنند."
    ].join("\n"),
    keyboard
  );
}

async function applyBulkVariants(env, state, input) {
  const product = await getRecord(env, "p", state.productId);

  if (product.inventory_mode !== "variants") {
    throw new Error("The inventory mode has changed.");
  }

  const lines = String(input)
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length || lines.length > 100) {
    throw new Error("Send 1-100 rows.");
  }

  const seen = new Set();
  const statements = [];
  const now = Date.now();

  for (const line of lines) {
    const parts = line.split("|").map(value => value.trim());

    if (parts.length < 2 || parts.length > 3) {
      throw new Error("Use: Number | Stock | Optional price");
    }

    const index = integer(parts[0], 100) - 1;
    const variantId = state.ids[index];

    if (!variantId || seen.has(variantId)) {
      throw new Error("Invalid or duplicate variant number.");
    }

    seen.add(variantId);

    const stock = integer(parts[1], 1000000000);

    if (parts.length === 3) {
      const price = parts[2] === "-"
        ? null
        : integer(parts[2]);

      statements.push(
        env.DB.prepare(
          "UPDATE variants SET stock=?,price=?,updated_at=? " +
          "WHERE id=? AND product_id=?"
        ).bind(stock, price, now, variantId, product.id)
      );
    } else {
      statements.push(
        env.DB.prepare(
          "UPDATE variants SET stock=?,updated_at=? " +
          "WHERE id=? AND product_id=?"
        ).bind(stock, now, variantId, product.id)
      );
    }
  }

  await env.DB.batch(statements);
}

async function beginRecordField(
  env,
  adminId,
  kind,
  recordId,
  field
) {
  const model = MODELS[kind];
  const spec = model?.fields[field];

  if (!spec) throw new Error("Unknown field.");

  const record = await getRecord(env, kind, recordId);
  const back = `edit:${kind}:${recordId}`;

  if (kind === "w" && field === "body") {
    await putSession(env, adminId, {
      action: "postBody",
      recordId,
      draft: "",
      back,
      help: "w"
    });

    return renderPanel(
      env,
      adminId,
      "نوشتن متن چندبخشی\n\n" +
        "متن فعلی تا زمان زدن «ذخیره» تغییر نمی‌کند.\n" +
        "هر پیام جدید به پیش‌نویس اضافه می‌شود.\n" +
        "حداکثر مجموع: ۱۲۰۰۰ کاراکتر.\n\n" +
        "اولین بخش متن را بفرستید.",
      [
        [B("ذخیره متن جدید", "postbodysave")],
        nav(back, "w")
      ]
    );
  }

  return prompt(
    env,
    adminId,
    {
      action: "recordField",
      kind,
      recordId,
      field
    },
    spec[0],
    back,
    kind,
    displayField(field, record[field])
  );
}

/*
 * Input steps may only be completed by a role that could also start
 * them; this blocks state-forged text input from lower-level roles.
 * Text-input states are gated the same way callbacks are; states that
 * edit a record resolve their permission from the record kind.
 */
function inputPermissionFor(state) {
  switch (state?.action) {
    case "recordField":
    case "recordPhoto":
      return MODEL_PERMISSIONS[state.kind] || null;

    case "postBody":
      return "posts";

    case "slideURL":
      return "slider";

    case "productPhoto":
    case "inventoryOptions":
    case "variantField":
    case "variantThreshold":
    case "variantBulk":
      return "products";

    case "setting":
      return "settings";

    case "gatewayMerchant":
    case "snapppayField":
      return "gateway";

    case "findOrder":
      return "orders";

    case "addAdmin":
    case "renameAdmin":
      return "admins";

    default:
      return null;
  }
}

async function handleBotInput(env, adminId, message, state, access) {
  const input = message.text ?? "";

  const requiredPermission = inputPermissionFor(state);

  if (requiredPermission && !roleAllows(access, requiredPermission)) {
    await clearSession(env, adminId);

    throw new Error(
      "سطح دسترسی شما این بخش را شامل نمی‌شود."
    );
  }

  if (state.action === "recordField") {
    if (typeof message.text !== "string") {
      throw new Error("Send a text message.");
    }

    const record = await getRecord(env, state.kind, state.recordId);

    await updateRecordField(
      env,
      state.kind,
      state.recordId,
      state.field,
      input
    );

    await logAdminAction(
      env,
      adminId,
      "catalog",
      "ویرایش «" + (MODELS[state.kind]?.fields?.[state.field]?.[0] || state.field) + "»",
      record?.[MODELS[state.kind]?.name] || "",
      MODELS[state.kind]?.title || ""
    );

    await clearSession(env, adminId);

    return showEditor(
      env,
      adminId,
      state.kind,
      state.recordId
    );
  }

  if (state.action === "postBody") {
    if (typeof message.text !== "string" || !input.trim()) {
      throw new Error("Send a non-empty text message.");
    }

    const addition = input.trim();
    const draft = state.draft
      ? state.draft + "\n\n" + addition
      : addition;

    if (draft.length > 12000) {
      throw new Error(
        "The complete post must not exceed 12000 characters."
      );
    }

    await putSession(env, adminId, {
      ...state,
      draft
    });

    return renderPanel(
      env,
      adminId,
      "بخش جدید به پیش‌نویس اضافه شد.\n" +
        "تعداد کاراکتر: " + draft.length.toLocaleString("fa-IR") +
        "\n\n" + cut(draft, 1500) +
        "\n\nبخش بعدی را بفرستید یا ذخیره را بزنید.",
      [
        [B("✅ ذخیره متن", "postbodysave")],
        nav("edit:w:" + state.recordId, "w")
      ]
    );
  }

  if (state.action === "setting") {
    const spec = SETTING_FIELDS[state.key];
    if (!spec) throw new Error("Unknown setting.");

    let value;

    if (["photo", "font"].includes(spec[1])) {
      value = input.trim() === "-"
        ? ""
        : await saveAdminMedia(env, message, spec[1]);
    } else {
      if (typeof message.text !== "string") {
        throw new Error("Send a text message.");
      }

      value = parseSetting(state.key, input);
    }

    await setSetting(env, state.key, value);
    await clearSession(env, adminId);

    return showSettings(
      env,
      adminId,
      Math.floor(settingsKeyIndex(state.key) / PAGE_SIZE)
    );
  }

  if (state.action === "recordPhoto") {
    const model = MODELS[state.kind];
    if (!model?.photo) throw new Error("This record has no image field.");

    await getRecord(env, state.kind, state.recordId);

    const mediaId = input.trim() === "-"
      ? null
      : await saveAdminMedia(env, message, "photo");

    await execute(
      env,
      `UPDATE ${model.table} SET ${model.photo}=?,updated_at=? WHERE id=?`,
      [mediaId, Date.now(), state.recordId]
    );

    await clearSession(env, adminId);

    return showEditor(
      env,
      adminId,
      state.kind,
      state.recordId
    );
  }

  if (state.action === "productPhoto") {
    await getRecord(env, "p", state.productId);

    const count = await one(
      env,
      "SELECT COUNT(*) AS total,COALESCE(MAX(position),-1) AS last " +
      "FROM product_images WHERE product_id=?",
      [state.productId]
    );

    if (count.total >= 6) {
      throw new Error("Maximum 6 images per product.");
    }

    const mediaId = await saveAdminMedia(env, message, "photo");

    await execute(
      env,
      "INSERT INTO product_images(product_id,media_id,position) VALUES(?,?,?)",
      [state.productId, mediaId, count.last + 1]
    );

    await clearSession(env, adminId);
    return showImages(env, adminId, state.productId);
  }

  if (state.action === "slideURL") {
    const url = safeURL(input.trim());

    if (!url) {
      throw new Error("Enter a complete destination URL.");
    }

    await execute(
      env,
      "UPDATE slides SET target_type='url',target_url=?," +
      "target_category_id=NULL,updated_at=? WHERE id=?",
      [url, Date.now(), state.slideId]
    );

    await clearSession(env, adminId);
    return showSlideTarget(env, adminId, state.slideId);
  }

  if (state.action === "inventoryOptions") {
    const schema = parseOptions(input);

    if (state.mode === "variants") {
      combinations(schema, 100);
    }

    return showInventoryPreview(env, adminId, {
      productId: state.productId,
      mode: state.mode,
      schema
    });
  }

  if (state.action === "variantField") {
    const variant = await getVariant(env, state.variantId);
    let field;
    let value;

    if (state.field === "stock") {
      field = "stock";
      value = integer(input, 1000000000);
    } else if (state.field === "threshold") {
      field = "low_stock_threshold";
      value = integer(input, 1000000000);
    } else if (state.field === "price") {
      field = "price";
      value = input.trim() === "-" ? null : integer(input);
    } else {
      throw new Error("Unknown variant field.");
    }

    await execute(
      env,
      `UPDATE variants SET ${field}=?,updated_at=? WHERE id=?`,
      [value, Date.now(), variant.id]
    );

    const variantLabels = {
      stock: "تغییر موجودی ترکیب",
      price: "تغییر قیمت اختصاصی ترکیب",
      threshold: "تغییر آستانه هشدار ترکیب"
    };

    await logAdminAction(
      env,
      adminId,
      "catalog",
      variantLabels[state.field] || "ویرایش ترکیب",
      selectionLabel(JSON.parse(variant.options || "{}")),
      field + " = " + value
    );

    await clearSession(env, adminId);
    return showVariant(env, adminId, variant.id);
  }

  if (state.action === "variantThreshold") {
    const product = await getRecord(env, "p", state.productId);

    if (product.inventory_mode !== "variants") {
      throw new Error("The inventory mode has changed.");
    }

    const threshold = integer(input, 1000000000);

    await execute(
      env,
      "UPDATE variants SET low_stock_threshold=?,updated_at=? " +
      "WHERE product_id=?",
      [threshold, Date.now(), product.id]
    );

    await clearSession(env, adminId);
    return showVariants(env, adminId, product.id);
  }

  if (state.action === "variantBulk") {
    await applyBulkVariants(env, state, input);
    await clearSession(env, adminId);

    return showVariants(
      env,
      adminId,
      state.productId,
      Math.floor((state.page || 0) * 10 / PAGE_SIZE)
    );
  }

  if (state.action === "gatewayMerchant") {
    if (typeof message.text !== "string") {
      throw new Error("Send a text message.");
    }

    const value = parseSetting("payment_gateway_merchant", input);
    await setSetting(env, "payment_gateway_merchant", value);
    await clearSession(env, adminId);

    return showGateway(env, adminId);
  }

  if (state.action === "snapppayField") {
    if (typeof message.text !== "string") {
      throw new Error("Send a text message.");
    }

    const keys = {
      username: "snapppay_username",
      password: "snapppay_password",
      clientid: "snapppay_client_id",
      secret: "snapppay_client_secret",
      baseurl: "snapppay_base_url"
    };

    const key = keys[state.field];
    if (!key) throw new Error("Unknown SnappPay field.");

    const value = parseSetting(key, input);
    await setSetting(env, key, value);
    await clearSession(env, adminId);

    return showSnapppayPanel(env, adminId);
  }

  if (state.action === "findOrder") {
    await clearSession(env, adminId);
    return showOrderSearchResults(env, adminId, input);
  }

  if (state.action === "renameAdmin") {
    const name = input.trim() === "-" ? "" : input.trim().slice(0, 120);

    const target = await one(
      env,
      "SELECT id FROM admins WHERE id=?",
      [String(state.targetId)]
    );

    if (!target) throw new Error("Administrator not found.");

    await execute(
      env,
      "UPDATE admins SET name=? WHERE id=?",
      [name, String(state.targetId)]
    );

    await clearSession(env, adminId);

    return renderPanel(
      env,
      adminId,
      name
        ? "نام نمایشی مدیر " + state.targetId + " ثبت شد: " + name
        : "نام نمایشی مدیر " + state.targetId + " حذف شد.",
      [nav("admins", "admins")]
    );
  }

  if (state.action === "addAdmin") {
    const id = digits(input).trim();

    if (!/^[1-9]\d{4,19}$/.test(id)) {
      throw new Error("Enter a valid numeric Telegram user ID.");
    }

    const existing = await one(
      env,
      "SELECT id,role FROM admins WHERE id=?",
      [id]
    );

    await clearSession(env, adminId);

    const roleButtons = [];

    for (const role of ["owner", "admin", "operator"]) {
      if (!canGrantRole(access, role)) continue;

      const labels = {
        owner: "مدیر اصلی — همه بخش‌ها + مدیریت مدیران",
        admin: "مدیر — همه بخش‌ها بجز مدیریت مدیران",
        operator: "اپراتور — فقط سفارش‌ها و آمار"
      };

      roleButtons.push([B(labels[role], "adminroleset:" + id + ":" + role)]);
    }

    return renderPanel(
      env,
      adminId,
      (existing
        ? "این شناسه از قبل مدیر است و سطح دسترسی آن به‌روزرسانی می‌شود.\n\n"
        : "") +
        "سطح دسترسی مدیر " + id + " را انتخاب کنید:",
      [
        ...roleButtons,
        [B("🎲 دسترسی سفارشی (چک‌باکس)", "admincustom:" + id)],
        nav("admins", "admins")
      ]
    );
  }

  throw new Error(
    "This step requires a button selection. Use /cancel to return."
  );
}

/*
 * Callback actions that operate on a specific record kind carry the
 * kind as their first argument; their required permission is resolved
 * at runtime through MODEL_PERMISSIONS. Actions missing from this map
 * (home, help, stats) are open to every administrator.
 */
const CALLBACK_PERMISSIONS = {
  settings: "settings",
  setting: "settings",
  sortpick: "settings",
  smsprovpick: "sms",
  gateway: "gateway",
  gatewaytoggle: "gateway",
  gatewayuse: "gateway",
  gatewaysandbox: "gateway",
  gatewaymerchant: "gateway",
  snapppaypanel: "gateway",
  snapppayfield: "gateway",
  orders: "orders",
  order: "orders",
  orderpage: "orders",
  findorder: "orders",
  receipts: "orders",
  receiptview: "orders",
  statusask: "orders",
  statusdo: "orders",
  approvepay: "orders",
  approvepayyes: "orders",
  admins: "admins",
  adminpage: "admins",
  addadmin: "admins",
  adminrole: "admins",
  admincustom: "admins",
  adminperm: "admins",
  adminname: "admins",
  deladmin: "admins",
  deladminyes: "admins",
  adminroleset: "admins",
  logs: "admins",
  logsel: "admins",
  logview: "admins"
  // "home", "help" and "stats" stay open to every administrator role.
};

/* Callbacks that edit a record: kind is the first argument. */
const MODEL_ACTIONS = new Set([
  "list", "edit", "new", "toggle", "delete", "deleteyes",
  "photo", "clearphoto", "field", "pickcat"
]);

/* Callbacks that always require the products permission. */
const PRODUCT_ACTIONS = new Set([
  "images", "imageadd", "imageview", "imagedel",
  "inventory", "mode", "inventorysave",
  "variants", "variant", "vfield", "vtoggle",
  "variantbulk", "variantbulkpage", "variantthreshold"
]);

async function routeBotCallback(
  env,
  adminId,
  callback,
  updateId,
  previousState,
  access
) {
  const [action, a, b, c] = String(callback.data || "").split(":");

  const requiredPermission = CALLBACK_PERMISSIONS[action];

  const deny = () =>
    new Error(
      "سطح دسترسی شما این بخش را شامل نمی‌شود؛ " +
      "با مدیر اصلی هماهنگ کنید."
    );

  if (requiredPermission && !roleAllows(access, requiredPermission)) {
    throw deny();
  }

  // Record-kind actions are gated by the permission of their kind.
  if (MODEL_ACTIONS.has(action)) {
    const needed = MODEL_PERMISSIONS[a];

    if (!needed || !roleAllows(access, needed)) {
      throw deny();
    }
  }

  if (PRODUCT_ACTIONS.has(action) && !roleAllows(access, "products")) {
    throw deny();
  }

  if (action === "postbodysave" && !roleAllows(access, "posts")) {
    throw deny();
  }

  if (
    ["target", "targetnone", "targeturl"].includes(action) &&
    !roleAllows(access, "slider")
  ) {
    throw deny();
  }

  if (action === "setcat" && previousState?.action === "categoryPicker") {
    const needed = MODEL_PERMISSIONS[previousState.ownerKind];

    if (!needed || !roleAllows(access, needed)) {
      throw deny();
    }
  }

  if (action === "home") return showHome(env, adminId, access);
  if (action === "help") {
    // help:field:<key> carries the key inside the second segment.
    const section = [a, b, c].filter(Boolean).join(":");

    return showHelp(env, adminId, section);
  }

  if (action === "list") {
    return showList(env, adminId, a, b);
  }

  if (action === "edit") {
    return showEditor(env, adminId, a, b);
  }

  if (action === "new") {
    const recordId = await createRecord(env, a, updateId);

    await logAdminAction(
      env,
      adminId,
      "catalog",
      "ایجاد «" + (MODELS[a]?.title || a) + "»"
    );

    return showEditor(env, adminId, a, recordId);
  }

  if (action === "field") {
    return beginRecordField(env, adminId, a, b, c);
  }

  if (action === "toggle") {
    const record = await getRecord(env, a, b);
    const model = MODELS[a];

    await setRecordEnabled(
      env,
      a,
      b,
      !record[model.toggle]
    );

    await logAdminAction(
      env,
      adminId,
      "catalog",
      record[model.toggle] ? "غیرفعال‌سازی" : "انتشار / فعال‌سازی",
      cut(String(record[model.name] || ""), 80),
      model.title
    );

    return showEditor(env, adminId, a, b);
  }

  if (action === "delete") {
    return showDeleteConfirmation(env, adminId, a, b);
  }

  if (action === "deleteyes") {
    const victim = await getRecord(env, a, b).catch(() => null);
    await deleteRecord(env, a, b);

    await logAdminAction(
      env,
      adminId,
      "catalog",
      "حذف",
      cut(String(victim?.[MODELS[a]?.name] || ""), 80),
      MODELS[a]?.title || ""
    );

    return showList(env, adminId, a);
  }

  if (action === "settings") {
    return showSettings(env, adminId, a);
  }

  if (action === "gateway") {
    return showGateway(env, adminId);
  }

  if (action === "gatewaytoggle") {
    const settings = await getSettings(env);
    const desired = !settings.payment_gateway_enabled;

    if (desired) {
      const active = activeGateways(settings);

      if (!active.length) {
        throw new Error(
          "ابتدا حداقل یک درگاه را از فهرست درگاه‌ها فعال (✅) کنید."
        );
      }

      const notReady = active.filter(name => !gatewayReady(settings, name));

      if (notReady.length) {
        throw new Error(
          "اطلاعات این درگاه‌ها کامل نیست: " +
          notReady.map(gatewayLabel).join("، ")
        );
      }
    }

    await setSetting(env, "payment_gateway_enabled", desired);
    return showGateway(env, adminId);
  }

  if (action === "gatewayuse") {
    if (!GATEWAYS.includes(a)) {
      throw new Error("Unknown gateway.");
    }

    const settings = await getSettings(env);
    const active = new Set(activeGateways(settings));

    if (active.has(a)) {
      active.delete(a);
      await setSetting(env, "payment_gateways", [...active]);
    } else {
      if (!gatewayReady(settings, a)) {
        throw new Error(gatewayReadyHint(a));
      }

      active.add(a);
      await setSetting(env, "payment_gateways", [...active]);
    }

    return showGateway(env, adminId);
  }

  if (action === "gatewaysandbox") {
    const settings = await getSettings(env);
    await setSetting(env, "payment_gateway_sandbox", !settings.payment_gateway_sandbox);
    return showGateway(env, adminId);
  }

  if (action === "gatewaymerchant") {
    const settings = await getSettings(env);

    return prompt(
      env,
      adminId,
      { action: "gatewayMerchant" },
      "کد پذیرنده (مرچنت‌آیدی) درگاه را ارسال کنید.\n" +
        "زرین‌پال: کد ۶۴کاراکتری از پنل زرین‌پال\n" +
        "زیبال: کد پذیرنده از پنل زیبال\n" +
        "برای پاک‌کردن: -",
      "gateway",
      "gateway",
      settings.payment_gateway_merchant
    );
  }

  if (action === "snapppaypanel") {
    return showSnapppayPanel(env, adminId);
  }

  if (action === "snapppayfield") {
    const labels = {
      username: "نام کاربری اسنپ‌پی",
      password: "رمز عبور اسنپ‌پی",
      clientid: "شناسه کلاینت اسنپ‌پی",
      secret: "کلید مخفی اسنپ‌پی",
      baseurl: "آدرس پایه API اسنپ‌پی؛ خالی یعنی پیش‌فرض"
    };

    if (!labels[a]) throw new Error("Unknown SnappPay field.");

    const settings = await getSettings(env);
    const values = {
      username: settings.snapppay_username,
      password: settings.snapppay_password,
      clientid: settings.snapppay_client_id,
      secret: settings.snapppay_client_secret,
      baseurl: settings.snapppay_base_url
    };

    return prompt(
      env,
      adminId,
      { action: "snapppayField", field: a },
      labels[a] + " را ارسال کنید.\nبرای پاک‌کردن: -",
      "snapppaypanel",
      "gateway",
      values[a]
    );
  }

  if (action === "setting") {
    const spec = SETTING_FIELDS[a];
    if (!spec) throw new Error("Unknown setting.");

    // Button pickers instead of free text: no Persian/English drift.
    if (a === "default_sort") {
      return showSortPicker(env, adminId);
    }

    if (a === "sms_provider") {
      return showSmsProviderPicker(env, adminId);
    }

    const settings = await getSettings(env);

    if (spec[1] === "bool") {
      const desired = !settings[a];

      if (
        a === "turnstile_enabled" &&
        desired &&
        (!settings.turnstile_site_key || !env.TURNSTILE_SECRET_KEY)
      ) {
        throw new Error(
          "Configure both Turnstile keys before enabling it."
        );
      }

      if (a === "payment_gateway_enabled" && desired) {
        const active = activeGateways(settings);

        if (!active.length) {
          throw new Error(
            "ابتدا حداقل یک درگاه را از بخش «درگاه پرداخت» فعال کنید."
          );
        }

        const notReady = active.filter(name => !gatewayReady(settings, name));

        if (notReady.length) {
          throw new Error(
            "اطلاعات این درگاه‌ها کامل نیست: " +
            notReady.map(gatewayLabel).join("، ")
          );
        }
      }

      if (a === "payment_card_enabled" && desired) {
        const card = await one(
          env,
          "SELECT id FROM bank_cards WHERE enabled=1 LIMIT 1"
        );

        if (!card) {
          throw new Error(
            "Create and enable at least one valid bank card first."
          );
        }
      }

      await setSetting(env, a, desired);

      return showSettings(
        env,
        adminId,
        Math.floor(settingsKeyIndex(a) / PAGE_SIZE)
      );
    }

    let current = settings[a];

    if (spec[1] === "links") {
      current = current
        .map(link => link.label + " | " + link.url)
        .join("\n");
    }

    /*
     * The prompt itself carries the contextual help for this exact
     * field: what it does, every accepted value and a copyable example.
     */
    const fieldHelp = SETTING_HELP[a]
      ? "\n\n📖 " + SETTING_HELP[a]
      : "";

    return prompt(
      env,
      adminId,
      { action: "setting", key: a },
      spec[0] + fieldHelp,
      "settings:" +
        Math.floor(settingsKeyIndex(a) / PAGE_SIZE),
      "field:" + a,
      current
    );
  }

  if (action === "sortpick") {
    if (!SORT_OPTIONS.includes(a)) throw new Error("Unknown sort option.");

    await setSetting(env, "default_sort", a);

    return showSortPicker(env, adminId);
  }

  if (action === "smsprovpick") {
    if (!SMS_PROVIDERS.includes(a)) throw new Error("Unknown SMS provider.");

    await setSetting(env, "sms_provider", a);

    return showSmsProviderPicker(env, adminId);
  }

  if (action === "adminname") {
    const target = await one(
      env,
      "SELECT id,name FROM admins WHERE id=?",
      [String(a)]
    );

    if (!target) throw new Error("Administrator not found.");

    return prompt(
      env,
      adminId,
      { action: "renameAdmin", targetId: String(a) },
      "نام نمایشی مدیر " + String(a) +
        (String(target.name || "").trim()
          ? "\nنام فعلی: " + target.name
          : "") +
        "\n\nاین نام در گزارش فعالیت و فهرست مدیران نمایش داده می‌شود." +
        "\nبرای حذف نام: -",
      "admins",
      "admins",
      ""
    );
  }

  if (action === "photo") {
    const model = MODELS[a];
    if (!model?.photo) throw new Error("This record has no image field.");

    await getRecord(env, a, b);

    return prompt(
      env,
      adminId,
      {
        action: "recordPhoto",
        kind: a,
        recordId: b
      },
      "عکس را به‌شکل Photo بفرستید؛ حداکثر ۴ مگابایت.",
      `edit:${a}:${b}`,
      a
    );
  }

  if (action === "clearphoto") {
    const model = MODELS[a];
    if (!model?.photo) throw new Error("This record has no image field.");

    const victim = await getRecord(env, a, b).catch(() => null);

    await execute(
      env,
      `UPDATE ${model.table} SET ${model.photo}=NULL,updated_at=? WHERE id=?`,
      [Date.now(), b]
    );

    await logAdminAction(
      env,
      adminId,
      "catalog",
      "حذف عکس",
      cut(String(victim?.[model.name] || ""), 80),
      model.title
    );

    return showEditor(env, adminId, a, b);
  }

  if (action === "pickcat") {
    return showCategoryPicker(env, adminId, a, b, c);
  }

  if (action === "setcat") {
    if (previousState?.action !== "categoryPicker") {
      throw new Error(
        "The category selection expired. Open the picker again."
      );
    }

    const { ownerKind, ownerId } = previousState;

    if (!["p", "s"].includes(ownerKind)) {
      throw new Error("Invalid category picker state.");
    }

    let category = null;

    if (a !== "none") {
      category = await one(
        env,
        "SELECT id,enabled FROM categories WHERE id=?",
        [a]
      );

      if (!category) throw new Error("Category not found.");
    }

    if (ownerKind === "p") {
      await execute(
        env,
        "UPDATE products SET category_id=?,updated_at=? WHERE id=?",
        [category?.id || null, Date.now(), ownerId]
      );

      return showEditor(env, adminId, "p", ownerId);
    }

    if (!category?.enabled) {
      throw new Error("Choose an enabled category for the slide.");
    }

    await execute(
      env,
      "UPDATE slides SET target_type='category',target_category_id=?," +
      "target_url='',updated_at=? WHERE id=?",
      [category.id, Date.now(), ownerId]
    );

    return showSlideTarget(env, adminId, ownerId);
  }

  if (action === "target") {
    return showSlideTarget(env, adminId, a);
  }

  if (action === "targetnone") {
    await execute(
      env,
      "UPDATE slides SET target_type='none',target_category_id=NULL," +
      "target_url='',updated_at=? WHERE id=?",
      [Date.now(), a]
    );

    return showSlideTarget(env, adminId, a);
  }

  if (action === "targeturl") {
    const slide = await getRecord(env, "s", a);

    return prompt(
      env,
      adminId,
      { action: "slideURL", slideId: a },
      "لینک کامل مقصد را وارد کنید.",
      "target:" + a,
      "s",
      slide.target_url
    );
  }

  if (action === "images") {
    return showImages(env, adminId, a);
  }

  if (action === "imageadd") {
    await getRecord(env, "p", a);

    return prompt(
      env,
      adminId,
      { action: "productPhoto", productId: a },
      "عکس محصول را به‌شکل Photo ارسال کنید.",
      "images:" + a,
      "p"
    );
  }

  if (action === "imageview") {
    const media = await one(
      env,
      "SELECT file_id FROM media WHERE id=? AND kind='photo'",
      [a]
    );

    if (!media) throw new Error("Image not found.");

    await telegram(env, "sendPhoto", {
      chat_id: String(adminId),
      photo: media.file_id
    });

    return;
  }

  if (action === "imagedel") {
    const index = Number(b);

    if (!Number.isInteger(index) || index < 0 || index > 5) {
      throw new Error("Invalid image index.");
    }

    const images = await rows(
      env,
      "SELECT media_id FROM product_images " +
      "WHERE product_id=? ORDER BY position,media_id",
      [a]
    );

    const image = images[index];
    if (!image) throw new Error("Image not found.");

    await execute(
      env,
      "DELETE FROM product_images WHERE product_id=? AND media_id=?",
      [a, image.media_id]
    );

    const victim = await one(
      env,
      "SELECT name FROM products WHERE id=?",
      [a]
    );

    await logAdminAction(
      env,
      adminId,
      "catalog",
      "حذف تصویر محصول",
      victim?.name || ""
    );

    return showImages(env, adminId, a);
  }

  if (action === "inventory") {
    return showInventory(env, adminId, a);
  }

  if (action === "mode") {
    if (!["simple", "shared", "variants"].includes(b)) {
      throw new Error("Invalid inventory mode.");
    }

    const product = await getRecord(env, "p", a);
    await requireStructureEditable(env, a);

    if (b === "simple") {
      return showInventoryPreview(env, adminId, {
        productId: a,
        mode: b,
        schema: []
      });
    }

    const currentSchema = JSON.parse(product.option_schema);
    const current = currentSchema.map(group =>
      group.name + ": " + group.values.join("\n")
    ).join("\n\n");

    return prompt(
      env,
      adminId,
      {
        action: "inventoryOptions",
        productId: a,
        mode: b
      },
      "گزینه‌ها را گروهی بفرستید؛ مثال:\n" +
        "رنگ: مشکی\nقرمز\n\nسایز: کوچک\nبزرگ",
      "inventory:" + a,
      "options",
      current
    );
  }

  if (action === "inventorysave") {
    if (previousState?.action !== "inventoryConfirm") {
      throw new Error(
        "The inventory preview expired. Open the inventory editor again."
      );
    }

    const victim = await getRecord(env, "p", previousState.productId).catch(() => null);

    await applyInventoryStructure(env, previousState);

    await logAdminAction(
      env,
      adminId,
      "catalog",
      "تغییر ساختار موجودی و گزینه‌ها",
      victim?.name || ""
    );

    return showEditor(
      env,
      adminId,
      "p",
      previousState.productId
    );
  }

  if (action === "variants") {
    return showVariants(env, adminId, a, b);
  }

  if (action === "variant") {
    return showVariant(env, adminId, a);
  }

  if (action === "vfield") {
    const variant = await getVariant(env, a);

    const labels = {
      stock: "موجودی جدید را وارد کنید.",
      price: "قیمت اختصاصی؛ برای استفاده از قیمت پایه خط تیره بفرستید.",
      threshold: "آستانه هشدار؛ صفر یعنی خاموش."
    };

    if (!labels[b]) throw new Error("Invalid variant field.");

    const current = b === "threshold"
      ? variant.low_stock_threshold
      : variant[b];

    return prompt(
      env,
      adminId,
      {
        action: "variantField",
        variantId: a,
        field: b
      },
      labels[b],
      "variant:" + a,
      "variants",
      current === null ? "-" : current
    );
  }

  if (action === "vtoggle") {
    await getVariant(env, a);

    if (!["0", "1"].includes(b)) {
      throw new Error("Invalid visibility value.");
    }

    await execute(
      env,
      "UPDATE variants SET enabled=?,updated_at=? WHERE id=?",
      [Number(b), Date.now(), a]
    );

    return showVariant(env, adminId, a);
  }

  if (action === "variantbulk" || action === "variantbulkpage") {
    return showBulkVariants(env, adminId, a, b);
  }

  if (action === "variantthreshold") {
    await getRecord(env, "p", a);

    return prompt(
      env,
      adminId,
      {
        action: "variantThreshold",
        productId: a
      },
      "آستانه همه ترکیب‌ها را وارد کنید.\n" +
        "مقدار اختصاصی قبلی همه ترکیب‌ها جایگزین می‌شود.",
      "variants:" + a + ":0",
      "variants"
    );
  }

  if (action === "postbodysave") {
    if (previousState?.action !== "postBody") {
      throw new Error("The text draft expired.");
    }

    if (!previousState.draft?.trim()) {
      throw new Error("Write at least one text section first.");
    }

    const victim = await getRecord(env, "w", previousState.recordId).catch(() => null);

    await updateRecordField(
      env,
      "w",
      previousState.recordId,
      "body",
      previousState.draft
    );

    await logAdminAction(
      env,
      adminId,
      "catalog",
      "ویرایش متن نوشته",
      victim?.title || ""
    );

    return showEditor(env, adminId, "w", previousState.recordId);
  }

  if (action === "orders") {
    return showOrders(env, adminId, a);
  }

  if (action === "order") {
    return showOrder(env, adminId, a);
  }

  if (action === "orderpage") {
    return showOrder(env, adminId, a, b);
  }

  if (action === "findorder") {
    return prompt(
      env,
      adminId,
      { action: "findOrder" },
      "کد کامل سفارش یا شماره موبایل را ارسال کنید.",
      "orders:0",
      "orders"
    );
  }

  if (action === "receipts") {
    return showReceipts(env, adminId, a);
  }

  if (action === "receiptview") {
    await sendReceiptToAdmin(env, a, adminId);
    return;
  }

  if (action === "statusask") {
    return showOrderStatusConfirmation(env, adminId, a, b);
  }

  if (action === "statusdo") {
    await changeOrderStatus(env, a, b, adminId);
    return showOrder(env, adminId, a);
  }

  if (action === "approvepay") {
    return showPaymentConfirmation(env, adminId, a);
  }

  if (action === "approvepayyes") {
    await markPaidManually(env, a, adminId);
    return showOrder(env, adminId, a);
  }

  if (action === "admins" || action === "adminpage") {
    return showAdmins(env, adminId, access, a);
  }

  if (action === "adminrole") {
    return showAdminRole(env, adminId, access, a);
  }

  if (action === "admincustom") {
    return showAdminCustom(env, adminId, access, a);
  }

  if (action === "adminperm") {
    if (!ALL_PERMISSIONS.includes(b)) {
      throw new Error("Unknown permission.");
    }

    const target = await one(
      env,
      "SELECT id,role,permissions FROM admins WHERE id=?",
      [a]
    );

    if (!target) throw new Error("Administrator not found.");

    if (target.role === "owner") {
      throw new Error("مدیر اصلی دسترسی کامل و ثابت دارد.");
    }

    if (
      target.id === String(adminId) &&
      !access.isOwner
    ) {
      // Removing your own last permission can lock you out of the panel.
      throw new Error(
        "تغییر دسترسی خودتان فقط توسط مدیر اصلی انجام می‌شود."
      );
    }

    if (!access.isOwner && !access.perms.includes(b)) {
      throw new Error(
        "شما نمی‌توانید دسترسی‌ای را اعطا کنید که خودتان ندارید."
      );
    }

    const current = accessOf(target);
    const next = new Set(current.perms);

    if (next.has(b)) next.delete(b);
    else next.add(b);

    await execute(
      env,
      "UPDATE admins SET role='custom',permissions=? WHERE id=?",
      [JSON.stringify([...next]), a]
    );

    return showAdminCustom(env, adminId, access, a);
  }

  if (action === "adminroleset") {
    if (!["owner", "admin", "operator"].includes(b)) {
      throw new Error("Invalid access level.");
    }

    if (!canGrantRole(access, b)) {
      throw new Error(
        "شما نمی‌توانید سطحی بالاتر از دسترسی خودتان بسازید."
      );
    }

    const target = await one(
      env,
      "SELECT id,role,permissions FROM admins WHERE id=?",
      [a]
    );

    if (target && target.role === "owner" && b !== "owner") {
      const owners = await one(
        env,
        "SELECT COUNT(*) AS total FROM admins WHERE role='owner'"
      );

      if (Number(owners?.total || 0) < 2) {
        throw new Error("آخرین مدیر اصلی قابل تنزل سطح نیست؛ ابتدا مدیر اصلی دیگری تعیین کنید.");
      }
    }

    if (target) {
      await execute(
        env,
        "UPDATE admins SET role=?,permissions='' WHERE id=?",
        [b, a]
      );
    } else {
      await execute(
        env,
        "INSERT INTO admins(id,role,created_at) VALUES(?,?,?)",
        [a, b, Date.now()]
      );
    }

    if (a === String(adminId)) {
      // The acting administrator changed their own level.
      const selfAccess = await loadAccess(env, adminId);
      return showHome(env, adminId, selfAccess);
    }

    return showAdminRole(env, adminId, access, a);
  }

  if (action === "addadmin") {
    return prompt(
      env,
      adminId,
      { action: "addAdmin" },
      "شناسه عددی حساب مدیر جدید را بفرستید؛\n" +
        "سپس سطح دسترسی او را انتخاب می‌کنید.",
      "admins",
      "admins"
    );
  }

  if (action === "deladmin") {
    // Only the shop owner may remove administrators.
    if (!access.isOwner) {
      throw new Error("حذف مدیران فقط توسط مدیر اصلی مجاز است.");
    }

    const target = await one(
      env,
      "SELECT id,role FROM admins WHERE id=?",
      [a]
    );

    if (!target) throw new Error("Administrator not found.");

    const owners = await one(
      env,
      "SELECT COUNT(*) AS total FROM admins WHERE role='owner'"
    );

    if (target.role === "owner" && Number(owners?.total || 0) < 2) {
      throw new Error("آخرین مدیر اصلی قابل حذف نیست؛ ابتدا یک مدیر اصلی دیگر تعیین کنید.");
    }

    return renderPanel(
      env,
      adminId,
      "دسترسی مدیر " + a + " («" + roleLabel(target.role) + "») حذف شود؟\n" +
        "این کار دسترسی او به پنل، مینی‌اپ و اعلان‌های آینده را حذف می‌کند.",
      [
        [B("بله، حذف شود", "deladminyes:" + a)],
        nav("admins", "admins")
      ]
    );
  }

  if (action === "deladminyes") {
    if (!access.isOwner) {
      throw new Error("حذف مدیران فقط توسط مدیر اصلی مجاز است.");
    }

    const removed = await one(
      env,
      "DELETE FROM admins WHERE id=? " +
      "AND (SELECT COUNT(*) FROM admins)>1 " +
      "AND (role!='owner' OR " +
      "(SELECT COUNT(*) FROM admins WHERE role='owner')>1) " +
      "RETURNING id",
      [a]
    );

    if (!removed) {
      throw new Error(
        "حذف انجام نشد؛ آخرین مدیر و آخرین مدیر اصلی قابل حذف نیستند."
      );
    }

    if (a === String(adminId)) {
      await telegram(env, "sendMessage", {
        chat_id: String(adminId),
        text: "دسترسی مدیریتی شما حذف شد."
      });
      return;
    }

    return showAdmins(env, adminId, access);
  }

  if (action === "logs") {
    return showLogAdmins(env, adminId, access, a);
  }

  if (action === "logsel") {
    return showLogSections(env, adminId, access, a);
  }

  if (action === "logview") {
    return showLogView(env, adminId, access, a, b, c);
  }

  if (action === "stats") {
    return showStats(env, adminId);
  }

  throw new Error(
    "Unknown or outdated button. Send /start to reopen the panel."
  );
}

function safeBotError(env, error) {
  let message = String(error?.message || "Operation failed.");

  for (const secret of [
    env.BOT_TOKEN,
    env.BOT_WEBHOOK_SECRET,
    env.TURNSTILE_SECRET_KEY
  ]) {
    if (secret) {
      message = message.replaceAll(secret, "[REDACTED]");
    }
  }

  if (/D1_ERROR|SQLITE_|constraint failed|FOREIGN KEY/i.test(message)) {
    return (
      "Database rejected this change. Check field values, " +
      "active orders and record relationships."
    );
  }

  return cut(message, 350);
}

/**
 * Called by the Worker only after validating the Telegram webhook secret.
 *
 * The Worker must also deduplicate update_id values.
 * This function does not implement a global exactly-once guarantee.
 */
export async function handleBot(env, update, ctx) {
  const callback = update?.callback_query;
  const message = callback?.message || update?.message;
  const sender = callback?.from || update?.message?.from;

  if (
    !message ||
    !sender ||
    sender.is_bot ||
    message.chat?.type !== "private"
  ) {
    return;
  }

  const adminId = String(sender.id);

  if (String(message.chat.id) !== adminId) {
    return;
  }

  const access = await loadAccess(env, adminId);

  if (!access) {
    if (callback) {
      try {
        await telegram(env, "answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Access denied.",
          show_alert: true
        });
      } catch {
        // Do not expose webhook errors for an unauthorized request.
      }
    }

    // Avoid creating a reply loop for messages from non-administrators.
    return;
  }

  if (callback) {
    try {
      await telegram(env, "answerCallbackQuery", {
        callback_query_id: callback.id
      });
    } catch {
      // A delayed callback may have expired; still allow reopening the panel.
    }
  }

  try {
    if (callback) {
      const panel = await one(
        env,
        "SELECT message_id FROM bot_panels WHERE admin_id=?",
        [adminId]
      );

      // Old panels and notification messages may only reopen the home menu.
      if (
        callback.data !== "home" &&
        panel &&
        Number(panel.message_id) !== Number(message.message_id)
      ) {
        await showHome(env, adminId, access);
        return;
      }

      const previousState = await getSession(env, adminId);

      // Navigation exits the previous input step.
      // A new prompt or picker creates its own session.
      await clearSession(env, adminId);

      try {
        await routeBotCallback(
          env,
          adminId,
          callback,
          update.update_id,
          previousState,
          access
        );
      } catch (error) {
        // Preserve draft text and stateful confirmations if saving fails.
        const restorable = [
          "inventorysave",
          "postbodysave",
          "setcat"
        ].includes(String(callback.data || "").split(":")[0]);

        if (
          restorable &&
          previousState &&
          !await getSession(env, adminId)
        ) {
          await putSession(env, adminId, previousState);
        }

        throw error;
      }
    } else {
      const text = message.text || "";

      const commandMatch = text.match(
        /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i
      );

      if (commandMatch) {
        const command = commandMatch[1].toLowerCase();

        if (command === "start") {
          // /start always delivers the panel again as a new message.
          await showHome(env, adminId, access, true);
          return;
        }

        if (["cancel", "menu"].includes(command)) {
          await showHome(env, adminId, access);
          return;
        }

        if (command === "help") {
          await clearSession(env, adminId);
          await showHelp(env, adminId, "home");
          return;
        }
      }

      const state = await getSession(env, adminId);

      if (!state) {
        await showHome(env, adminId, access);
        return;
      }

      await handleBotInput(env, adminId, message, state, access);
    }

    // Alerts already live in D1. Delivery can be retried by scheduled maintenance.
    if (ctx?.waitUntil) {
      ctx.waitUntil(
        deliverNotifications(env, 3).catch(() => {
          console.error("Bot-triggered notification delivery failed.");
        })
      );
    }
  } catch (error) {
    const state = await getSession(env, adminId);
    const keyboard = [];

    if (state?.action === "postBody") {
      keyboard.push([B("تلاش دوباره برای ذخیره", "postbodysave")]);
    }

    if (state?.action === "inventoryConfirm") {
      keyboard.push([B("تلاش دوباره برای ذخیره", "inventorysave")]);
    }

    keyboard.push(
      nav(state?.back || "home", state?.help || "home")
    );

    await renderPanel(
      env,
      adminId,
      "Error: " + safeBotError(env, error) +
        (state
          ? "\n\nYou can retry the current input or cancel."
          : "\n\nReopen the section and try again."),
      keyboard
    );
  }
}

