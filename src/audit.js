// ============================================================
// Persian Store V2 — Administrator activity audit log.
// Used by the Telegram bot and the admin Mini App to record who
// changed which product or touched which order (anti-abuse).
// Never throws: logging must not break the main flow.
// ============================================================

import { execute } from "./db.js";

export const AUDIT_SECTIONS = {
  catalog: "محصولات و محتوا",
  orders: "سفارش‌ها"
};

export async function logAdminAction(env, adminId, section, action, target = "", detail = "") {
  try {
    if (!env?.DB || !adminId || !action) return;

    await execute(
      env,
      "INSERT INTO admin_logs(admin_id,section,action,target,detail,created_at) " +
      "VALUES(?,?,?,?,?,?)",
      [
        String(adminId).slice(0, 32),
        section === "orders" ? "orders" : "catalog",
        String(action).slice(0, 120),
        String(target || "").slice(0, 200),
        String(detail || "").slice(0, 300),
        Date.now()
      ]
    );
  } catch {
    // Audit logging is best-effort by design.
  }
}
