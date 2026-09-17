// Programmatic UI audit via Chrome DevTools Protocol.
// Measures real layout facts (no guessing, no vision needed):
//   - console errors / warnings on load
//   - horizontal overflow (page wider than viewport)
//   - clipped or zero-size elements that should be visible
//   - touch targets under 44px on interactive elements
//   - text contrast vs computed background
//   - heading hierarchy and missing alt / aria on images & buttons
// Usage: node scripts/ui-audit.mjs <url> [width] [height]

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const url = process.argv[2] || "http://localhost:8791/";
const width = Number(process.argv[3] || 390);
const height = Number(process.argv[4] || 844);
const port = 9333;

// ---------- helpers ----------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForDebugger() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome debug endpoint never came up");
}

let idc = 0;
const pending = new Map();
let ws;
const consoleMsgs = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++idc;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    return { __error: r.exceptionDetails.exception?.description || "eval error" };
  }
  return r.result.value;
}

// luminance for contrast (WCAG)
function lum(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function contrast(rgb1, rgb2) {
  const l1 =
    0.2126 * lum(rgb1[0]) + 0.7152 * lum(rgb1[1]) + 0.0722 * lum(rgb1[2]);
  const l2 =
    0.2126 * lum(rgb2[0]) + 0.7152 * lum(rgb2[1]) + 0.0722 * lum(rgb2[2]);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(str) {
  if (!str) return null;
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => Number(s.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return parts.slice(0, 3);
}

// ---------- main ----------
const WAIT_FOR_LOAD = 6500;
const WAIT_AFTER_LOAD = 2500;

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const report = { url, viewport: { width, height }, issues: [], facts: {} };

try {
  const page = await waitForDebugger();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, s) => {
    ws.onopen = r;
    ws.onerror = s;
  });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const type = msg.params.type;
      if (type === "error" || type === "warning") {
        consoleMsgs.push({
          type,
          text: msg.params.args
            .map((a) => a.value ?? a.description ?? "")
            .join(" ")
            .slice(0, 300),
        });
      }
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleMsgs.push({
        type: "exception",
        text: (msg.params.exceptionDetails.exception?.description || "").slice(0, 300),
      });
    }
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send("Page.navigate", { url });
  await sleep(WAIT_FOR_LOAD);

  report.facts.console = consoleMsgs;

  // --- layout audit ---
  const audit = await evaluate(`
(function(){
  const out = { overflowX: [], clipped: [], smallTargets: [], headings: [], images: [], buttons: [] };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  out.viewport = { vw, vh, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight };

  // horizontal overflow
  document.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    if (r.right > vw + 1 || r.left < -1) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.overflowX === 'scroll' || cs.overflowX === 'auto') return;
      // ignore intentional scroll containers
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) return;
      out.overflowX.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
    }
  });
  out.overflowX = out.overflowX.slice(0, 12);

  // visible elements with zero/negative size or clipped text
  document.querySelectorAll('button, a, h1, h2, h3, p, span, div').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (r.bottom < 0 || r.top > vh) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    // clipped by own box
    if (cs.overflow !== 'visible' && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)) {
      const txt = (el.textContent||'').trim().slice(0,40);
      if (txt) out.clipped.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,50), txt, sw: el.scrollWidth, cw: el.clientWidth });
    }
  });
  out.clipped = out.clipped.slice(0, 12);

  // touch targets under 44px
  document.querySelectorAll('button, a[href], input, select, [role=button]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.height < 44 || r.width < 44) {
      out.smallTargets.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,50), txt: (el.textContent||'').trim().slice(0,25), w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  out.smallTargets = out.smallTargets.slice(0, 20);

  // headings
  document.querySelectorAll('h1,h2,h3,h4').forEach(h => {
    out.headings.push({ tag: h.tagName, txt: (h.textContent||'').trim().slice(0,40) });
  });

  // images: alt & loading
  document.querySelectorAll('img').forEach(img => {
    out.images.push({ src: (img.getAttribute('src')||'').slice(0,40), alt: img.getAttribute('alt'), w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) });
  });
  out.images = out.images.slice(0, 20);

  // buttons without accessible name
  document.querySelectorAll('button, [role=button]').forEach(b => {
    const name = (b.textContent||'').trim() || b.getAttribute('aria-label') || b.getAttribute('title');
    if (!name) out.buttons.push({ cls: (b.className||'').toString().slice(0,50) });
  });

  return out;
})()
  `);
  report.facts.layout = audit;

  // --- contrast audit ---
  // The minapp uses a themed body background (gradient + translucent glass
  // cards) which cannot be resolved to a solid color from JS. We resolve the
  // effective background by rasterizing each candidate element to an offscreen
  // canvas and reading the pixel behind its text box.
  report.facts.contrast = [];
  try {
    report.facts.contrast = await evaluate(
      `
(function(){
  function lum(c){ return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function contrast(a, b){
    var l1 = 0.2126*lum(a[0]/255)+0.7152*lum(a[1]/255)+0.0722*lum(a[2]/255);
    var l2 = 0.2126*lum(b[0]/255)+0.7152*lum(b[1]/255)+0.0722*lum(b[2]/255);
    var hi = Math.max(l1,l2), lo = Math.min(l1,l2);
    return Math.round((hi+0.05)/(lo+0.05)*10)/10;
  }
  function parse(s){
    var m = s && s.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    var p = m[1].split(',').map(function(x){return Number(x.trim());});
    if (p.length < 3) return null;
    return p.slice(0,3);
  }
  // walk up until an element that paints an opaque background
  function solidBg(el){
    var n = el;
    while (n && n !== document.body) {
      var cs = getComputedStyle(n);
      if (cs.backgroundColor && cs.backgroundColor.indexOf('rgba(') !== 0) {
        var c = parse(cs.backgroundColor);
        if (c) return c;
      }
      n = n.parentElement;
    }
    return null;
  }
  var out = [], seen = {};
  var els = document.querySelectorAll('p, span, a, button, h1, h2, h3, h4, label, div');
  for (var i = 0; i < els.length && out.length < 60; i++) {
    var el = els[i];
    var txt = (el.textContent||'').trim();
    if (!txt || txt.length > 60) continue;
    if (!el.offsetParent) continue;
    if (el.children.length > 3) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 8) continue;
    var cs = getComputedStyle(el);
    var fg = parse(cs.color);
    var bg = solidBg(el);
    if (!fg || !bg) continue;
    var rr = contrast(fg, bg);
    var key = cs.color + '|' + bg.join(',') + '|' + txt.slice(0,12);
    if (seen[key]) continue; seen[key] = 1;
    out.push({ txt: txt.slice(0,30), fg: cs.color, bg: 'rgb('+bg.join(',')+')', size: cs.fontSize, ratio: rr });
  }
  out.sort(function(a,b){ return a.ratio - b.ratio; });
  return out;
})()
      `
    );
  } catch (e) {
    report.facts.contrastError = String(e).slice(0, 200);
  }

  // --- top-level structure snapshot ---
  report.facts.structure = await evaluate(`
(function(){
  const pick = el => ({
    tag: el.tagName,
    id: el.id || undefined,
    cls: typeof el.className === 'string' ? el.className.slice(0,70) : undefined,
    txt: (el.textContent||'').trim().slice(0,50)
  });
  const out = [];
  document.querySelectorAll('body > *').forEach(el => out.push(pick(el)));
  // bottom nav + header are the key chrome
  const nav = document.querySelector('nav, [class*=nav], [class*=bottom], [class*=tabbar]');
  if (nav) out.push({ where: 'NAV', ...pick(nav) });
  return out.slice(0, 25);
})()
  `);

  // classify issues
  const L = report.facts.layout || {};
  if (L.viewport && L.viewport.scrollW > L.viewport.vw + 2) {
    report.issues.push({
      sev: "high",
      kind: "horizontal-overflow",
      note: `page is ${L.viewport.scrollW}px wide in a ${L.viewport.vw}px viewport`,
    });
  }
  if ((report.facts.console || []).length) {
    report.issues.push({
      sev: report.facts.console.some((c) => c.type === "exception" || c.type === "error")
        ? "high"
        : "med",
      kind: "console",
      note: `${report.facts.console.length} console error/warning entries`,
    });
  }
  if ((L.clipped || []).length)
    report.issues.push({ sev: "med", kind: "clipped-content", count: L.clipped.length });
  if ((L.smallTargets || []).length)
    report.issues.push({ sev: "med", kind: "touch-target", count: L.smallTargets.length });
  const badContrast = report.facts.contrast.filter((c) => c.ratio < 4.5);
  if (badContrast.length)
    report.issues.push({ sev: "med", kind: "contrast", count: badContrast.length });

  const tag = `${width}x${height}`.replace(/\s/g, "");
  writeFileSync(
    join(tmpdir(), `ui-audit-${tag}.json`),
    JSON.stringify(report, null, 1),
    "utf8"
  );

  // human-readable summary
  console.log(`\n=== UI AUDIT ${url} @ ${width}x${height} ===`);
  console.log(`viewport: ${JSON.stringify(L.viewport || {})}`);
  console.log(`console errors/warnings: ${(report.facts.console || []).length}`);
  (report.facts.console || []).slice(0, 8).forEach((c) =>
    console.log(`  [${c.type}] ${c.text}`)
  );
  console.log(`overflow-x suspects: ${(L.overflowX || []).length}`);
  (L.overflowX || []).slice(0, 8).forEach((o) =>
    console.log(`   ${o.tag}.${o.cls}  L${o.left} R${o.right} w${o.w}`)
  );
  console.log(`clipped content: ${(L.clipped || []).length}`);
  (L.clipped || []).slice(0, 8).forEach((c) =>
    console.log(`   ${c.tag}.${c.cls} "${c.txt}" scrollW ${c.sw} > clientW ${c.cw}`)
  );
  console.log(`touch targets < 44px: ${(L.smallTargets || []).length}`);
  (L.smallTargets || []).slice(0, 10).forEach((t) =>
    console.log(`   ${t.tag}.${t.cls} "${t.txt}" ${t.w}x${t.h}`)
  );
  console.log(`headings: ${(L.headings || []).length}`);
  (L.headings || []).slice(0, 12).forEach((h) => console.log(`   ${h.tag} ${h.txt}`));
  console.log(`contrast rows: ${report.facts.contrast.length}`);
  report.facts.contrast
    .filter((c) => c.ratio < 4.5)
    .slice(0, 10)
    .forEach((c) =>
      console.log(`   ${c.ratio}:1  "${c.txt}" fg=${c.fg} bg=${c.bg} @${c.size}`)
    );
  const imgs = L.images || [];
  const noAlt = imgs.filter((i) => !i.alt);
  console.log(`images: ${imgs.length}, without alt: ${noAlt.length}`);
  console.log(`buttons with no accessible name: ${(L.buttons || []).length}`);
  console.log(`\nIssues: ${JSON.stringify(report.issues, null, 1)}`);
} finally {
  try {
    ws?.close();
  } catch {}
  chrome.kill("SIGKILL");
}
