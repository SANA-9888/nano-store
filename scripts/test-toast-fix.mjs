// Extract the real storefront HTML from src/storefront.js and syntax-check its inline script.
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
<<<<<<< HEAD
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import storefront from "../src/storefront.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "_test");
mkdirSync(outDir, { recursive: true });

const html = storefront;
writeFileSync(join(outDir, "storefront.html"), html, "utf8");
=======
import storefront from "../src/storefront.js";

const outDir = new URL("./_test/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const html = storefront;
writeFileSync(outDir + "storefront.html", html, "utf8");
>>>>>>> 09dde4a7b23f42fb789f088d2e1bc94f9d18eecf
console.log("HTML written:", html.length, "chars");

// Basic sanity assertions on the fixes
const checks = [
  ['popover="manual" in toast markup', html.includes('<div id="toast" popover="manual"')],
  ["showPopover guard present", html.includes("typeof element.showPopover === \"function\"")],
  ["hideToast helper present", html.includes("function hideToast()")],
  ["success type on cart toast", html.includes('در دسترس نیست.", "success")')],
  ["toast-in keyframes present", html.includes("@keyframes toast-in")],
  ["success style present", html.includes("#toast.success::before")],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log((ok ? "PASS" : "FAIL") + " - " + label);
  if (!ok) failed++;
}

// Syntax-check the inline page script (between <script> and </script>)
const start = html.indexOf("<script>") + "<script>".length;
const end = html.lastIndexOf("</script>");
const js = html.slice(start, end);
<<<<<<< HEAD
writeFileSync(join(outDir, "inline-script.js"), js, "utf8");
try {
  execFileSync(process.execPath, ["--check", join(outDir, "inline-script.js")], { stdio: "pipe" });
=======
writeFileSync(outDir + "inline-script.js", js, "utf8");
try {
  execFileSync(process.execPath, ["--check", outDir + "inline-script.js"], { stdio: "pipe" });
>>>>>>> 09dde4a7b23f42fb789f088d2e1bc94f9d18eecf
  console.log("PASS - inline page script parses cleanly (node --check)");
} catch (error) {
  failed++;
  console.log("FAIL - inline script syntax error:\n" + error.stderr.toString());
}

process.exit(failed ? 1 : 0);
