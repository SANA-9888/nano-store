
// PART 2 starts here.

(function () {
"use strict";

const $ = id => document.getElementById(id);
const money = value => Number(value || 0).toLocaleString("fa-IR") + " تومان";
const fa = value => Number(value || 0).toLocaleString("fa-IR");
const mediaURL = id => "/media/" + encodeURIComponent(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const STORAGE = {
  cart: "ps-v2:cart",
  theme: "ps-v2:theme",
  popup: "ps-v2:popup",
  pending: "ps-v2:pending-checkout",
  lastOrder: "ps-v2:last-order"
};

let S = {};
let bootstrapData = null;
let productsController = null;
let detailController = null;
let productMap = new Map();
let postMap = new Map();
let currentProduct = null;
let selectedOptions = {};
let page = 1;
let category = "";
let searchTimer;
let toastTimer;
let cart = [];
let lastFocus = null;

let sliderIndex = 0;
let sliderTimer = null;
let sliderPaused = false;
let sliderHover = false;
let sliderFocused = false;
let sliderVisible = true;
let sliderItems = [];
let sliderObserver = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function storageRead(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function storageWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in a restricted browser.
  }
}

function safeURL(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (!["https:", "http:", "tel:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function contactHTML(links) {
  return (Array.isArray(links) ? links : []).slice(0, 8).map(link => {
    const url = safeURL(link.url);
    if (!url) return "";

    return '<a href="' + escapeHTML(url) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHTML(link.label) + "</a>";
  }).join("");
}

async function api(path, options = {}) {
  let response;

  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Network request failed. Check your connection.");
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.status = response.status;
    throw error;
  }

  return data;
}

function toast(message, type) {
  const element = $("toast");
  clearTimeout(toastTimer);
  element.className = type === "success" ? "success" : "";
  element.textContent = message;
  element.hidden = false;
  // Lift the toast into the top layer so it renders above modal dialogs
  // (e.g. the product dialog opened with showModal()); otherwise it would
  // be hidden behind them regardless of z-index.
  if (typeof element.showPopover === "function") {
    try { element.showPopover(); } catch (_) { /* already shown */ }
  }
  toastTimer = setTimeout(hideToast, 4200);
}

function hideToast() {
  const element = $("toast");
  if (typeof element.hidePopover === "function") {
    try { element.hidePopover(); } catch (_) { /* not shown */ }
  }
  element.hidden = true;
}

function setTheme(theme, remember = false) {
  const value = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = value;

  const toggle = $("menu-theme");
  if (toggle) {
    toggle.hidden = !S.theme_switch_enabled;
    toggle.textContent = value === "dark"
      ? "☀️ رفتن به تم روشن"
      : "🌙 رفتن به تم تاریک";
  }

  if (remember) storageWrite(STORAGE.theme, value);
}

/*
 * Selected-category chip colors. Both follow the brand color unless the
 * owner overrides them (category_active_bg / category_active_color).
 * Without an override the text ink is derived from the background
 * luminance so a dark brand always gets readable white text.
 */
function applyChipColors(settings) {
  const root = document.documentElement.style;
  const brand = /^#[a-f0-9]{6}$/i.test(settings.brand_color || "")
    ? settings.brand_color.toLowerCase()
    : "#637c68";
  const bg = /^#[a-f0-9]{6}$/i.test(settings.category_active_bg || "")
    ? settings.category_active_bg.toLowerCase()
    : brand;

  let ink = /^#[a-f0-9]{6}$/i.test(settings.category_active_color || "")
    ? settings.category_active_color.toLowerCase()
    : "";

  if (!ink) {
    const rgb = [1, 3, 5].map(start => {
      const channel = parseInt(bg.slice(start, start + 2), 16) / 255;

      return channel <= 0.04045
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    ink = luminance > 0.179 ? "#101912" : "#ffffff";
  }

  root.setProperty("--chip-active-bg", bg);
  root.setProperty("--chip-active-ink", ink);
}

function applyBrand(color) {
  const value = /^#[a-f0-9]{6}$/i.test(color || "") ? color : "#637c68";
  document.documentElement.style.setProperty("--brand", value);

  const rgb = [1, 3, 5].map(start => {
    const channel = parseInt(value.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });

  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  document.documentElement.style.setProperty(
    "--brand-ink",
    luminance > 0.179 ? "#101912" : "#ffffff"
  );
  document.querySelector('meta[name="theme-color"]').content = value;
}

setTheme(storageRead(STORAGE.theme, "light"));

function showDialog(dialog) {
  const active = document.querySelector("dialog[open]");
  if (!active) lastFocus = document.activeElement;

  document.querySelectorAll("dialog[open]").forEach(other => {
    if (other !== dialog) other.close();
  });

  if (!dialog.open) dialog.showModal();
  document.body.classList.add("modal-open");
  updateSliderTimer();
}

function closeDialogs() {
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
}

function scrollToSection(id) {
  closeDialogs();
  const target = $(id);

  if (target && !target.hidden) {
    target.scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "start"
    });
  }
}

document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target.closest("[data-close]")) {
      dialog.close();
      return;
    }

    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (
        event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom
      ) dialog.close();
    }
  });

  dialog.addEventListener("close", () => {
    queueMicrotask(() => {
      if (!document.querySelector("dialog[open]")) {
        document.body.classList.remove("modal-open");
        if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
        updateSliderTimer();
      }
    });
  });
});

function selectionText(selection) {
  return Object.entries(selection || {})
    .map(([name, value]) => name + ": " + value)
    .join(" / ");
}

function canonicalSelection(selection) {
  return Object.fromEntries(
    Object.entries(selection || {}).sort(([a], [b]) => a.localeCompare(b))
  );
}

function cartIdentity(item) {
  return JSON.stringify([
    item.productId,
    item.variantId || "",
    canonicalSelection(item.selection)
  ]);
}

function readCart() {
  const saved = storageRead(STORAGE.cart, []);
  if (!Array.isArray(saved)) return [];

  const result = [];
  const seen = new Set();

  for (const item of saved.slice(0, 40)) {
    if (
      !item || typeof item.productId !== "string" ||
      item.productId.length > 64 ||
      typeof item.name !== "string" || item.name.length > 200 ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
      !Number.isSafeInteger(item.price) || item.price < 0 || item.price > 1e12 ||
      !item.selection || typeof item.selection !== "object" ||
      Array.isArray(item.selection) || Object.keys(item.selection).length > 4 ||
      Object.entries(item.selection).some(([key, value]) =>
        key.length > 60 || typeof value !== "string" || value.length > 80
      )
    ) continue;

    const clean = {
      productId: item.productId,
      variantId: typeof item.variantId === "string" ? item.variantId : "",
      name: item.name,
      selection: canonicalSelection(item.selection),
      quantity: item.quantity,
      price: item.price,
      image: typeof item.image === "string" && /^[a-f0-9]{32}$/.test(item.image)
        ? item.image : ""
    };

    const identity = cartIdentity(clean);
    if (seen.has(identity)) continue;

    seen.add(identity);
    result.push(clean);
  }

  return result;
}

cart = readCart();

function updateCartBadge() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  $("header-cart-count").textContent = fa(count);
  $("header-cart-count").hidden = count === 0;
  $("nav-cart-count").textContent = count ? "(" + fa(count) + ")" : "";
}

function saveCart() {
  const stored = storageWrite(STORAGE.cart, cart);
  updateCartBadge();
  refreshCheckoutSummary();
  return stored;
}

/*
 * Keep the open checkout dialog in sync with cart edits, whether they
 * happened in this tab or (via the storage event) in another one.
 * In pending-retry mode the frozen snapshot must stay visible.
 */
function refreshCheckoutSummary() {
  if (!pendingCheckout && !checkoutBusy && $("checkout-dialog").open) {
    fillCheckoutSummary();
  }
}

function subtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function shippingFee(amount) {
  const freeOver = Number(S.free_shipping_over || 0);
  return freeOver > 0 && amount >= freeOver
    ? 0 : Number(S.shipping_fee || 0);
}

function totalsHTML(amount, shipping, discount = 0) {
  return '<div><span>کالاها</span><strong>' + money(amount) + "</strong></div>" +
    '<div><span>ارسال</span><strong>' + money(shipping) + "</strong></div>" +
    (discount ? '<div><span>تخفیف</span><strong>' + money(discount) + "</strong></div>" : "") +
    '<div class="grand"><span>جمع</span><strong>' +
    money(amount + shipping - discount) + "</strong></div>";
}

function renderCart() {
  $("cart-items").innerHTML = cart.length
    ? cart.map((item, index) => {
        const image = item.image
          ? '<img class="cart-line-image" src="' + mediaURL(item.image) +
            '" alt="" loading="lazy" width="66" height="77">'
          : '<div class="cart-line-image placeholder" aria-hidden="true">◇</div>';

        return '<article class="cart-line">' + image + "<div>" +
          "<h3>" + escapeHTML(item.name) + "</h3>" +
          '<div class="selection">' + escapeHTML(selectionText(item.selection)) + "</div>" +
          '<div class="small">' + money(item.price) + "</div>" +
          '<div class="quantity">' +
          '<button data-qty="' + index + '" data-step="-1" aria-label="کاهش تعداد">−</button>' +
          "<span>" + fa(item.quantity) + "</span>" +
          '<button data-qty="' + index + '" data-step="1" aria-label="افزایش تعداد">+</button>' +
          '<button data-remove="' + index + '">حذف</button>' +
          "</div></div></article>";
      }).join("")
    : '<div class="empty">سبد شما هنوز خالی است.</div>';

  const amount = subtotal();
  $("cart-totals").innerHTML = cart.length
    ? totalsHTML(amount, shippingFee(amount)) : "";

  const freeOver = Number(S.free_shipping_over || 0);
  $("shipping-hint").hidden = !cart.length || freeOver <= 0;

  if (freeOver > 0) {
    $("shipping-hint").textContent = amount >= freeOver
      ? "ارسال این سفارش رایگان است."
      : "با " + money(freeOver - amount) + " خرید بیشتر، ارسال رایگان می‌شود.";
  }

  $("begin-checkout").disabled =
  !pendingCheckout && (!cart.length || !S.orders_enabled);
  $("begin-checkout").textContent = S.orders_enabled
    ? "ادامه و ثبت سفارش"
    : "ثبت سفارش موقتاً غیرفعال است";

  updateCartBadge();
}

function openCart() {
  if (!S.cart_enabled) return;
  $("cart-error").textContent = "";
  renderCart();
  showDialog($("cart-dialog"));
}

$("cart-items").addEventListener("click", event => {
  const remove = event.target.closest("[data-remove]");
  const quantity = event.target.closest("[data-qty]");

  if (remove) {
    const index = Number(remove.dataset.remove);
    if (!Number.isInteger(index) || !cart[index]) return;
    cart.splice(index, 1);
  } else if (quantity) {
    const index = Number(quantity.dataset.qty);
    const item = cart[index];
    if (!item) return;

    const next = item.quantity + Number(quantity.dataset.step);
    if (next > 99) return;
    if (next <= 0) cart.splice(index, 1);
    else item.quantity = next;
  } else return;

  $("cart-error").textContent = "";
  saveCart();
  renderCart();
});

function showSlide(index) {
  if (!sliderItems.length) return;
  sliderIndex = (index + sliderItems.length) % sliderItems.length;

  $("slides").querySelectorAll(".slide").forEach((element, at) => {
    element.hidden = at !== sliderIndex;
    if (at === sliderIndex) {
      const image = element.querySelector("img[data-src]");
      if (image) {
        image.src = image.dataset.src;
        delete image.dataset.src;
      }
    }
  });

  $("slider-dots").querySelectorAll("button").forEach((button, at) => {
    button.setAttribute("aria-current", String(at === sliderIndex));
  });

  updateSliderTimer();
}

function updateSliderTimer() {
  clearTimeout(sliderTimer);
  sliderTimer = null;

  const autoAllowed = S.slider_autoplay && !reducedMotion.matches;
  $("slide-pause").hidden = !autoAllowed || sliderItems.length < 2;
  $("slide-pause").textContent = sliderPaused ? "▶" : "Ⅱ";
  $("slide-pause").setAttribute(
    "aria-label", sliderPaused ? "ادامه حرکت خودکار" : "توقف حرکت خودکار"
  );
  $("slide-pause").setAttribute("aria-pressed", String(sliderPaused));

  if (
    !autoAllowed || sliderPaused || sliderHover || sliderFocused ||
    !sliderVisible || document.hidden || sliderItems.length < 2 ||
    document.querySelector("dialog[open]")
  ) return;

  const seconds = Math.max(4, Math.min(30, Number(S.slider_seconds) || 6));
  sliderTimer = setTimeout(() => showSlide(sliderIndex + 1), seconds * 1000);
}

function renderSlider(slides) {
  sliderItems = (Array.isArray(slides) ? slides : [])
    .filter(slide => slide.image_id).slice(0, 5);

  $("hero").hidden = !S.slider_enabled || !sliderItems.length;

  $("slides").innerHTML = sliderItems.map((slide, index) => {
    const caption = slide.title || slide.description || slide.button_text;
    const url = slide.target_type === "url" ? safeURL(slide.target_url) : "";
    const categoryTarget = slide.target_type === "category" && slide.target_category_id;

    let action = "";
    const actionText = escapeHTML(slide.button_text || "مشاهده محصولات");

    if (categoryTarget) {
      action = '<button class="slide-cta" data-slide-category="' +
        escapeHTML(slide.target_category_id) + '">' + actionText + " ←</button>";
    } else if (url) {
      action = '<a class="slide-cta" href="' + escapeHTML(url) +
        '" target="_blank" rel="noopener noreferrer">' + actionText + " ←</a>";
    }

    return '<div class="slide" role="group" aria-roledescription="اسلاید" aria-label="' +
      fa(index + 1) + " از " + fa(sliderItems.length) + '"' +
      (index ? " hidden" : "") + ">" +
      '<img class="slide-image" ' + (index ? "data-src" : "src") + '="' +
      mediaURL(slide.image_id) + '" alt="' + escapeHTML(slide.title || "بنر فروشگاه") +
      '" decoding="async"' + (index ? "" : ' fetchpriority="high"') + ">" +
      (caption || action ? '<div class="slide-shade"></div><div class="slide-content">' +
        (slide.title ? "<h2>" + escapeHTML(slide.title) + "</h2>" : "") +
        (slide.description ? "<p>" + escapeHTML(slide.description) + "</p>" : "") +
        action + "</div>" : "") + "</div>";
  }).join("");

  $("slider-dots").innerHTML = sliderItems.map((slide, index) =>
    '<button class="slider-dot" data-slide="' + index +
    '" aria-label="رفتن به اسلاید ' + fa(index + 1) +
    '" aria-current="' + String(index === 0) + '"></button>'
  ).join("");

  $("slider-controls").hidden = sliderItems.length < 2;
  showSlide(0);

  if ("IntersectionObserver" in window) {
    if (sliderObserver) sliderObserver.disconnect();

    sliderObserver = new IntersectionObserver(entries => {
      sliderVisible = entries[0].isIntersecting;
      updateSliderTimer();
    }, { threshold: 0.15 });

    sliderObserver.observe($("hero"));
  }
}

$("slide-prev").onclick = () => {
  sliderPaused = true;
  showSlide(sliderIndex - 1);
};
$("slide-next").onclick = () => {
  sliderPaused = true;
  showSlide(sliderIndex + 1);
};
$("slide-pause").onclick = () => {
  sliderPaused = !sliderPaused;
  updateSliderTimer();
};
$("slider-dots").onclick = event => {
  const button = event.target.closest("[data-slide]");
  if (!button) return;
  sliderPaused = true;
  showSlide(Number(button.dataset.slide));
};
$("slider").style.touchAction = "pan-y";
let swipeStart = null;

$("slider").addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.pointerType === "mouse") return;
  swipeStart = { x: event.clientX, y: event.clientY };
}, { passive: true });

$("slider").addEventListener("pointerup", event => {
  if (!swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;

  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    sliderPaused = true;
    showSlide(sliderIndex + (dx > 0 ? 1 : -1));
  }
}, { passive: true });

$("slider").addEventListener("pointercancel", () => { swipeStart = null; });
$("hero").addEventListener("mouseenter", () => {
  sliderHover = true;
  updateSliderTimer();
});
$("hero").addEventListener("mouseleave", () => {
  sliderHover = false;
  updateSliderTimer();
});
$("hero").addEventListener("focusin", () => {
  sliderFocused = true;
  updateSliderTimer();
});
$("hero").addEventListener("focusout", () => {
  queueMicrotask(() => {
    sliderFocused = $("hero").contains(document.activeElement);
    updateSliderTimer();
  });
});
document.addEventListener("visibilitychange", updateSliderTimer);
reducedMotion.addEventListener("change", updateSliderTimer);

function renderCategories(categories) {
  const enabled = Boolean(S.categories_enabled && categories.length);
  $("categories-section").hidden = !enabled;
  $("category-chips").hidden = !enabled;
  $("nav-categories").hidden = !enabled;
  $("menu-categories").hidden = !enabled;

  $("category-grid").innerHTML = categories.map(item => {
    const image = item.image_id
      ? '<img class="category-image" src="' + mediaURL(item.image_id) +
        '" alt="" loading="lazy" decoding="async" width="145" height="145">'
      : '<div class="category-image category-placeholder" aria-hidden="true">◇</div>';

    return '<button class="category-card" data-category="' + escapeHTML(item.id) +
      '">' + image + '<span class="category-name">' +
      escapeHTML(item.name) + "</span></button>";
  }).join("");

  $("category-chips").innerHTML =
    '<button class="active" data-category="">همه</button>' +
    categories.map(item =>
      '<button data-category="' + escapeHTML(item.id) + '">' +
      escapeHTML(item.name) + "</button>"
    ).join("");
}

function chooseCategory(id) {
  category = id || "";
  page = 1;

  document.querySelectorAll("[data-category]").forEach(button => {
    button.classList.toggle("active", button.dataset.category === category);
  });

  const found = bootstrapData?.categories.find(item => item.id === category);
  $("catalog-title").textContent = found ? found.name : "ویترین فروشگاه";
  loadProducts();
  scrollToSection("catalog");
}

for (const id of ["category-grid", "category-chips"]) {
  $(id).onclick = event => {
    const button = event.target.closest("[data-category]");
    if (button) chooseCategory(button.dataset.category);
  };
}

$("slides").onclick = event => {
  const button = event.target.closest("[data-slide-category]");
  if (button) chooseCategory(button.dataset.slideCategory);
};
$("all-products-button").onclick = () => chooseCategory("");

async function loadProducts() {
  if (productsController) productsController.abort();
  const controller = new AbortController();
  productsController = controller;

  $("products").setAttribute("aria-busy", "true");

  const query = new URLSearchParams({
    page: String(page),
    q: S.search_enabled ? $("search").value.trim() : "",
    category,
    sort: S.sorting_enabled ? $("sort").value : "new"
  });

  if (filterState.min) query.set("min", filterState.min);
  if (filterState.max) query.set("max", filterState.max);
  if (filterState.avail) query.set("avail", "1");
  if (filterState.cats.length) query.set("cats", filterState.cats.join(","));

  try {
    const data = await api("/api/products?" + query, { signal: controller.signal });
    if (controller !== productsController) return;

    if (page > data.pages && data.total > 0) {
      page = data.pages;
      return loadProducts();
    }

    productMap = new Map(data.products.map(product => [product.id, product]));
    $("product-count").textContent = fa(data.total) + " محصول";

    $("products").innerHTML = data.products.length
      ? data.products.map(product => {
          // The current list API returns base stock for variant products.
          // Never treat that base stock as the availability of its variants.
          const configurable = product.inventory_mode !== "simple";
          const unavailable = product.inventory_mode !== "variants" && product.stock <= 0;
          const image = product.primary_image
            ? '<img src="' + mediaURL(product.primary_image) + '" alt="' +
              escapeHTML(product.name) + '" loading="lazy" decoding="async" width="400" height="400">'
            : '<div class="placeholder" aria-hidden="true">◇</div>';

          const categoryName = bootstrapData.categories
            .find(item => item.id === product.category_id)?.name || "";

          return '<article class="product-card">' +
            '<button class="product-open" data-product="' + escapeHTML(product.id) +
            '" aria-haspopup="dialog" aria-label="' + escapeHTML("مشاهده " + product.name) + '">' +
            '<div class="product-cover">' + image +
            (unavailable ? '<span class="badge">ناموجود</span>' : "") + "</div>" +
            '<div class="product-info"><div class="product-category">' +
            escapeHTML(categoryName) + "</div><h3>" + escapeHTML(product.name) + "</h3>" +
            '<div class="price">' +
            (product.inventory_mode === "variants" ? '<small>قیمت پایه: </small>' : "") +
            fa(product.price) + " <small>تومان</small></div></div></button>" +
            (S.cart_enabled ? '<div class="product-action"><button class="primary" data-product="' +
              escapeHTML(product.id) + '" aria-haspopup="dialog"' +
              (unavailable ? " disabled" : "") + ">" +
              (unavailable ? "ناموجود" : configurable ? "انتخاب گزینه‌ها" : "مشاهده و خرید") +
              "</button></div>" : "") + "</article>";
        }).join("")
      : '<div class="empty">محصولی با این مشخصات پیدا نشد.</div>';

    $("pagination").innerHTML = data.total
      ? '<button data-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") +
        '>قبلی</button><span class="small muted">' + fa(page) + " از " + fa(data.pages) +
        '</span><button data-page="' + (page + 1) + '"' +
        (page >= data.pages ? " disabled" : "") + ">بعدی</button>"
      : "";
  } catch (error) {
    if (error.name === "AbortError") return;

    $("products").innerHTML = '<div class="empty"><p class="error">' +
      escapeHTML(error.message) + '</p><button id="retry-products">تلاش دوباره</button></div>';
    $("pagination").innerHTML = "";
  } finally {
    if (controller === productsController) {
      $("products").setAttribute("aria-busy", "false");
    }
  }
}

$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  if (productsController) productsController.abort();
  page = 1;
  searchTimer = setTimeout(loadProducts, 300);
});

// Class fallback keeps the compact box expanding even when the
// browser does not propagate :focus-within (older WebViews).
$("search").addEventListener("focus", () => $("search-wrap").classList.add("open"));
$("search").addEventListener("blur", () => $("search-wrap").classList.remove("open"));

$("sort").onchange = () => {
  page = 1;
  loadProducts();
};

// ---- price/availability/category filter (bottom sheet on phones) ----
let filterState = { min: "", max: "", avail: false, cats: [] };

function filterActive() {
  return Boolean(
    filterState.min || filterState.max || filterState.avail || filterState.cats.length
  );
}

/* Multi-select category picker inside the filter dialog. */
function renderFilterCategories() {
  const wrap = $("filter-cats");
  if (!wrap) return;

  const enabled = S.categories_enabled &&
    Array.isArray(bootstrapData?.categories) &&
    bootstrapData.categories.length > 0;

  $("filter-cats-wrap").hidden = !enabled;

  if (!enabled) {
    wrap.innerHTML = "";
    return;
  }

  wrap.innerHTML = bootstrapData.categories.map(item =>
    '<button type="button" data-fcat="' + escapeHTML(item.id) + '" class="' +
    (filterState.cats.includes(item.id) ? "active" : "") + '">' +
    escapeHTML(item.name) + "</button>"
  ).join("");

  wrap.querySelectorAll("[data-fcat]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.fcat;
      const index = filterState.cats.indexOf(id);

      if (index === -1) filterState.cats.push(id);
      else filterState.cats.splice(index, 1);

      button.classList.toggle("active");
    };
  });
}

function syncFilterButton() {
  $("filter-button").classList.toggle("active", filterActive());

  const note = $("active-filter-note");
  const parts = [];

  if (filterState.min) parts.push("از " + fa(filterState.min) + " تومان");
  if (filterState.max) parts.push("تا " + fa(filterState.max) + " تومان");
  if (filterState.avail) parts.push("فقط کالاهای موجود");

  if (filterState.cats.length) {
    const names = filterState.cats
      .map(id => bootstrapData?.categories.find(item => item.id === id)?.name || "")
      .filter(Boolean);

    if (names.length) parts.push("دسته‌ها: " + names.join("، "));
  }

  note.hidden = !parts.length;
  note.textContent = parts.length ? "فیلترهای فعال: " + parts.join("؛ ") : "";
}

/* Accepts Persian/Arabic digits and strips everything non-numeric. */
function normalizeDigits(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, ch => "۰۱۲۳۴۵۶۷۸۹".indexOf(ch))
    .replace(/[٠-٩]/g, ch => "٠١٢٣٤٥٦٧٨٩".indexOf(ch))
    .replace(/\D/g, "")
    .slice(0, 12);
}

$("filter-button").onclick = () => {
  $("filter-min").value = filterState.min;
  $("filter-max").value = filterState.max;
  $("filter-avail").checked = filterState.avail;
  renderFilterCategories();
  syncFilterButton();
  showDialog($("filter-dialog"));
};

$("filter-apply").onclick = () => {
  const min = normalizeDigits($("filter-min").value);
  const max = normalizeDigits($("filter-max").value);
  const note = $("active-filter-note");

  if (min && max && Number(min) > Number(max)) {
    note.hidden = false;
    note.textContent = "حداکثر قیمت باید بیشتر از حداقل باشد.";
    return;
  }

  filterState = {
    min,
    max,
    avail: $("filter-avail").checked,
    cats: [...filterState.cats]
  };
  syncFilterButton();
  page = 1;
  $("filter-dialog").close();
  loadProducts();
};

$("filter-clear").onclick = () => {
  filterState = { min: "", max: "", avail: false, cats: [] };
  $("filter-min").value = "";
  $("filter-max").value = "";
  $("filter-avail").checked = false;
  renderFilterCategories();
  syncFilterButton();
  page = 1;
  $("filter-dialog").close();
  loadProducts();
};

$("pagination").onclick = event => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  page = Number(button.dataset.page);
  loadProducts();
  scrollToSection("catalog");
};

$("products").onclick = event => {
  if (event.target.closest("#retry-products")) {
    loadProducts();
    return;
  }

  const button = event.target.closest("[data-product]");
  if (button && !button.disabled) openProduct(button.dataset.product);
};

function resolveProductSelection(product, selection) {
  const schema = product.optionSchema || [];
  const complete = product.inventoryMode === "simple" ||
    schema.every(group => group.values.includes(selection[group.name]));

  if (!complete) return null;

  if (product.inventoryMode === "variants") {
    const variant = product.variants.find(item =>
      schema.every(group => item.options[group.name] === selection[group.name])
    );

    if (!variant) return null;

    return {
      variantId: variant.id,
      selection: canonicalSelection(variant.options),
      price: variant.price === null ? product.price : variant.price,
      stock: variant.stock
    };
  }

  return {
    variantId: "",
    selection: product.inventoryMode === "simple"
      ? {} : canonicalSelection(selection),
    price: product.price,
    stock: product.stock
  };
}

function renderDetailSelection() {
  const product = currentProduct;
  if (!product) return;

  const schema = product.inventoryMode === "simple" ? [] : product.optionSchema;

  $("detail-options").innerHTML = schema.map((group, groupIndex) =>
    '<div class="option-group"><h3 id="option-label-' + groupIndex + '">' +
    escapeHTML(group.name) + '</h3><div class="option-values" role="group" aria-labelledby="option-label-' +
    groupIndex + '">' +
    group.values.map((value, valueIndex) =>
      '<button data-option-group="' + groupIndex + '" data-option-value="' + valueIndex +
      '" class="' + (selectedOptions[group.name] === value ? "selected" : "") +
      '" aria-pressed="' + String(selectedOptions[group.name] === value) + '">' +
      escapeHTML(value) + "</button>"
    ).join("") + "</div></div>"
  ).join("");

  const selected = resolveProductSelection(product, selectedOptions);
  const complete = schema.every(group => selectedOptions[group.name] !== undefined);

  $("detail-price").textContent = selected
    ? money(selected.price)
    : "قیمت پایه: " + money(product.price);

  $("detail-selection-message").textContent = !complete
    ? "گزینه‌های موردنظر را انتخاب کنید تا قیمت و موجودی مشخص شود."
    : !selected
      ? "این ترکیب برای فروش تعریف نشده است؛ گزینه‌ها را تغییر دهید."
      : selected.stock <= 0
        ? "این انتخاب فعلاً ناموجود است."
        : "";

  $("detail-stock").hidden = !S.stock_visible || !selected;
  $("detail-stock").textContent = selected ? "موجودی: " + fa(selected.stock) : "";
  $("detail-add").hidden = !S.cart_enabled;
  $("detail-add").disabled = !selected || selected.stock <= 0;
  $("detail-add").textContent = selected && selected.stock <= 0 ? "ناموجود" : "افزودن به سبد";
}

async function openProduct(id) {
  if (detailController) detailController.abort();
  const controller = new AbortController();
  detailController = controller;
  currentProduct = null;
  selectedOptions = {};

  $("detail-loading").hidden = false;
  $("detail-error").textContent = "";
  $("detail-content").hidden = true;
  $("detail-actions").hidden = true;
  showDialog($("product-dialog"));

  try {
    const product = await api("/api/product/" + encodeURIComponent(id), {
      signal: controller.signal
    });

    if (controller !== detailController) return;
    currentProduct = product;

    $("detail-name").textContent = product.name;
    $("detail-category").textContent = product.categoryName || "";
    $("detail-description").textContent = product.description;
    $("detail-attributes").innerHTML = String(product.attributes || "")
      .split("\n").filter(line => line.trim())
      .map(line => "<div>" + escapeHTML(line) + "</div>").join("");

    $("detail-image").hidden = !product.images.length;
    if (product.images.length) {
      $("detail-image").src = mediaURL(product.images[0]);
      $("detail-image").alt = product.name;
    }

    $("detail-thumbnails").innerHTML = product.images.map((image, index) =>
      '<button data-detail-image="' + escapeHTML(image) + '" aria-label="عکس ' + fa(index + 1) +
      '"><img src="' + mediaURL(image) + '" alt="" loading="lazy" width="57" height="57"></button>'
    ).join("");

    for (const group of product.optionSchema || []) {
      if (group.values.length === 1) selectedOptions[group.name] = group.values[0];
    }

    $("detail-content").hidden = false;
    $("detail-actions").hidden = false;
    renderDetailSelection();
  } catch (error) {
    if (error.name !== "AbortError") $("detail-error").textContent = error.message;
  } finally {
    if (controller === detailController) $("detail-loading").hidden = true;
  }
}

$("detail-thumbnails").onclick = event => {
  const button = event.target.closest("[data-detail-image]");
  if (button) $("detail-image").src = mediaURL(button.dataset.detailImage);
};

$("detail-options").onclick = event => {
  const button = event.target.closest("[data-option-group]");
  if (!button || !currentProduct) return;

  const group = currentProduct.optionSchema[Number(button.dataset.optionGroup)];
  const value = group?.values[Number(button.dataset.optionValue)];
  if (value === undefined) return;

  selectedOptions[group.name] = value;
  const groupIndex = button.dataset.optionGroup;
  const valueIndex = button.dataset.optionValue;
  renderDetailSelection();

  $("detail-options").querySelector(
    '[data-option-group="' + groupIndex + '"][data-option-value="' + valueIndex + '"]'
  )?.focus({ preventScroll: true });
};

$("detail-add").onclick = () => {
  if (!currentProduct || !S.cart_enabled) return;
  const selected = resolveProductSelection(currentProduct, selectedOptions);
  if (!selected || selected.stock <= 0) return;

  const candidate = {
    productId: currentProduct.id,
    variantId: selected.variantId,
    name: currentProduct.name,
    selection: selected.selection,
    quantity: 1,
    price: selected.price,
    image: currentProduct.images[0] || ""
  };

  const identity = cartIdentity(candidate);
  const existing = cart.find(item => cartIdentity(item) === identity);
  const inPool = cart.filter(item =>
    item.productId === candidate.productId &&
    (currentProduct.inventoryMode !== "variants" || item.variantId === candidate.variantId)
  ).reduce((sum, item) => sum + item.quantity, 0);

  if (inPool >= selected.stock || (existing && existing.quantity >= 99)) {
    toast("تعداد انتخاب‌شده به سقف موجودی رسیده است.");
    return;
  }

  if (existing) {
    existing.quantity++;
    existing.price = selected.price;
  } else {
    if (cart.length >= 40) {
      toast("حداکثر ۴۰ ردیف کالا در هر سفارش.");
      return;
    }
    cart.push(candidate);
  }

  const persisted = saveCart();
  toast(persisted
    ? "به سبد خرید اضافه شد."
    : "به سبد اضافه شد؛ ذخیره‌سازی مرورگر در دسترس نیست.", "success");
};

// Refresh in small groups instead of sending up to 40 requests simultaneously.
async function refreshCart() {
  if (!cart.length) throw new Error("Your cart is empty.");

  const snapshot = cart.map(item => ({
    ...item, selection: { ...item.selection }
  }));
  const identitiesBefore = JSON.stringify(cart);
  const ids = [...new Set(snapshot.map(item => item.productId))];
  const fresh = new Map();

  for (let offset = 0; offset < ids.length; offset += 4) {
    const group = ids.slice(offset, offset + 4);
    const products = await Promise.all(
      group.map(id => api("/api/product/" + encodeURIComponent(id)))
    );
    for (const product of products) fresh.set(product.id, product);
  }

  const pools = new Map();
  const next = snapshot.map(item => {
    const product = fresh.get(item.productId);
    let selected;

    if (product.inventoryMode === "variants") {
      const variant = product.variants.find(value => value.id === item.variantId);
      if (!variant) throw new Error("A selected variant is no longer available: " + item.name);

      selected = {
        variantId: variant.id,
        selection: canonicalSelection(variant.options),
        price: variant.price === null ? product.price : variant.price,
        stock: variant.stock
      };
    } else {
      if (item.variantId) throw new Error("Product options changed. Remove and re-add: " + item.name);
      selected = resolveProductSelection(product, item.selection);
    }

    if (!selected) throw new Error("Product options changed. Remove and re-add: " + item.name);

    const poolKey = product.id + ":" + selected.variantId;
    const used = (pools.get(poolKey) || 0) + item.quantity;
    pools.set(poolKey, used);

    if (used > selected.stock) throw new Error("Insufficient stock: " + product.name);

    return {
      ...item,
      name: product.name,
      variantId: selected.variantId,
      selection: selected.selection,
      price: selected.price,
      image: product.images[0] || ""
    };
  });

  if (identitiesBefore !== JSON.stringify(cart)) {
    throw new Error("The cart changed while refreshing. Try again.");
  }

  const changed = next.some((item, index) => item.price !== snapshot[index].price);
  cart = next;
  saveCart();
  renderCart();
  return changed;
}

function renderEditorial(data) {
  postMap = new Map(data.posts.map(post => [post.id, post]));

  $("blog-section").hidden = !S.blog_enabled || !data.posts.length;
  $("menu-blog").hidden = $("blog-section").hidden;

  /*
   * Title-only magazine cards (framed): the full post (image + body)
   * opens in the dialog on tap, fetched from /api/post/:id — this keeps
   * the bootstrap payload small and the page tidy.
   */
  $("posts").innerHTML = data.posts.map(post =>
    '<button class="blog-card" data-post="' + escapeHTML(post.id) +
    '" aria-haspopup="dialog">' +
    '<div class="blog-info"><h3>' + escapeHTML(post.title) + "</h3>" +
    '<span class="blog-read">خواندن نوشته ←</span></div></button>'
  ).join("");

  $("faq-section").hidden = !S.faq_enabled || !data.faqs.length;
  $("menu-faq").hidden = $("faq-section").hidden;
  $("faqs").innerHTML = data.faqs.map(faq =>
    "<details><summary>" + escapeHTML(faq.question) +
    '</summary><p class="pre muted">' + escapeHTML(faq.answer) + "</p></details>"
  ).join("");

  $("contact-section").hidden = !S.contact_enabled;
  $("menu-contact").hidden = !S.contact_enabled;
  $("contact-text").textContent = S.contact_text;
  $("contact-links").innerHTML = contactHTML(S.contact_links);
  $("footer-text").textContent = S.footer_text;
}

$("posts").onclick = event => {
  const button = event.target.closest("[data-post]");
  const post = button ? postMap.get(button.dataset.post) : null;
  if (!post) return;

  openPost(post);
};

/* Title card -> full post dialog (body fetched on demand, edge-cached). */
async function openPost(post) {
  $("post-title").textContent = post.title;
  $("post-content").textContent = post.body || "در حال بارگذاری…";
  $("post-image").hidden = !post.image_id;

  if (post.image_id) {
    $("post-image").src = mediaURL(post.image_id);
    $("post-image").alt = post.title;
  }

  showDialog($("post-dialog"));
  $("post-dialog").scrollTop = 0;

  try {
    const data = await api("/api/post/" + encodeURIComponent(post.id));
    const full = data.post || post;

    $("post-title").textContent = full.title || post.title;
    $("post-content").textContent = full.body || "";
    $("post-image").hidden = !full.image_id;

    if (full.image_id) {
      $("post-image").src = mediaURL(full.image_id);
      $("post-image").alt = full.title || post.title;
    }

    $("post-dialog").scrollTop = 0;
  } catch (error) {
    if (!post.body) {
      $("post-content").textContent =
        "بارگذاری نوشته ناموفق بود؛ اتصال را بررسی کنید و دوباره تلاش کنید.";
    }
  }
}

function focusSearch() {
  if (!S.search_enabled) return;
  scrollToSection("catalog");
  $("search").focus({ preventScroll: true });
}

$("menu-theme").onclick = () => {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  setTheme(current === "dark" ? "light" : "dark", true);
};
$("menu-button").onclick = () => showDialog($("menu-dialog"));
$("header-cart").onclick = openCart;
$("nav-cart").onclick = openCart;
$("header-search").onclick = focusSearch;
$("nav-search").onclick = focusSearch;

/* Login / register entries — visible only when the users module is on. */
function goAccount() {
  location.href = "/account";
}

$("account-button").onclick = goAccount;
$("menu-account").onclick = () => {
  closeDialogs();
  goAccount();
};
$("nav-home").onclick = () => {
  closeDialogs();
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
};
$("nav-categories").onclick = () => scrollToSection("categories-section");
$("menu-dialog").addEventListener("click", event => {
  const button = event.target.closest("[data-jump]");
  if (button) scrollToSection(button.dataset.jump);
});

// PART 3 continues below.
// Do not close the function, script tag or template literal yet.


// ============================================================
// Storefront — PART 3 OF 3
// Continue inside the function opened in PART 2.
// ============================================================

let checkoutBusy = false;
let receiptBusy = false;
let orderController = null;
let activeOrder = null;
let activeOrderCredentials = null;
let deadlineTimer = null;
let popupTimer = null;
let turnstilePromise = null;
let turnstileWidget = null;
/*
 * An unresolved checkout request (result unknown) stays retryable for a
 * limited time; afterwards it is dropped automatically so a stuck error
 * can never permanently block new orders.
 * Declared before readPendingCheckout() runs (no TDZ at script init).
 */
const PENDING_TTL = 15 * 60 * 1000;

function pendingExpired(pending) {
  return !pending || !Number.isFinite(pending.savedAt) ||
    Date.now() - pending.savedAt > PENDING_TTL;
}

let pendingCheckout = readPendingCheckout();

function randomAccessKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function validCredentials(value) {
  return Boolean(
    value &&
    /^[a-f0-9]{32}$/.test(value.id || "") &&
    /^[a-f0-9]{64}$/i.test(value.accessKey || "")
  );
}

function readPendingCheckout() {
  try {
    const pending = JSON.parse(sessionStorage.getItem(STORAGE.pending) || "null");

    if (
      pending &&
      pending.payload &&
      typeof pending.snapshot === "string" &&
      /^[a-f0-9-]{36}$/i.test(pending.payload.requestId || "") &&
      /^[a-f0-9]{64}$/i.test(pending.payload.accessKey || "") &&
      Array.isArray(pending.payload.items)
    ) {
      // Requests saved before this fix carry no savedAt timestamp and are
      // treated as expired on purpose: they are exactly the ones that got
      // customers stuck behind an unresolvable retry.
      if (!pendingExpired(pending)) return pending;

      sessionStorage.removeItem(STORAGE.pending);
    }
  } catch {
    // A restricted browser may not provide sessionStorage.
  }

  return null;
}

function savePendingCheckout(value) {
  pendingCheckout = value;

  try {
    // Contact details are kept in this tab's session storage,
    // not in the long-lived localStorage order record.
    if (value) sessionStorage.setItem(STORAGE.pending, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE.pending);
  } catch {
    // The same-page retry still works using the in-memory value.
  }
}

function lastOrderCredentials() {
  const value = storageRead(STORAGE.lastOrder);
  return validCredentials(value) ? value : null;
}

function setCheckoutLocked(locked) {
  $("checkout-form").querySelectorAll("input,textarea,select").forEach(input => {
    input.disabled = locked;
  });

  $("submit-order").textContent = locked
    ? "بررسی و تلاش مجدد همان سفارش"
    : "ثبت اولیه سفارش";
}

const GATEWAY_FA = {
  zarinpal: "زرین‌پال",
  zibal: "زیبال",
  snapppay: "اسنپ‌پی"
};

/*
 * Gateways the customer can pick from. payment_gateways is the multi-select
 * list shipped by newer bootstraps; older ones fall back to the single pick.
 * The master switch still gates the whole online-payment method.
 */
function activeGatewayNames() {
  if (!S.payment_gateway_enabled) return [];

  if (Array.isArray(S.payment_gateways) && S.payment_gateways.length) {
    return S.payment_gateways.filter(name => GATEWAY_FA[name]);
  }

  return GATEWAY_FA[S.payment_gateway] ? [S.payment_gateway] : [];
}

function paymentMethodsHTML() {
  const methods = [];

  if (S.payment_contact_enabled) {
    methods.push({
      value: "contact",
      gateway: "",
      title: "هماهنگی با مدیر",
      description: "ثبت اولیه و هماهنگی پرداخت و ارسال با فروشگاه."
    });
  }

  if (S.payment_card_enabled && bootstrapData.cards.length) {
    methods.push({
      value: "card",
      gateway: "",
      title: "کارت‌به‌کارت",
      description: "پس از ثبت سفارش، کارت‌ها و مهلت پرداخت نمایش داده می‌شوند."
    });
  }

  for (const name of activeGatewayNames()) {
    methods.push({
      value: "gateway",
      gateway: name,
      title: "پرداخت آنلاین (" + GATEWAY_FA[name] + ")",
      description: "پرداخت امن با کارت بانکی از درگاه " + GATEWAY_FA[name] +
        "؛ پس از پرداخت به فروشگاه بازمی‌گردید."
    });
  }

  return methods.map((method, index) =>
    '<label class="payment-option"><input type="radio" name="paymentMethod" value="' +
    method.value + '" data-gateway="' + (method.gateway || "") + '"' +
    (index === 0 ? " checked" : "") + ' required>' +
    "<span>" + escapeHTML(method.title) + "<small>" +
    escapeHTML(method.description) + "</small></span></label>"
  ).join("");
}

function fillCheckoutSummary(items = cart) {
  $("checkout-summary-items").innerHTML = items.map(item =>
    '<p style="margin-bottom:10px">' + escapeHTML(item.name) +
    " × " + fa(item.quantity) +
    (selectionText(item.selection)
      ? '<br><span class="muted">' + escapeHTML(selectionText(item.selection)) + "</span>"
      : "") + "</p>"
  ).join("");

  const amount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  $("checkout-totals").innerHTML = totalsHTML(amount, shippingFee(amount));
}

function fillPendingForm(pending) {
  const form = $("checkout-form");
  const payload = pending.payload;

  for (const key of ["name", "phone", "address", "postal", "note", "coupon"]) {
    const input = form.elements.namedItem(key);
    if (input) input.value = payload[key] || "";
  }

  const gatewayLabel = GATEWAY_FA[payload.gateway];
  const label = payload.paymentMethod === "card"
    ? "کارت‌به‌کارت"
    : payload.paymentMethod === "gateway"
      ? "پرداخت آنلاین" + (gatewayLabel ? " (" + gatewayLabel + ")" : "")
      : "هماهنگی با مدیر";

  $("payment-methods").innerHTML =
    '<label class="payment-option"><input type="radio" name="paymentMethod" value="' +
    escapeHTML(payload.paymentMethod) + '" checked>' +
    "<span>" + label +
    "<small>تلاش مجدد برای همان درخواست قبلی</small></span></label>";

  try {
    fillCheckoutSummary(JSON.parse(pending.snapshot));
  } catch {
    fillCheckoutSummary();
  }

  $("discard-pending").hidden = false;
  setCheckoutLocked(true);
}

async function ensureTurnstile() {
  if (!S.turnstile_enabled) return;

  if (!S.turnstile_site_key) {
    throw new Error("Turnstile site key is missing.");
  }

  if (!turnstilePromise) {
    turnstilePromise = new Promise((resolve, reject) => {
      if (window.turnstile) {
        window.turnstile.ready(resolve);
        return;
      }

      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        turnstilePromise = null;
        script.remove();
        reject(new Error("Security verification failed to load. Try again."));
      }, 20000);

      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;

      script.onload = () => {
        clearTimeout(timeout);

        if (!window.turnstile) {
          turnstilePromise = null;
          reject(new Error("Security verification is unavailable."));
          return;
        }

        window.turnstile.ready(resolve);
      };

      script.onerror = () => {
        clearTimeout(timeout);
        turnstilePromise = null;
        script.remove();
        reject(new Error("Security verification failed to load."));
      };

      document.head.appendChild(script);
    });
  }

  await turnstilePromise;

  if (turnstileWidget === null) {
    turnstileWidget = window.turnstile.render("#turnstile-container", {
      sitekey: S.turnstile_site_key,
      action: "checkout",
      theme: "auto",
      "response-field": false,
      "error-callback": function () {
        $("checkout-error").textContent =
          "Security verification failed. Refresh the verification and retry.";
      }
    });
  } else {
    window.turnstile.reset(turnstileWidget);
  }
}

function resetTurnstile() {
  if (window.turnstile && turnstileWidget !== null) {
    try {
      window.turnstile.reset(turnstileWidget);
    } catch {
      // The next form opening can initialize the verification again.
    }
  }
}

async function beginCheckout() {
  if (checkoutBusy) return;

  // A pending request older than its TTL no longer blocks new orders.
  if (pendingCheckout && pendingExpired(pendingCheckout)) {
    savePendingCheckout(null);
    $("retry-pending-order")?.remove();
  }

  if (!pendingCheckout && (!cart.length || !S.orders_enabled || !S.cart_enabled)) return;

  checkoutBusy = true;
  $("begin-checkout").disabled = true;
  $("cart-error").textContent = "";
  $("checkout-error").textContent = "";

  try {
    if (pendingCheckout) {
      fillPendingForm(pendingCheckout);
      showDialog($("checkout-dialog"));

      $("checkout-error").textContent =
        "این درخواست قبلاً ارسال شده اما نتیجه‌اش مشخص نشده است. " +
        "برای جلوگیری از ثبت تکراری، همین سفارش را دوباره ثبت کنید " +
        "یا با دکمهٔ پایین آن را لغو کنید.";

      // Retrying an already-saved order does not require a new Turnstile
      // token on the server. If loading fails, keep the retry available.
      try {
        await ensureTurnstile();
      } catch (error) {
        $("checkout-error").textContent += "\n" + error.message;
      }

      return;
    }

    const methods = paymentMethodsHTML();
    if (!methods) throw new Error("در حال حاضر هیچ روش پرداختی فعال نیست؛ با مدیر فروشگاه هماهنگ کنید.");

    const pricesChanged = await refreshCart();

    if (pricesChanged) {
      $("cart-error").textContent =
        "قیمت یا موجودی برخی کالاها تغییر کرده است؛ سبد را بازبینی کنید و دوباره ادامه دهید.";
      return;
    }

    setCheckoutLocked(false);
    $("discard-pending").hidden = true;
    $("payment-methods").innerHTML = methods;
    fillCheckoutSummary();
    showDialog($("checkout-dialog"));
    await ensureTurnstile();
  } catch (error) {
    if ($("checkout-dialog").open) {
      $("checkout-error").textContent = error.message;
    } else {
      $("cart-error").textContent = error.message;
    }
  } finally {
    checkoutBusy = false;
    $("begin-checkout").disabled = !pendingCheckout &&
      (!cart.length || !S.orders_enabled);
  }
}

$("begin-checkout").onclick = beginCheckout;

/*
 * Escape hatch for an unresolved previous request: the customer can
 * drop it and start a fresh order (e.g. when the cart changed since).
 */
$("discard-pending").onclick = () => {
  savePendingCheckout(null);
  $("retry-pending-order")?.remove();
  $("checkout-error").textContent = "";
  $("checkout-form").reset();
  setCheckoutLocked(false);

  const methods = paymentMethodsHTML();

  if (!methods) {
    $("checkout-dialog").close();
    return;
  }

  $("discard-pending").hidden = true;
  $("payment-methods").innerHTML = methods;
  fillCheckoutSummary();
  ensureTurnstile().catch(() => {});
};

let payBusy = false;

async function redirectToGateway(credentials) {
  const result = await api("/api/pay/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Order-Key": credentials.accessKey
    },
    body: JSON.stringify({ orderId: credentials.id }),
    signal: AbortSignal.timeout(30000)
  });

  if (!result || !/^https:\/\//i.test(String(result.redirect || ""))) {
    throw new Error("درگاه پرداخت در دسترس نیست؛ بعداً تلاش کنید.");
  }

  location.href = result.redirect;
}

$("checkout-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (checkoutBusy) return;

  checkoutBusy = true;
  $("submit-order").disabled = true;
  $("checkout-error").textContent = "";

  try {
    let pending = pendingCheckout;

    if (!pending) {
      const form = new FormData($("checkout-form"));
      const paymentMethod = form.get("paymentMethod");

      if (!["contact", "card", "gateway"].includes(paymentMethod)) {
        throw new Error("روش پرداخت را انتخاب کنید.");
      }

      if (!cart.length) throw new Error("سبد خرید شما خالی است.");

      const checkedMethod = $("payment-methods").querySelector(
        'input[name="paymentMethod"]:checked'
      );
      const chosenGateway = paymentMethod === "gateway"
        ? String(checkedMethod?.dataset.gateway || "")
        : "";

      if (paymentMethod === "gateway" && !chosenGateway) {
        throw new Error("درگاه پرداخت در دسترس نیست؛ صفحه را تازه‌سازی کنید.");
      }

      const payload = {
        requestId: crypto.randomUUID(),
        accessKey: randomAccessKey(),
        name: String(form.get("name") || ""),
        phone: String(form.get("phone") || ""),
        address: String(form.get("address") || ""),
        postal: String(form.get("postal") || ""),
        note: S.order_notes_enabled ? String(form.get("note") || "") : "",
        coupon: S.discounts_enabled ? String(form.get("coupon") || "") : "",
        paymentMethod,
        gateway: chosenGateway,
        items: cart.map(item => ({
          productId: item.productId,
          variantId: item.variantId || "",
          selection: item.selection,
          quantity: item.quantity
        }))
      };

      if (S.turnstile_enabled) {
        const token = window.turnstile && turnstileWidget !== null
          ? window.turnstile.getResponse(turnstileWidget)
          : "";

        if (!token) {
          throw new Error("Complete the security verification.");
        }
      }

      pending = { payload, snapshot: JSON.stringify(cart), savedAt: Date.now() };
      savePendingCheckout(pending);
    }

    const payload = { ...pending.payload };

    if (S.turnstile_enabled) {
      payload.turnstile = window.turnstile && turnstileWidget !== null
        ? window.turnstile.getResponse(turnstileWidget)
        : "";
    }

    setCheckoutLocked(true);

    const result = await api("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });

    const credentials = {
      id: result.id,
      code: result.code,
      accessKey: payload.accessKey
    };

    if (!validCredentials(credentials)) {
      throw new Error("The server returned invalid order information.");
    }

    const remembered = storageWrite(STORAGE.lastOrder, credentials);
    activeOrderCredentials = credentials;
    $("last-order-button").hidden = false;

    // Do not erase cart changes made in the meantime.
    if (JSON.stringify(cart) === pending.snapshot) {
      cart = [];
      saveCart();
    }

    savePendingCheckout(null);
    $("retry-pending-order")?.remove();
    $("discard-pending").hidden = true;
    $("checkout-form").reset();
    setCheckoutLocked(false);

    if (payload.paymentMethod === "gateway") {
      // Credentials and the pending flag are already stored: if the gateway
      // hand-off fails, the customer can retry from the order dialog.
      toast("سفارش ثبت شد؛ در حال انتقال به درگاه پرداخت…");
      await redirectToGateway(credentials);
      return;
    }

    toast(remembered
      ? "سفارش ثبت شد؛ کد پیگیری را نگه دارید."
      : "سفارش ثبت شد؛ ذخیره مرورگر فعال نیست. کد پیگیری را یادداشت کنید.");

    await openOrder(credentials);
    loadProducts();
  } catch (error) {
    const definitiveRejection = error.status >= 400 &&
      error.status < 500 &&
      ![408, 429].includes(error.status);

    if (definitiveRejection) {
      savePendingCheckout(null);
      setCheckoutLocked(false);
      $("discard-pending").hidden = true;

      const methods = paymentMethodsHTML();
      if (methods) $("payment-methods").innerHTML = methods;
    }

    $("checkout-error").textContent = error.message +
      (pendingCheckout
        ? "\nنتیجهٔ درخواست نامشخص است؛ همان سفارش را دوباره ثبت کنید و پرداخت را تکرار نکنید."
        : "");

    if (pendingCheckout) setCheckoutLocked(true);
    resetTurnstile();
  } finally {
    checkoutBusy = false;
    $("submit-order").disabled = false;
  }
});

const ORDER_LABELS = {
  new: "ثبت اولیه",
  confirmed: "تأییدشده",
  sent: "ارسال‌شده",
  cancelled: "لغوشده"
};

const PAYMENT_LABELS = {
  unpaid: "پرداخت هنوز تأیید نشده است.",
  review: "رسید دریافت شده و در انتظار بررسی مدیر است.",
  paid: "پرداخت توسط مدیر تأیید شده است."
};

function orderIsActive(order) {
  return ["new", "confirmed"].includes(order.status);
}

function receiptAllowed(order) {
  return order.paymentMethod === "card" &&
    orderIsActive(order) &&
    order.paymentStatus !== "paid" &&
    (!order.expiresAt || order.expiresAt > Date.now()) &&
    order.receipts.length < 3;
}

function renderPrivateOrder(order) {
  activeOrder = order;
  clearTimeout(deadlineTimer);

  $("order-code").textContent = order.code;
  $("order-message").textContent = order.message || "";
  $("order-status").textContent = ORDER_LABELS[order.status] || order.status;
  $("order-payment-status").textContent =
    PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus;

  $("order-totals").innerHTML = totalsHTML(
    order.subtotal,
    order.shipping,
    order.discount
  );

  $("order-lines").innerHTML = order.lines.map(line =>
    '<p style="margin-bottom:12px"><strong>' + escapeHTML(line.name) +
    "</strong> × " + fa(line.quantity) +
    (selectionText(line.selection)
      ? '<br><span class="muted">' + escapeHTML(selectionText(line.selection)) + "</span>"
      : "") +
    "<br>" + money(line.price * line.quantity) + "</p>"
  ).join("");

  const unexpired = !order.expiresAt || order.expiresAt > Date.now();
  const showCards = order.paymentMethod === "card" &&
    orderIsActive(order) &&
    order.paymentStatus === "unpaid" &&
    unexpired;

  $("bank-section").hidden = !showCards;
  $("bank-cards").innerHTML = showCards ? order.cards.map((card, index) => {
    const number = String(card.card_number || "")
      .replace(/(.{4})(?=.)/g, "$1 ");

    return '<article class="bank-card">' +
      '<div class="bank-top"><strong>' + escapeHTML(card.bank_name) +
      '</strong><span class="bank-label">' + escapeHTML(card.label) + "</span></div>" +
      '<div class="bank-number">' + escapeHTML(number) + "</div>" +
      '<div class="bank-bottom"><span class="bank-holder">' +
      escapeHTML(card.holder_name) + '</span><button data-copy-card="' +
      index + '">کپی شماره</button></div></article>';
  }).join("") : "";

  if (showCards) {
    $("payment-deadline").textContent = order.expiresAt
      ? "مهلت واریز: " + new Date(order.expiresAt).toLocaleString("fa-IR", {
          timeZone: "Asia/Tehran"
        })
      : "قبل از واریز با مدیر هماهنگ کنید.";

    if (!order.cards.length) {
      $("bank-cards").innerHTML =
        '<p class="error">No active bank card is available. Contact the manager.</p>';
    }
  }

  if (
    order.paymentMethod === "card" &&
    order.paymentStatus === "unpaid" &&
    !unexpired
  ) {
    $("order-payment-status").textContent =
      "مهلت پرداخت پایان یافته است. واریز نکنید؛ با مدیر هماهنگ کنید.";
  }

  $("gateway-section").hidden = !(order.paymentMethod === "gateway" &&
    orderIsActive(order) &&
    order.paymentStatus !== "paid");
  $("gateway-error").textContent = "";

  if (order.paymentMethod === "gateway" && order.paymentStatus === "paid") {
    $("order-payment-status").textContent =
      "پرداخت آنلاین با موفقیت انجام شد.";
  }

  $("receipt-section").hidden = !receiptAllowed(order);
  $("receipt-count").textContent =
    "تعداد رسیدهای ثبت‌شده: " + fa(order.receipts.length) + " از ۳";

  $("order-contact-text").textContent = order.contact || "";
  $("order-contact-links").innerHTML = contactHTML(order.links);

  if (order.expiresAt && order.expiresAt > Date.now()) {
    deadlineTimer = setTimeout(() => {
      if (activeOrder?.id === order.id) renderPrivateOrder(activeOrder);
    }, Math.min(order.expiresAt - Date.now() + 100, 2147483647));
  }

  $("order-content").hidden = false;
}

async function openOrder(credentials) {
  if (!validCredentials(credentials)) {
    toast("Order access information is unavailable.");
    return;
  }

  if (orderController) orderController.abort();
  const controller = new AbortController();
  orderController = controller;
  activeOrderCredentials = credentials;
  activeOrder = null;

  $("order-error").textContent = "";
  $("receipt-error").textContent = "";
  $("order-content").hidden = true;
  $("order-loading").hidden = false;
  $("receipt-file").value = "";

  showDialog($("order-dialog"));

  try {
    const order = await api(
      "/api/orders/" + encodeURIComponent(credentials.id),
      {
        headers: { "X-Order-Key": credentials.accessKey },
        signal: controller.signal
      }
    );

    if (controller !== orderController) return;
    renderPrivateOrder(order);
  } catch (error) {
    if (error.name === "AbortError") return;

    $("order-error").textContent = error.message +
      (credentials.code ? "\nOrder code: " + credentials.code : "");

    if (credentials.code) {
      $("order-error").textContent +=
        "\nKeep this code and contact the store if the problem continues.";
    }
  } finally {
    if (controller === orderController) $("order-loading").hidden = true;
  }
}

$("pay-online").onclick = async () => {
  if (payBusy || !activeOrderCredentials) return;

  payBusy = true;
  $("pay-online").disabled = true;
  $("gateway-error").textContent = "";

  try {
    await redirectToGateway(activeOrderCredentials);
  } catch (error) {
    $("gateway-error").textContent = error.message +
      "\nکد سفارش: " + (activeOrderCredentials.code || "—");
  } finally {
    payBusy = false;
    $("pay-online").disabled = false;
  }
};

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(String(value));
    toast(successMessage);
  } catch {
    toast("Copy failed. Select and copy the displayed value manually.");
  }
}

$("copy-order-code").onclick = () => {
  if (activeOrder) copyText(activeOrder.code, "کد سفارش کپی شد.");
};

$("refresh-order").onclick = () => {
  if (!receiptBusy && activeOrderCredentials) openOrder(activeOrderCredentials);
};

$("last-order-button").onclick = () => {
  const credentials = activeOrderCredentials || lastOrderCredentials();
  if (credentials) openOrder(credentials);
};

$("bank-cards").onclick = event => {
  const button = event.target.closest("[data-copy-card]");
  if (!button || !activeOrder) return;

  const card = activeOrder.cards[Number(button.dataset.copyCard)];
  if (card) copyText(card.card_number, "شماره کارت کپی شد.");
};

$("send-receipt").onclick = async () => {
  if (receiptBusy || !activeOrder || !activeOrderCredentials) return;

  $("receipt-error").textContent = "";

  if (!receiptAllowed(activeOrder)) {
    $("receipt-error").textContent =
      "This order cannot receive a receipt. Refresh its status.";
    return;
  }

  const file = $("receipt-file").files?.[0];

  if (!file) {
    $("receipt-error").textContent = "Select a receipt image.";
    return;
  }

  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size <= 0 ||
    file.size > 4 * 1024 * 1024
  ) {
    $("receipt-error").textContent =
      "Use a JPEG, PNG or WebP image up to 4 MiB.";
    return;
  }

  receiptBusy = true;
  $("send-receipt").disabled = true;
  $("receipt-file").disabled = true;
  $("send-receipt").textContent = "در حال ارسال…";

  const credentials = { ...activeOrderCredentials };

  try {
    await api(
      "/api/orders/" + encodeURIComponent(credentials.id) + "/receipt",
      {
        method: "POST",
        headers: {
          "content-type": file.type,
          "X-Order-Key": credentials.accessKey
        },
        body: file,
        signal: AbortSignal.timeout(90000)
      }
    );

    toast("رسید برای بررسی مدیر دریافت شد؛ پرداخت هنوز تأیید نشده است.");
    await openOrder(credentials);
  } catch (error) {
    $("receipt-error").textContent = error.message +
      "\nBefore uploading again, refresh the order to check whether the receipt was received.";
  } finally {
    receiptBusy = false;
    $("send-receipt").disabled = false;
    $("receipt-file").disabled = false;
    $("send-receipt").textContent = "ارسال رسید برای بررسی";
  }
};

function configurePopup() {
  clearTimeout(popupTimer);

  if (!S.popup_enabled) return;
  if (!S.popup_title && !S.popup_text && !S.popup_image) return;

  const signature = JSON.stringify([
    S.popup_title,
    S.popup_text,
    S.popup_image,
    S.popup_url,
    S.popup_button
  ]);

  const previous = storageRead(STORAGE.popup);
  const shouldShow = S.popup_every_visit ||
    !previous ||
    previous.signature !== signature ||
    Date.now() - previous.time > 86400000;

  if (!shouldShow) return;

  $("popup-title").textContent = S.popup_title || "اطلاعیه فروشگاه";
  $("popup-text").textContent = S.popup_text || "";

  $("popup-image").hidden = !S.popup_image;
  if (S.popup_image) $("popup-image").src = mediaURL(S.popup_image);

  const url = safeURL(S.popup_url);
  $("popup-link").hidden = !url;

  if (url) {
    $("popup-link").href = url;
    $("popup-link").textContent = S.popup_button || "مشاهده";
  }

  popupTimer = setTimeout(() => {
    if (document.querySelector("dialog[open]")) return;

    showDialog($("popup-dialog"));
    storageWrite(STORAGE.popup, {
      signature,
      time: Date.now()
    });
  }, 1500);
}

function applyBootstrap(data) {
  if (
    !data ||
    typeof data.settings !== "object" ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.slides) ||
    !Array.isArray(data.posts) ||
    !Array.isArray(data.faqs)
  ) {
    throw new Error("Store configuration is invalid.");
  }

  data.cards = Array.isArray(data.cards) ? data.cards : [];
  bootstrapData = data;
  S = data.settings;

  document.title = S.store_name || "فروشگاه";
  $("store-name").textContent = S.store_name || "فروشگاه";
  $("tagline").textContent = S.tagline || "";
  applyBrand(S.brand_color);
  applyChipColors(S);

  $("store-logo").hidden = !S.logo;
  if (S.logo) $("store-logo").src = mediaURL(S.logo);

  $("uploaded-font").textContent =
    /^[a-f0-9]{32}$/.test(S.font || "")
      ? '@font-face{font-family:StoreFont;src:url("/media/' +
        S.font +
        '");font-display:swap;font-style:normal;font-weight:100 900;}'
      : "";

  const theme = S.theme_switch_enabled
    ? storageRead(STORAGE.theme, S.default_theme)
    : S.default_theme;

  setTheme(theme);

  $("announcement").hidden = !S.announcement_enabled || !S.announcement;
  $("announcement").textContent = S.announcement || "";

  $("search-wrap").hidden = !S.search_enabled;
  $("header-search").hidden = !S.search_enabled;
  $("nav-search").hidden = !S.search_enabled;
  $("sort-wrap").hidden = !S.sorting_enabled;

  /*
   * The admin's default sort (default_sort setting) is applied on every
   * fresh load; the customer can still switch it freely afterwards.
   */
  if (S.sorting_enabled && ["new", "pop", "cheap", "expensive"].includes(S.default_sort)) {
    $("sort").value = S.default_sort;
  }

  const tools = $("search-wrap").parentElement;
  tools.hidden = !S.search_enabled && !S.sorting_enabled;
  tools.style.gridTemplateColumns =
    S.search_enabled && S.sorting_enabled ? "" : "minmax(0,1fr)";

  // With sorting hidden the compact search takes the whole row.
  $("search-wrap").style.width =
    S.search_enabled && !S.sorting_enabled ? "100%" : "";

  $("header-cart").hidden = !S.cart_enabled;
  $("nav-cart").hidden = !S.cart_enabled;
  $("note-field").hidden = !S.order_notes_enabled;
  $("coupon-field").hidden = !S.discounts_enabled;

  renderSlider(data.slides);
  renderCategories(data.categories);
  renderEditorial(data);
  updateCartBadge();

  $("last-order-button").hidden = !lastOrderCredentials() &&
    !activeOrderCredentials;

  // Optional customer-accounts module (src/users.js).
  const usersOn = data.users_module === true;

  $("account-link").hidden = !usersOn;
  $("account-button").hidden = !usersOn;
  $("menu-account").hidden = !usersOn;

  renderFilterCategories();

  configurePopup();
}

async function initializeStore() {
  $("boot-error").hidden = true;
  $("products").setAttribute("aria-busy", "true");

  try {
    const data = await api("/api/bootstrap");
    applyBootstrap(data);
    await loadProducts();

    if (pendingCheckout) {
      // A separate control makes retry possible even if ordering was
      // disabled after the original request reached the server.
      let retry = $("retry-pending-order");

      if (!retry) {
        retry = document.createElement("button");
        retry.id = "retry-pending-order";
        retry.className = "wide";
        retry.style.marginTop = "18px";
        retry.textContent = "بررسی درخواست سفارش قبلی";
        $("main").prepend(retry);
      }

      retry.onclick = beginCheckout;

      toast("یک درخواست سفارش با نتیجه نامشخص دارید؛ قبل از سفارش جدید آن را بررسی کنید.");
    } else {
      // No unresolved request (or it expired): never keep a stale button.
      $("retry-pending-order")?.remove();
    }
  } catch (error) {
    $("boot-error").hidden = false;
    $("boot-error-text").textContent =
      "Store initialization failed: " + error.message;
    $("products").innerHTML =
      '<div class="empty">فروشگاه در حال حاضر بارگذاری نشد.</div>';
    $("products").setAttribute("aria-busy", "false");
  }
}

$("reload-button").onclick = () => location.reload();

window.addEventListener("storage", event => {
  if (event.key === STORAGE.cart && !checkoutBusy) {
    cart = readCart();
    updateCartBadge();
    if ($("cart-dialog").open) renderCart();
    refreshCheckoutSummary();
  }

  if (event.key === STORAGE.lastOrder) {
    $("last-order-button").hidden = !lastOrderCredentials() &&
      !activeOrderCredentials;
  }
});

updateCartBadge();
initializeStore();

})();
