import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const requiredFiles = [
  "src/defaults.js",
  "src/db.js",
  "src/telegram.js",
  "src/bot.js",
  "src/orders.js",
  "src/media.js",
  "src/worker.js",
  "src/storefront.js",
  "migrations/0001_initial.sql"
];

function fail(message) {
  console.error("Check failed: " + message);
  process.exit(1);
}

const major = Number(process.versions.node.split(".")[0]);

if (major < 22) {
  fail("Node.js 22 or newer is required.");
}

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    fail("Missing required file: " + file);
  }
}

function collectJavaScript(directory) {
  const found = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true
  })) {
    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...collectJavaScript(file));
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      found.push(file);
    }
  }

  return found;
}

const files = [
  ...collectJavaScript("src"),
  ...collectJavaScript("scripts")
];

for (const file of files) {
  const result = spawnSync(
    process.execPath,
    ["--check", file],
    { stdio: "inherit" }
  );

  if (result.status !== 0) {
    fail("Invalid JavaScript syntax: " + file);
  }
}

console.log("Project JavaScript syntax is valid.");

const storefrontModule = await import(
  pathToFileURL(path.resolve("src/storefront.js")).href
);

const html = storefrontModule.default;

if (typeof html !== "string") {
  fail("src/storefront.js must export an HTML string as default.");
}

const scripts = [
  ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)
].filter(match => {
  return !/\bsrc\s*=/i.test(match[1]) &&
    !/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1]);
});

if (!scripts.length) {
  fail("No embedded storefront JavaScript was found.");
}

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "store-check-")
);

try {
  for (let index = 0; index < scripts.length; index++) {
    const attributes = scripts[index][1];
    const content = scripts[index][2];

    const isModule = /\btype\s*=\s*["']module["']/i.test(attributes);

    const temporaryFile = path.join(
      temporaryDirectory,
      "inline-" + index + (isModule ? ".mjs" : ".cjs")
    );

    fs.writeFileSync(temporaryFile, content);

    const result = spawnSync(
      process.execPath,
      ["--check", temporaryFile],
      { stdio: "inherit" }
    );

    if (result.status !== 0) {
      fail("Invalid embedded storefront JavaScript.");
    }
  }
} finally {
  fs.rmSync(temporaryDirectory, {
    recursive: true,
    force: true
  });
}

const migrationFiles = fs.readdirSync("migrations")
  .filter(file => /^\d+.*\.sql$/.test(file))
  .sort();

for (const file of migrationFiles) {
  const sql = fs.readFileSync(
    path.join("migrations", file),
    "utf8"
  );

  const statements = sql
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map(statement => statement.trim())
    .filter(Boolean);

  if (!statements.length) {
    fail("Empty migration: " + file);
  }

  for (let index = 0; index < statements.length; index++) {
    if (!statements[index].endsWith(";")) {
      fail(
        file +
        ": statement " +
        (index + 1) +
        " must end with a semicolon."
      );
    }
  }
}

console.log("Embedded storefront JavaScript syntax is valid.");
console.log("Migration file boundaries are valid.");
console.log(
  "Checks completed. Runtime and database integration tests are still required."
);