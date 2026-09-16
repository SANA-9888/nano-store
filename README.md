# Persian Store V2 — فروشگاه اینستاگرامی با ربات تلگرام

استقرار: `node scripts/setup.mjs` (مهاجرت‌ها خودکار اعمال می‌شوند، شامل 0010) و سپس deploy ورکر.

## کلیدهای Runtime (بخش Variables and Secrets پنل Cloudflare)

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `MINIAPP_ENABLED` | **true** | با `false` / `0` / `off` مینی‌اپ مدیریت خاموش می‌شود |
| `USERS_ENABLED` | **true** | با `false` / `0` / `off` ثبت‌نام/ورود مشتریان و `/account` خاموش می‌شود |
| `BOT_TOKEN`, `BOT_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY` | — | همان مقادیر قبلی |

مقادیر مجاز برای فلگ‌ها: `true/false/1/0/on/off/yes/no` (حروف بزرگ/کوچک فرق ندارد). حذف متغیر = فعال.

## پخش بار D1 (تا ۳ binding)

در پنل Cloudflare همان دیتابیس D1 را حداکثر دو بار دیگر با نام‌های
`DB_R1` و `DB_R2` به ورکر bind کنید (بعد از فعال‌کردن Read Replication
در تنظیمات خود D1). خواندنی‌های عمومی ویترین (bootstrap/products/post)
به‌طور خودکار بین رپلیکاها پخش می‌شوند؛ بدون این binding ها همه‌چیز روی
`DB` اصلی کار می‌کند. پاسخ‌های عمومی به‌مدت ~۳۰ ثانیه در کش لبه هم ذخیره
می‌شوند؛ تغییرات پنل حداکثر پس از ۳۰ ثانیه در سایت دیده می‌شود.

## سرویس پیامک (کد تایید ورود)

تنظیم `sms_provider` (کاوه‌نگار / فراز اس‌ام‌اس / SMS.ir) + `sms_api_key` + `sms_template`
از پنل ربات (🎨 تنظیمات) یا کارت «پیامک کد تایید» مینی‌اپ:

- کاوه‌نگار و فراز اس‌ام‌اس: نام قالب Verify (متغیر `%token`)، مثل `shop-verify`
- SMS.ir: شناسه عددی قالب (TemplateId) با پارامتر `CODE`، مثل `1000123`

## دسترسی‌های مدیران (۱۳ کلید)

products، categories، slider، posts، faq، discounts، cards، orders،
gateway، settings، **sms** (تنظیمات پیامک)، **users** (کاربران سایت)، admins
+ گزارش فعالیت (فقط مدیر اصلی) و تغییر نام نمایشی مدیران با ✏️.
