// ============================================================
// Persian Store V2 — Shared administrator permission model.
// Used by the Telegram bot (panel gating) and the notification
// dispatcher (so restricted admins never receive sections they
// cannot access). Kept dependency-free on purpose.
// ============================================================

/*
 * Fine-grained permission keys. Every home section maps to its own
 * key, so a manager can be granted e.g. only products without
 * slider/cards/discounts. Legacy roles map onto these; an admin with
 * role='custom' carries an explicit list in admins.permissions.
 */
export const PERMISSIONS = {
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

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

export const ROLES = {
  owner: "مدیر اصلی",
  admin: "مدیر",
  operator: "اپراتور سفارش",
  custom: "دسترسی سفارشی"
};

// "stats" is readable by every role and is therefore not listed here.
export const ROLE_PERMISSIONS = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter(key => key !== "admins"),
  operator: ["orders"]
};

/*
 * Old permission keys (before the fine-grained split) are expanded on
 * read. "catalog" intentionally does NOT grant discounts/cards: those
 * were the leaks reported by the shop owner.
 */
export const LEGACY_EXPANSION = {
  catalog: ["products", "categories", "slider", "posts", "faq"],
  orders: ["orders"],
  gateway: ["gateway"],
  settings: ["settings"],
  admins: ["admins"]
};

export function accessOf(row) {
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

export function roleAllows(access, permission) {
  return access.isOwner || access.perms.includes(permission);
}

/*
 * Convenience for raw admin rows (notification dispatch): does this
 * administrator hold the given section permission?
 */
export function adminHolds(row, permission) {
  if (!row) return false;
  return roleAllows(accessOf(row), permission);
}
