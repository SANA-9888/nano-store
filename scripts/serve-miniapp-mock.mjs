// Headless UI verification server for the Telegram Mini App page.
// Serves the real miniapp HTML with mocked Telegram WebApp + API endpoints.
import { createServer } from "node:http";
import { miniAppPage } from "../src/miniapp.js";

// Telegram WebApp stub: the real script is loaded from telegram.org; we replace
// it with a no-op so the page works headless without a Telegram client.
const TG_STUB = `
window.Telegram = { WebApp: {
  initData: "query_id=AAE&user=%7B%22id%22%3A1%2C%22first_name%22%3A%22%D9%85%D8%AF%DB%8C%D8%B1%22%7D&auth_date=1&hash=xx",
  initDataUnsafe: { user: { id: 1, first_name: "مدیر" } },
  themeParams: {}, colorScheme: "dark", isExpanded: true,
  viewportHeight: 700, viewportStableHeight: 700,
  ready: function(){}, expand: function(){}, close: function(){},
  enableClosingConfirmation: function(){}, disableVerticalSwipes: function(){},
  showAlert: function(m){ console.log("[tg.alert]", m); },
  showConfirm: function(m, cb){ if (cb) cb(true); },
  showPopup: function(p, cb){ if (cb) cb("ok"); },
  onEvent: function(){}, offEvent: function(){},
  setHeaderColor: function(){}, setBackgroundColor: function(){},
  MainButton: { show: function(){}, hide: function(){}, setText: function(){}, onClick: function(){}, offClick: function(){} },
  BackButton: { show: function(){}, hide: function(){}, onClick: function(){}, offClick: function(){} },
  HapticFeedback: { impactOccurred: function(){}, notificationOccurred: function(){}, selectionChanged: function(){} }
}};
`;

const API = {
  // GET /miniapp/api/me — shape copied from src/miniapp.js apiMe()
  "me": {
    admin: {
      id: 1,
      name: "مدیر اصلی",
      role: "owner",
      isOwner: true,
      perms: [
        "products","categories","slider","posts","faq","discounts","cards",
        "orders","gateway","settings","sms","users","admins"
      ],
    },
    store: { name: "فروشگاه تست", siteUrl: "" },
    permissions: [
      { key: "products", label: "محصولات" },
      { key: "categories", label: "دسته‌بندی" },
      { key: "orders", label: "سفارش‌ها" },
      { key: "settings", label: "تنظیمات" },
      { key: "users", label: "کاربران" },
      { key: "admins", label: "مدیران" },
    ],
  },
  "stats": {
    orders: { total: 12, new: 3, confirmed: 5, sent: 2, cancelled: 1, review: 1 },
    paidTotal: 87000000,
    paidMonth: 45000000,
    products: { total: 24, published: 21 },
    lowStock: 2,
    chart: {
      daily: { total: 14500000, labels: ["۱۴","۱۳","۱۲","۱۱","۱۰","۹","۸","۷","۶","۵","۴","۳","۲","۱"], values: [1.2, 0.8, 2.1, 1.5, 0.4, 1.9, 2.4, 1.1, 0.7, 1.6, 0.9, 2.0, 1.3, 0.6] },
      weekly: { total: 62000000, labels: ["۸","۷","۶","۵","۴","۳","۲","۱"], values: [6.5, 4.2, 9.8, 7.1, 3.4, 8.9, 11.2, 5.4] },
      monthly: { total: 240000000, labels: ["۱۴۰۴/۰۶","۱۴۰۴/۰۵","۱۴۰۴/۰۴","۱۴۰۴/۰۳","۱۴۰۴/۰۲","۱۴۰۴/۰۱"], values: [62, 48, 91, 74, 35, 88] },
    },
  },
  "orders/": {
    ok: true,
    orders: [
      { id: "o1", code: "۱۰۲۳", customer_name: "سارا", total: 500000, status: "new", created_at: Date.now() },
      { id: "o2", code: "۱۰۲۴", customer_name: "علی", total: 1200000, status: "paid", created_at: Date.now() },
    ],
    total: 2,
  },
  "products/": {
    products: [
      { id: "p1", name: "کیف چرمی", price: 500000, stock: 3, enabled: 1, category_id: "c1" },
    ],
    total: 1,
  },
  "users/": { users: [{ id: "u1", name: "سارا", phone: "۰۹۱۲***", orders: 2 }], total: 1 },
  "logs/": { logs: [{ id: "l1", section: "orders", text: "تغییر وضعیت سفارش", at: Date.now(), admin: "مدیر اصلی" }], total: 1 },
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "https://miniapp.example.com");
  const json = (data) => {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };

  if (url.pathname === "/" || url.pathname === "/miniapp") {
    const html = miniAppPage().replace(
      "https://telegram.org/js/telegram-web-app.js",
      ""
    );
    // inject our WebApp stub into the empty script src
    const out = html.replace(
      "</head>",
      `<script>${TG_STUB}</script></head>`
    );
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(out);
    return;
  }

  if (url.pathname.startsWith("/miniapp/api/")) {
    const tail = url.pathname.slice("/miniapp/api/".length);
    for (const key of Object.keys(API)) {
      if (tail.startsWith(key)) return json(API[key]);
    }
  }

  if (url.pathname.startsWith("/media/")) {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    res.writeHead(200, { "content-type": "image/png" });
    res.end(png);
    return;
  }

  json({ ok: true }); // permissive fallback so views render
});

server.listen(8792, () => console.log("mock miniapp on http://localhost:8792"));
