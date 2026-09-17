# HANDOFF — فروشگاه فارسی V2 (myshopstore)

> **سند تحویل به هوش مصنوعی بعدی** — تاریخ تنظیم: ۱۷ سپتامبر ۲۰۲۶ (به وقت تهران)
> مسیر پروژه: `C:\Users\Sana\Desktop\hermes nano`
> این سند طوری نوشته شده که **هر مدلی** بدون خواندن تاریخچه چت بتواند کار را ادامه دهد.

---

## 0) English TL;DR (read this first)

- **What:** A Persian (Farsi, RTL) e-commerce shop for small Instagram pages, free to host. ONE Cloudflare Worker serves four faces:
  1. **Storefront** — mobile-first public website (vanilla JS, embedded HTML string),
  2. **Telegram bot** — the full admin panel (keyboards + callbacks, ~4600 lines),
  3. **Telegram Mini App** — admin panel as a WebApp inside Telegram,
  4. **Customer accounts** — OTP phone login + `/account` panel for shoppers.
- **Stack:** Cloudflare Workers + D1 (SQLite) + Cache API edge cache. **No build step** — plain ES modules, vanilla JS. Node ≥ 22, wrangler v4. No external npm runtime deps.
- **State:** 690/690 test assertions green across six suites (admin-roles 72, bot-ux 335, miniapp-api 107, miniapp 97, payments 37, users 42). Sections 12.1 and 12.2 of HANDOFF.md are audited and closed; 12.3 delivered two public features (order tracking, CSV export).
- **Golden rules:** read this doc first · run all 6 test suites + `check.mjs` before any delivery · all UI text in Persian (RTL) · migrations are append-only and numbered · **do not "optimize" brand colors — the shop owner controls them**.

---

## 1) هویت پروژه

فروشگاه اینستاگرامی/تلگرامی فارسی با مدل مدیریت «ربات تلگرام به‌جای پنل وب». مدیر فروشگاه همه‌چیز را از داخل تلگرام انجام می‌دهد (محصول، دسته، اسلایدر، مجله، سوالات متداول، تخفیف، کارت بانکی، سفارش‌ها، درگاه‌ها، تنظیمات، مدیران، پیامک، کاربران). مشتری سایت را می‌بیند، سبد می‌سازد، و یا کارت‌به‌کارت پرداخت می‌کند و رسید می‌فرستد و یا از درگاه آنلاین (زرین‌پال/زیبال/اسنپ‌پی) می‌پردازد.

- **زبان رابط کاربری:** فارسی، RTL، اعداد فارسی در ویترین، تاریخ شمسی (تبدیل `toJalali` داخل `src/miniapp.js`).
- **مالک پروژه:** کاربر فارسی‌زبان؛ ارتباط با او به فارسی است. سوال‌های فنی‌اش را با شفافیت و بدون اصطلاح‌بازی جواب بده.
- **این ریپو یک ورکر است:** فرانت‌اند و بک‌اند در همین یک سرویس ادغام شده‌اند؛ `src/storefront.js` و `src/miniapp.js` رشته‌های HTML بزرگ‌اند که از `worker.js` سرو می‌شوند.

## 2) ترتیب مطالعه

1. این سند (`HANDOFF.md`) — تصویر کلی.
2. `README.md` — راهنمای استقرار و تنظیمات برای کاربر نهایی (فارسی).
3. `src/worker.js` — نقطه ورود: مسیریابی API، وب‌هوک ربات، صفحات HTML، کرن ۱۵ دقیقه‌ای.
4. تست‌ها در `scripts/test-*.mjs` — بهترین مستند رفتار فعلی؛ هر رفتار تاییدشده یک assertion دارد.

## 3) معماری

```
Cloudflare Worker (src/worker.js)
├── fetch()  ──►  GET /            → src/storefront.js (ویترین عمومی)
│            ──►  /api/*          → bootstrap/products/post/cats … (عمومی، کش لبه ~۳۰ثانیه)
│            ──►  /account        → پنل مشتری (ثبت‌نام/ورود OTP، سفارش‌ها)
│            ──►  /miniapp        → src/miniapp.js (پنل مدیریت داخل تلگرام)
│            ──►  POST /webhook/<BOT_WEBHOOK_SECRET> → src/bot.js (پنل مدیریت تلگرام)
├── scheduled()  ──►  maintainOrders(): پاک‌سازی داده‌های زائد + لاگ قدیمی + یادآوری سفارش
└── داده: D1 «DB» (+ اختیاری رپلیکای خواندن DB_R1/DB_R2) + Cache API لبه
```

- جریان عمومی خواندن از `publicDb()` می‌گذرد و نتایج ~۳۰ ثانیه کش می‌شود — این «باگ» نیست.
- وب‌هوک ربات با هدر secret محافظت می‌شود؛ بدون آن 403.
- کنترل دسترسی: ۱۳ کلید صلاحیت — `products, categories, slider, posts, faq, discounts, cards, orders, gateway, settings, sms, users, admins` — به‌علاوه گزارش فعالیت که فقط مدیر اصلی می‌بیند. تابع مشترک `accessOf` در `src/permissions.js`.

## 4) نقشه فایل‌ها

| فایل | خط | نقش |
|---|---|---|
| `src/bot.js` | ~۴۶۰۱ | ربات تلگرام: کیبوردها، callback ها، پنل مدیریت کامل |
| `src/miniapp.js` | ~۳۹۲۴ | مینی‌اپ مدیریت: داشبورد، نمودار فروش، مدیریت کاربران |
| `src/storefront.js` | ~۳۳۹۶ | ویترین عمومی: تم روشن/تاریک، جستجو، فیلتر chips، سبد، toast |
| `src/users.js` | ~۱۰۱۶ | حساب مشتریان: OTP، نشست‌ها، بلاک |
| `src/payments.js` | ~۸۹۱ | درگاه‌ها: زرین‌پال، زیبال، اسنپ‌پی + رسید کارت‌به‌کارت |
| `src/orders.js` | ~۸۷۰ | چرخه سفارش، تایید خودکار رسید، maintainOrders، رهگیری عمومی |
| `src/worker.js` | ~۶۳۱ | مسیریابی + کرن |
| `src/defaults.js` | ~۶۰۸ | راهنمای فارسی هر تنظیم، SMS_PROVIDERS، envFlagOn |
| `src/media.js` | ~۴۳۸ | آپلود تصویر (Photo یا Document PNG/JPG/WebP، magic bytes، ۴MB) |
| `src/telegram.js` | ~۳۳۰ | پراکسی API تلگرام + sendMessage/renderPanel |
| `src/catalog.js` | ~۲۴۸ | محصول/دسته/تنوع |
| `src/db.js` | ~۲۵۷ | هلپرهای D1، publicDb، cachedJSON، rate-limit |
| `src/permissions.js` | ~۱۰۵ | accessOf مشترک (۱۳ کلید) |
| `src/audit.js` | ~۴۰ | ثبت رویداد در admin_logs |
| `migrations/0001…0011` | — | اسکیمای D1 (فقط الحاقی) |

## 5) لایه داده

- جداول اصلی: `products, variants, product_images, categories, slides, posts, faqs, coupons, bank_cards, media, settings, admins, admin_logs, orders, order_items, order_events, receipts, gateway_payments, notification_jobs, notification_deliveries, bot_sessions, bot_panels, rate_limits, telegram_updates, user_otps, shop_users`.
- migrations ۰۰۰۱ تا ۰۰۱۱. اگر روزی چک دیگری لازم شد، الگوی «ساخت جدول v2 → کپی → drop → rename» (مثل 0011) را تکرار کن چون SQLite `ALTER … CHECK` ندارد.
- نگهداری خودکار (کرن هر ۱۵ دقیقه): لاگ‌ها طبق `log_retention_days` (۲۰ روز)، OTP منقضی، نشست‌ها، rate-limit ها، آپدیت‌های تلگرام (۷ روز)، اعلان‌ها و پنل‌های قدیمی (۳۰ روز)، پرداخت‌های failed (۹۰ روز).
- D1 دستور VACUUM ندارد — صفحه‌های خالی‌شده را خود SQLite دوباره مصرف می‌کند. «کاهش حجم فوری» انتظار نباشد.
- تنظیمات: همه key/value در جدول `settings`.

## 6) کارهای انجام‌شده

### ۶.الف دور قبلی — رفع UI/UX (ممیزی زنده)

با ممیزی زنده Chrome DevTools Protocol تأیید شده (`scripts/ui-audit.mjs`).

**سایت (`src/storefront.js`):**
- دکمه‌های آیکون هدر ۴۰→۴۴px (قانون global `.icon{width:44px}` در media query زیر ۶۰۰px نقض می‌شد، خط ۶۲۲ قدیم).
- رنگ muted روشن `#718077`→`#5c6b62` — کنتراست ۳.۷→۵.۴:1 (WCAG AA). **این رنگ کاربری قابل تغییر نیست**، برخلاف brand_color.
- alt سه تصویر: `detail-image`، `post-image`، تصویر دسته‌بندی.
- لینک «حساب کاربری من» به کلاس `link-button` (۴۴px هدف لمسی).

**مینی‌اپ (`src/miniapp.js`):**
- برچسب بریده‌شده‌ی نمودار فروش — ۱۲ برچسب (مثل «۶ شهریور») با `overflow:hidden` ناپیدا بودن؛ حالا در `.bar-label-wrap` با `max-width:64px` و چرخش بدون برش.
- دکمه تازه‌سازی `.iconbtn` ۴۰→۴۴px، چیپ‌های `.fchip` (روزانه/هفتگی/ماهانه) به `min-height:44px`.

### ۶.ب این دور — ممیزی ربات + API مینی‌اپ + دو امکان

کارهای بخش ۱۲. تا ۱۲.۳ (جزئیات کامل در بخش ۱۲ همین سند):
- **۱۲.۱** `scripts/test-bot-ux.mjs` (۳۳۵ assertion) — ربات واقعی روی D1 + Telegram API شبیه‌سازی‌شده. ۵ باگ واقعی رفع شد (برش بایتی برچسب‌ها، سه‌دکمه‌ای ردیف‌ها، جستجوی ارقام فارسی).
- **۱۲.۲** `scripts/test-miniapp-api.mjs` (۱۰۷ assertion) — همه endpointهای مینی‌اپ با HMAC واقعی.
- **۱۲.۳** رهگیری سفارش عمومی + خروجی CSV.

**ابزارهای ساخته‌شده (تا این دور):**
|| فایل | کاربرد |
|---|---|---|
| `scripts/test-miniapp-api.mjs` | تست API مینی‌اپ: HMAC واقعی، همه endpointها (۱۲.۲) |
| `scripts/test-bot-ux.mjs` | ممیزی ربات: ۷۰+ مسیر + دنبال‌کردن همه دکمه‌ها (بن‌بست) و سقف‌های ۶۴بایتی تلگرام |
| `scripts/ui-audit.mjs` | ممیزی زنده: کنسول، overflow-x، clipping، touch target، contrast، headings، alt. پارامترها: url width height |
| `scripts/serve-storefront-mock.mjs` | سرور mock سایت روی پورت ۸۷۹۱ |
| `scripts/serve-miniapp-mock.mjs` | سرور mock مینی‌اپ روی پورت ۸۷۹۲ (شکل APIها از سورس استخراج شده) |
| `scripts/test-miniapp-boot.mjs` | بوت واقعی مینی‌اپ در Node + کلیک روی همه تب‌ها |

## 7) وضعیت فعلی

- تست‌ها: **admin-roles 72 · bot-ux 335 · miniapp-api 107 · miniapp 97 · payments 37 · users 42 = ۶۹۰/۶۹۰ سبز**.
- `node --check` و `check.mjs` پاس. `test-miniapp-boot.mjs` پاس.
- ممیزی نهایی: سایت ۰ مشکل @ 390px و 1280px؛ مینی‌اپ ۰ مشکل @ 390px.
- **ممیزی ربات تلگرام (۱۲.۱) انجام شد** — ۵ باگ واقعی پیدا و رفع شد (جزئیات در بخش ۱۲.۱).
- **ممیزی API مینی‌اپ (۱۲.۲) انجام شد** — ۱۰۷ assertion روی همه endpointها.
- **امکانات جدید (۱۲.۳):** رهگیری سفارش عمومی + خروجی CSV.

## 8) راهنمای استقرار (برای کاربر توضیح بده، خودت اجرا نکن)

1. `node scripts/setup.mjs` — ساخت/آپدیت D1 و اعمال خودکار مهاجرت‌ها تا 0011 + نوشتن `wrangler.json`.
2. `npx wrangler deploy` (یا `npm run deploy` که اول `check.mjs` را اجرا می‌کند).
3. Secrets در پنل Cloudflare: `BOT_TOKEN`, `BOT_WEBHOOK_SECRET` (+ `TURNSTILE_SECRET_KEY`).
4. Vars: `MINIAPP_ENABLED`, `USERS_ENABLED` — اختیاری، پیش‌فرض روشن.
5. اختیاری: Read Replication در D1 و bind با `DB_R1`/`DB_R2`.

## 9) راهنمای تست

```
node scripts/test-admin-roles.mjs      # 72
node scripts/test-bot-ux.mjs           # 335
node scripts/test-miniapp-api.mjs      # 107
node scripts/test-miniapp-snapppay.mjs # 97
node scripts/test-payments.mjs         # 37
node scripts/test-users.mjs            # 42
node scripts/check.mjs                 # چک سریع
node scripts/test-miniapp-boot.mjs     # بوت مینی‌اپ
node scripts/ui-audit.mjs http://localhost:8791/ 390 844   # ممیزی سایت
node scripts/ui-audit.mjs http://localhost:8792/ 390 844   # ممیزی مینی‌اپ
```

- تست‌ها کاملاً آفلاین‌اند (D1 stub + APIهای mock).
- **قانون طلایی: قبل از هر تحویل، هر ۶ مجموعه + check باید سبز باشند.**

## 10) قراردادهای ادامه کار (اینها را نشکن)

- **زبان پاسخ و UI:** فارسی. متن‌های جدید همیشه فارسی + RTL؛ اعداد ویترین فارسی.
- **رنگ برند کاربری است.** صاحب فروشگاه هم `brand_color` و هم `category_active_color` (رنگ متن روی برند) را از طریق ربات تنظیم می‌کند. `brandLuminanceInk` در storefront.js فقط پیش‌فرضی برای وقتی است که رنگ متن تنظیم نشده. **رنگ‌ها را بهینه‌سازی نکن** — کاربر خودش کنترل دارد. (در یک دور قبل ~۷۰٪ کانتکست روی همین موضوع مصرف شد؛ تکرار نکن.)
- **مهاجرت‌ها فقط الحاقی:** هر تغییر اسکیما = فایل جدید (0012 به بعد).
- **بدون build step:** bundler/فریم‌ورک معرفی نکن.
- **سبک کد:** بدون وابستگی خارجی، خطاهای دامنه با `AppError`.
- **امنیت:** هدرهای CSP/HSTS/frame-ancestors، requireOrigin، امضای HMAC سفارش، لیست‌سفید mime + magic bytes — عمدی‌اند؛ دست نزن مگر با تست.

## 11) محدودیت‌ها و تله‌های شناخته‌شده

1. **D1 بدون VACUUM** — پاک‌سازی منطقی کافی است.
2. **SQLite چک‌کسترانت را ALTER نمی‌کند** — الگوی swap جدول.
3. **Photo تلگرام فشرده می‌شود (JPEG)** — لوگوی PNG شفاف باید با Document ارسال شود.
4. **دکمه‌های ✏️/🗑 فهرست مدیران فقط برای owner** — اگر کاربر گفت «دکمه نمی‌بینم»، اول بپرس با کدام اکانت چک کرده.
5. **کش لبه ۳۰ ثانیه‌ای** — طبیعی است.
6. **`envFlagOn` پیش‌فرض روشن** — حذف متغیر = فعال.
7. **رشته‌های HTML بزرگ** — برای ادیت‌های دقیق از anchor استفاده کن.
8. **تست‌ها stub دستی دارند** — اگر رفتار D1 جدید استفاده کردی، stub را هم آپدیت کن.
9. **نسخه دیپلوی‌شده ممکن است عقب باشد.**
10. **ساختار پروفایل Windows:** سرورهای mock روی پورت ۸۷۹۱ و ۸۷۹۲. برای توقف آن‌ها از `kill` در MSYS استفاده نکن (درست کار نمی‌کند) — از PowerShell استفاده کن:
    ```
    powershell -Command "Get-NetTCPConnection -LocalPort 8791 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"
    ```
    Chrome در مسیر استاندارد ویندوز: `C:\Program Files\Google\Chrome\Application\chrome.exe`.
11. **idها در API مینی‌اپ ۳۲ کاراکتر hex هستند** — `apiOrderDetail`، `apiProductDetail`، `apiUserOrders` و `apiUserAction` همگی `/^[a-f0-9]{32}$/` چک می‌کنند. seeding مستقیم با id کوتاه مثل `"o1"` باعث ۴۰۴ کاذب می‌شود. `uid()` همین طول را تولید می‌کند.
12. **`admin_logs.id` از نوع `INTEGER PRIMARY KEY AUTOINCREMENT` است** (نه TEXT)؛ seeding مستقیم باید آن ستون را خالی بگذارد.
13. **`Response.text()` در Node یک BOM پیشرو را حذف می‌کند** (مثل مرورگرها). برای تست حضور BOM در خروجی CSV از `arrayBuffer()` استفاده کن.
14. **متن فارسی چندبایتی است** — هر برش برچسب/متن تلگرام باید روی بایت باشد (`cutToBytes` در bot.js)، نه روی کاراکتر.

## 12) کارهای ناتمام — تکلیف بعدی

**وضعیه:** ۱۲.۱ و ۱۲.۲ کامل انجام شد (با تست‌های جدید). ۱۲.۳ دو امکان تحویل داد و یکی از پیش موجود بود. تنها مورد باز:

### ۱۲.۱ ربات تلگرام — انجام شد ✅

تست `scripts/test-bot-ux.mjs` نوشته شد: `handleBot` واقعی روی D1 stub + fetch سراسری mock (شبیه‌سازی Telegram API). ۷۰+ مسیر callback اجرا می‌شود، بعد **هر دکمه‌ی تولیدشده** در کل اجرا دنبال می‌شود (بررسی بن‌بست). در پایان سه سقف تلگرام روی همه‌ی کیبوردها چک می‌شود: برچسب ≤۶۴ بایت، `callback_data` ≤۶۴ بایت، متن ≤۴۰۹۶ بایت، و ردیف ≤۲ دکمه. **۳۳۵ assertion.**

باگ‌های واقعی که این ممیزی پیدا و رفع کرد:

1. **`cut()` روی کاراکتر قطع می‌کرد، نه بایت.** متن فارسی چندبایتی است، پس برچسب‌های طولانی بی‌صدا از سقف ۶۴ بایت رد می‌شدند (بزرگ‌ترین: **۱۲۶ بایت**). تابع `cutToBytes()` جایگزین شد؛ کاراکترها را در وسط نمی‌برد.
2. **بودجه‌ی برچسب در چهار لیست** ایموجی و «…» را حساب نمی‌کرد: `showList` (۳۵→۵۴)، `showVariants` (۳۵→۴۸)، `showCategoryPicker` (۳۵→۵۷)، `showSettings` (حالا `cutToBytes(text, 60)`).
3. **سه دکمه در یک ردیف** در چهار صفحه: `showSortPicker` و `showSmsProviderPicker` با `...nav()` سه‌تایی می‌ساختند (الان `navRow()` ردیف مستقل می‌دهد)، `showGateway` هر سه درگاه را یک ردیف می‌زد (الان `chunkRows(...,2)`)، `showAdmins` 👤✏️🗑 را یک ردیف داشت (🗑 به ردیف پایین منتقل شد).
4. **باگ ساختاری کیبورد مدیران:** بازنویسی اول من `return [row, ...extra]` با `.map()` تولید می‌کرد، یعنی ردیف‌های تودرتو که در سراسر کد Base ورد تلگرام `null` می‌شدند. با `.flatMap()` درست شد.
5. **جستجوی سفارش با ارقام فارسی کار نمی‌کرد:** `digits()` ورودی را به ASCII تبدیل می‌کند ولی `code`/`phone` در دیتابیس ممکن است فارسی باشد. کوئری الان هر دو املا را با `IN` می‌گردد.

**نکته برای ادامه:** `telegram.js` متن را در ۴۰۰۰ کاراکتر (نه ۴۰۹۶) قطع می‌کند. این عمدی است و پنل‌های طولانی (خلاصه سفارش، راهنما) ممکن است بریده شوند؛ در `showOrder` از صفحه‌بندی ۳۱۰۰تایی استفاده می‌شود تا دکمه‌ها در سقف جا شوند.

### ۱۲.۲ مینی‌اپ — انجام شد ✅

تست `scripts/test-miniapp-api.mjs` نوشته شد: `handleMiniAppAPI` مستقیماً روی D1 واقعی با initData **امضاشده با HMAC واقعی** اجرا می‌شود (طبق مشخصات تلگرام). صفحات سفارش‌ها، محصولات، کاربران، گزارش فعالیت و تنظیمات که تا حالا رندر نشده بودند، حالا اجرا می‌شوند. **۱۰۷ assertion.**

این تست یک باگ ساختاری هم پیدا کرد: `admin_logs.id` از نوع INTEGER AUTOINCREMENT است (نه TEXT) و `apiUserOrders` در کوئری از `IN` استفاده می‌کرد.

### ۱۲.۳ امکانات — تحویل داده شد ✅

- ✅ **رهگیری سفارش عمومی** (پایین)
- ✅ **خروجی CSV** (پایین)
- ✅ **محدودسازی نرخ OTP سر هر شماره** — از قبل موجود بود (`users.js:304-306`: سه حد ساعتی/روزانه + فاصله ارسال). نیازی به کار نبود.
- ⬜ جستجوی FTS5 روی محصولات — **امکانش کم است**: جستجوی فعلی `instr()` برای چند صد محصول کافی است، FTS5 برای فروشگاه‌های بزرگ است و نیاز به migration + trigger + نرمال‌سازی متن فارسی دارد (بند ۱۱.۸). اولویت پایین.

**کارهای تحویلی این دور (۱۲.۳):**

1. **رهگیری سفارش (عمومی):** `POST /api/orders/track` در `src/worker.js` و `trackOrder()` در `src/orders.js`. مشتری کد سفارش + موبایل خودش را می‌زند؛ نیاز به ورود ندارد. ارقام فارسی پذیرفته می‌شوند. Rate-limit مخصوص (۱۰ در دقیقه) برای جلوگیری از حدس زدن کد. فقط فیلدهای عمومی برمی‌گردد — `id` داخلی، `access_hash` و `file_id` رسید هرگز لو نمی‌روند.
2. **خروجی CSV:** `GET /miniapp/api/orders/csv?filter=...`. همان کوئری و همان گیت دسترسی لیست سفارش‌ها، پس هیچ سفارشی که مدیر نمی‌تواند ببیند از فایل بیرون نمی‌آید. BOM (`String.fromCharCode(0xFEFF)`) برای اینکه اکسل فارسی را UTF-8 بخواند، و escaping طبق RFC 4180.
3. **نکته مسیریابی:** مسیر CSV باید قبل از مسیر لیست `orders` منطبق شود (هر دو با `head === "orders"` شروع می‌شوند).

تله‌های که این دور پیدا شد، در بند ۱۱ (شماره‌های ۱۱ تا ۱۴) اضافه شد.

---
*پایان هندآف. اگر سوال باز ماند، اول این سند و assertion های تست‌ها را ببین.*
