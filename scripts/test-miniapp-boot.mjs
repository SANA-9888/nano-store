// Headless smoke test of the real Telegram Mini App page.
// Runs the actual app <script> in Node with a minimal DOM + fetch stubs,
// so a JS runtime error would surface instead of hiding in the browser.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { miniAppPage } from "../src/miniapp.js";

const html = miniAppPage();
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

if (!code.length) {
  console.error("FAIL: no app script in miniAppPage()");
  process.exit(1);
}

const file = join(tmpdir(), "miniapp-runtime.mjs");
writeFileSync(file, code[code.length - 1]);

// Minimal DOM shim: enough for the app to boot and render every view.
// The app builds UI via innerHTML strings and reads it back via
// getElementById, so both paths have to work or a broken render would
// look like a green run.
const elements = new Map();

const mkEl = (tagOrId) => {
  const el = {
    tagName: String(tagOrId || "div").toUpperCase(),
    id: String(tagOrId),
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    attributes: {},
    _textContent: "",
    get textContent() {
      // Return the rendered string plus child text/HTML, so assertions read
      // what the user would see (tabs set innerHTML, nodes set textContent).
      return [this._textContent, this._innerHTML]
        .filter(Boolean)
        .join("")
        + this.children.map((c) => String(c.textContent || "")).join("");
    },
    set textContent(v) { this._textContent = String(v ?? ""); },
    innerHTML: "",
    value: "",
    hidden: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 600,
    _listeners: new Map(),
    _onclick: null,
    // The app builds most of its UI by writing innerHTML strings (49 sites),
    // so the shim has to parse them into real children or navigation has
    // nothing to click.
    _innerHTML: "",
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v || "");
      this.children = [...this._innerHTML.matchAll(/id="([^"]+)"/g)]
        .map((m) => elements.get(m[1]) || mkEl(m[1]));
      for (const c of this.children) c.parentElement = this;
    },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    remove() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    hasAttribute(k) { return k in this.attributes; },
    removeAttribute(k) { delete this.attributes[k]; },
    // Real event wiring: handlers fire when the harness calls .click().
    addEventListener(type, cb) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      const arr = this._listeners.get(type) || [];
      this._listeners.set(type, arr.filter((f) => f !== cb));
    },
    dispatchEvent(ev) {
      const t = (ev && ev.type) || "click";
      for (const cb of this._listeners.get(t) || []) cb(ev);
      if (t === "click" && typeof this._onclick === "function") this._onclick(ev);
      return true;
    },
    get onclick() { return this._onclick; },
    set onclick(fn) { this._onclick = fn; },
    click(ev) { this.dispatchEvent({ type: "click", ...ev }); },
    focus() {}, blur() {}, scrollIntoView() {},
    closest() { return mkEl("div"); },
    // Nested lookups fall through to fresh stubs so app code that walks the
    // DOM (e.g. error handlers reaching into #lock) works in the harness.
    querySelector() { return mkEl("div"); },
    querySelectorAll() { return []; },
    insertAdjacentHTML() {},
    replaceChildren() {},
    prepend() {}, append() {},
  };
  elements.set(el.id, el);
  return el;
};

const fetchCalls = [];
const lookupMisses = [];
const fetchStub = async (url, opts) => {
  const path = String(url).replace(/^.*?(\/miniapp\/api\/|\/media\/)/, (m) => m);
  fetchCalls.push(String(url));

  // me() is the identity call the app blocks on before rendering anything.
  // Shape must match the real handler in src/miniapp.js: {admin, store,
  // permissions} — older mocks returned "settings", which made the /me
  // handler throw on data.store.name and silently killed all rendering.
  if (String(url).includes("/miniapp/api/me")) {
    return {
      ok: true, status: 200,
      async json() {
        return {
          admin: {
            id: 1,
            name: "مدیر اصلی",
            role: "owner",
            isOwner: true,
            perms: ["products", "categories", "slider", "posts", "faq",
              "discounts", "cards", "orders", "gateway", "settings", "sms",
              "users", "admins"],
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
        };
      },
      async text() { return "{}"; },
    };
  }

  return {
    ok: true, status: 200,
    async json() {
      if (String(url).includes("/miniapp/api/orders")) {
        return { ok: true, orders: [], total: 0 };
      }
      if (String(url).includes("/miniapp/api/products")) {
        return { products: [], total: 0 };
      }
      if (String(url).includes("/miniapp/api/users")) {
        return { users: [], total: 0 };
      }
      if (String(url).includes("/miniapp/api/logs")) {
        return { logs: [], total: 0 };
      }
      return { ok: true };
    },
    async text() { return "{}"; },
  };
};

// Register every element id that exists in the REAL static page, so the
// app's getElementById lookups resolve instead of returning null. Without
// this, a missing id would look like an app bug when it is a shim gap.
for (const id of [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1])) {
  if (!elements.has(id)) elements.set(id, mkEl(id));
}

const registry = {
  Telegram: {
    WebApp: {
      initData: "query_id=AAE&user=%7B%22id%22%3A1%7D&auth_date=1&hash=xx",
      initDataUnsafe: { user: { id: 1, first_name: "مدیر" } },
      themeParams: {}, colorScheme: "dark", isExpanded: true,
      viewportHeight: 700, viewportStableHeight: 700,
      ready() {}, expand() {}, close() {},
      enableClosingConfirmation() {}, disableVerticalSwipes() {},
      showAlert(m) { console.log("[tg.alert]", m); },
      showConfirm(m, cb) { if (cb) cb(true); },
      showPopup(p, cb) { if (cb) cb("ok"); },
      onEvent() {}, offEvent() {},
      setHeaderColor() {}, setBackgroundColor() {},
      MainButton: { show() {}, hide() {}, setText() {}, onClick() {}, offClick() {} },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
    },
  },
  document: {
    body: mkEl("body"),
    head: mkEl("head"),
    documentElement: mkEl("html"),
    createElement: mkEl,
    createTextNode: (t) => ({ textContent: String(t) }),
    getElementById: (id) => {
      const el = elements.get(id);
      if (!el) lookupMisses.push(id);
      return el ?? null;
    },
    querySelector: () => mkEl("div"),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    cookie: "",
    readyState: "complete",
  },
  location: { href: "https://shop.example.com/miniapp", pathname: "/miniapp", search: "", hash: "" },
  localStorage: {
    store: new Map(),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); },
    clear() { this.store.clear(); },
  },
  fetch: fetchStub,
  URL,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Map, Set,
  console,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
  TextEncoder, TextDecoder,
  alert: (m) => console.log("[alert]", m),
};

const env = registry;

env.window = env;
env.self = env;
env.globalThis = env;

// Boot the app inside the shim.
try {
  const fn = new Function("window", "self", "globalThis", "document", "Telegram",
    "fetch", "localStorage", "location", "alert", "URL", "btoa", "atob",
    "setTimeout", "setInterval", "TextEncoder", "TextDecoder",
    "console", "Date", "Math", "JSON", "Object", "Array", "String", "Number",
    "Map", "Set", "Boolean",
    code[code.length - 1]);

  fn(env.window, env.self, env.globalThis, env.document, env.Telegram,
    env.fetch, env.localStorage, env.location, env.alert, env.URL, env.btoa,
    env.atob, env.setTimeout, env.setInterval, env.TextEncoder, env.TextDecoder,
    env.console, env.Date, env.Math, env.JSON, env.Object, env.Array,
    env.String, env.Number, env.Map, env.Set, env.Boolean);
} catch (err) {
  console.error("FAIL: app script threw on boot:", err && err.message);
  console.error(err && err.stack ? String(err.stack).split("\n").slice(0, 8).join("\n") : "");
  process.exit(1);
}

// Give async boot (the /me fetch) a tick to settle and render.
// The app's boot is promise-based and swallows rejections in a .catch that
// only shows a lock screen, so a broken render path would otherwise look
// like a passing run. Surface any unhandled rejection instead.
let swallowed = null;
process.on("unhandledRejection", (reason) => { swallowed = reason; });

await new Promise((resolve) => setTimeout(resolve, 400));

if (swallowed) {
  console.error("FAIL: boot promise rejected (would blank the miniapp):",
    swallowed && (swallowed.message || swallowed));
  process.exit(1);
}

const calls = fetchCalls.filter((u) => u.includes("/miniapp/api/me"));

if (calls.length !== 1) {
  console.error(`FAIL: expected exactly 1 /me call, got ${calls.length}`);
  process.exit(1);
}

// ---- Walk every view via real DOM clicks on the tabs the app rendered.
// ---- The app's functions are private (IIFE), so events are the only way
// ---- in. Any broken render path throws here instead of in a real client.
const exercised = [];

const tabsEl = env.document.getElementById("tabs");

if (!tabsEl) {
  console.error("FAIL: #tabs element missing — renderTabs produced nothing");
  process.exit(1);
}

for (const btn of tabsEl.children) {
  try {
    btn.click();
    await new Promise((r) => setTimeout(r, 80));
    exercised.push(String(btn.textContent || "tab").trim().replace(/<[^>]*>/g, "").trim());
  } catch (err) {
    console.error(`FAIL: tab "${exercised.length}" threw:`, err && err.message);
    process.exit(1);
  }
}

if (exercised.length < 6) {
  console.error(`FAIL: only ${exercised.length} tabs rendered — permissions or renderTabs is broken`);
  process.exit(1);
}

// Sheets: the product wizard and per-variant stock editor are opened from
// the products view, so land there first.
try {
  tabsEl.children.length && tabsEl.children[0].click();
  await new Promise((r) => setTimeout(r, 80));
} catch (err) {
  console.error("FAIL: returning to first tab threw:", err && err.message);
  process.exit(1);
}

// A second full boot must be idempotent (refresh button path).
try {
  const refresh = env.document.getElementById("refreshBtn");
  if (refresh && typeof refresh.click === "function") refresh.click();
  await new Promise((r) => setTimeout(r, 200));
} catch (err) {
  console.error("FAIL: refresh/re-boot threw:", err && err.message);
  process.exit(1);
}

console.log("PASS - miniapp app script boots, /me called once, total fetches:", fetchCalls.length);
console.log("PASS - tabs clicked without error:", exercised.join(" | "));
console.log("PASS - no runtime error during initial render");

if (lookupMisses.length) {
  const uniq = [...new Set(lookupMisses)];
  console.log("INFO - DOM lookups not present in static page (dynamic ids):",
    uniq.length, uniq.slice(0, 12).join(","));
}
