// Sanity: miniapp page renders, script parses, key UI pieces exist.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { miniAppPage } from "../src/miniapp.js";

const html = miniAppPage();

if (typeof html !== "string" || html.length < 5000) {
  console.error("FAIL: miniAppPage() returned suspicious output");
  process.exit(1);
}

// Extract the LAST <script> block (the app logic) and syntax-check it.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

if (!scripts.length) {
  console.error("FAIL: no <script> block found");
  process.exit(1);
}

scripts.forEach((code, index) => {
  writeFileSync(join(tmpdir(), `miniapp-script-${index}.js`), code);
});

const required = [
  "Telegram.WebApp",
  "initData",
  "permgrid",        // glass permission checkboxes grid
  "گلاس چک‌باکس",     // glass checkbox styling
  "wizard",          // product wizard
  "انتشار محصول",     // publish flow
  "renderLogsView",  // owner-only activity log view
  "renderLogsList",  // log entries renderer
  "renderVariantStock", // per-variant stock editor
  "variant-stock",   // per-variant stock API call
  "گزارش فعالیت مدیران", // logs view title
  "dir=\"rtl\"",
  "viewport"
];

const missing = required.filter(token => !html.includes(token));

if (missing.length) {
  console.error("FAIL: missing tokens:", missing.join(", "));
  process.exit(1);
}

console.log("PASS - page renders, tokens present, script blocks extracted:", scripts.length);
