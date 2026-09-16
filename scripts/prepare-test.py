from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path.cwd()
marker = "STORE_V2_TEST_PREPARATION"

def fail(message):
    raise SystemExit("ERROR: " + message)

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        fail(
            f"{label}: expected one matching section, found {count}. "
            "No files were changed."
        )
    return text.replace(old, new, 1)

if not (root / "package.json").exists():
    fail("Run this script from the project root.")

helper = root / "scripts/apply-migrations.mjs"
if not helper.exists():
    fail("Create scripts/apply-migrations.mjs first.")

names = [
    "scripts/setup.mjs",
    "src/worker.js",
    "src/bot.js"
]

original = {}

for name in names:
    path = root / name
    if not path.exists():
        fail("Missing file: " + name)
    original[name] = path.read_text(encoding="utf-8")

installed = [
    marker in original[name]
    for name in names
]

if all(installed):
    print("Test preparation is already installed.")
    raise SystemExit(0)

if any(installed):
    fail(
        "A partial preparation was detected. "
        "Restore the backup before applying again."
    )

updated = dict(original)

# ------------------------------------------------------------
# SETUP: use the recoverable migration runner
# ------------------------------------------------------------

setup = updated["scripts/setup.mjs"]

setup = replace_once(
    setup,
    'import { spawnSync } from "node:child_process";',
    'import { spawnSync } from "node:child_process";\n'
    'import { applyMigrations } from "./apply-migrations.mjs";\n'
    '// ' + marker,
    "Setup import"
)

start_marker = '  const migrationDirectory = path.join(root, "migrations");'
end_marker = '  log("Checking database safety triggers...");'

start = setup.find(start_marker)
end = setup.find(end_marker)

if start == -1 or end == -1 or end <= start:
    fail("The original setup migration loop was not found.")

setup = (
    setup[:start] +
    '  await applyMigrations({\n'
    '    query,\n'
    '    directory: path.join(root, "migrations")\n'
    '  });\n\n' +
    setup[end:]
)

setup = replace_once(
    setup,
    '    "create_notification_deliveries"\n  ];',
    '    "create_notification_deliveries",\n'
    '    "reserve_variant_stock",\n'
    '    "restore_cancelled_variants",\n'
    '    "protect_reserved_product_structure",\n'
    '    "protect_paid_order",\n'
    '    "protect_cancelled_payment",\n'
    '    "advance_variant_low_stock_cycle",\n'
    '    "create_variant_low_stock_notification"\n'
    '  ];',
    "Final safety trigger checks"
)

updated["scripts/setup.mjs"] = setup

# ------------------------------------------------------------
# WORKER: do not expose bank account details on public bootstrap
# ------------------------------------------------------------

worker = updated["src/worker.js"]

worker = replace_once(
    worker,
    "SELECT id, bank_name, holder_name, card_number, label, position FROM bank_cards ",
    "SELECT id FROM bank_cards ",
    "Public bank card data"
)

# The frontend only needs cards.length to offer card transfer.
# Full card details remain available through the private order endpoint.

worker = replace_once(
    worker,
    'console.error("Unhandled Worker error:", error);',
    'console.error("Unhandled Worker operation failed.");',
    "Worker error logging"
)

worker = replace_once(
    worker,
    'console.error("Scheduled maintenance failed:", error);',
    'console.error("Scheduled maintenance failed.");',
    "Scheduled error logging"
)

worker = "// " + marker + "\n" + worker
updated["src/worker.js"] = worker

# ------------------------------------------------------------
# BOT: ensure category callback payloads fit Telegram limits
# ------------------------------------------------------------

bot = updated["src/bot.js"]

old_callback = '`setcat:${ownerKind}:${ownerId}:${category.id}`'
old_none = '`setcat:p:${ownerId}:none`'

if old_callback in bot:
    bot = replace_once(
        bot,
        old_callback,
        '"setcat:" + category.id',
        "Category button payload"
    )
elif '"setcat:" + category.id' not in bot:
    fail("Category callback format was not recognized.")

if old_none in bot:
    bot = replace_once(
        bot,
        old_none,
        '"setcat:none"',
        "Empty category button payload"
    )
elif '"setcat:none"' not in bot:
    fail("Empty category callback format was not recognized.")

if 'action: "categoryPicker"' not in bot:
    bot = replace_once(
        bot,
        "  await getRecord(env, ownerKind, ownerId);",
        '  await getRecord(env, ownerKind, ownerId);\n\n'
        '  await putSession(env, adminId, {\n'
        '    action: "categoryPicker",\n'
        '    ownerKind,\n'
        '    ownerId\n'
        '  });',
        "Category picker session"
    )

bot = "// " + marker + "\n" + bot
updated["src/bot.js"] = bot

# ------------------------------------------------------------
# Back up and validate
# ------------------------------------------------------------

backup = Path(tempfile.mkdtemp(prefix="store-v2-pretest-"))

for name in names:
    destination = backup / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / name, destination)

print("Backup directory:", backup)

try:
    for name, content in updated.items():
        (root / name).write_text(content, encoding="utf-8")

    for name in names + ["scripts/apply-migrations.mjs"]:
        subprocess.run(
            ["node", "--check", name],
            cwd=root,
            check=True
        )

except Exception:
    for name, content in original.items():
        (root / name).write_text(content, encoding="utf-8")

    fail(
        "Validation failed. Original files were restored. "
        "Backup: " + str(backup)
    )

print("")
print("Preparation completed successfully.")
print("No remote database changes were made.")
print("Next: npm run check")