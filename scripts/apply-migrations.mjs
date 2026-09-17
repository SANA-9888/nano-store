import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function normalizeSQL(value) {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
}

function fail(message) {
  throw new Error(message);
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    fail("Unsafe SQL identifier in migration.");
  }

  return '"' + value + '"';
}

async function objectExists(query, type, name) {
  const result = await query(
    "SELECT name FROM sqlite_master WHERE type=? AND name=?",
    [type, name]
  );

  return result.length > 0;
}

async function runRecoverableStatement(query, sql, label) {
  const statement = sql.trim();

  /*
   * ADD COLUMN cannot simply be repeated after a network failure.
   * Inspect the actual schema before deciding whether to execute it.
   *
   * This handles the ADD COLUMN statements used by this project.
   * It does not claim to validate every possible schema constraint.
   */
  const alter = statement.match(
    /^ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z]+)\b/i
  );

  if (alter) {
    const [, table, column, expectedType] = alter;

    const columns = await query(
      "PRAGMA table_info(" + quoteIdentifier(table) + ")"
    );

    if (!columns.length) {
      fail(label + ": target table does not exist: " + table);
    }

    const existing = columns.find(item => item.name === column);

    if (existing) {
      const actualType = String(existing.type || "").toUpperCase();

      if (actualType !== expectedType.toUpperCase()) {
        fail(
          label +
          ": existing column type differs from the migration: " +
          table + "." + column
        );
      }

      console.log(
        "Column already exists; continuing: " + table + "." + column
      );
      return;
    }

    await query(statement);
    return;
  }

  /*
   * The initial V2 migration removes the old empty order_items table.
   * Never silently delete rows from an existing table.
   */
  const dropTable = statement.match(
    /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*;$/i
  );

  if (dropTable) {
    const table = dropTable[1];

    if (!await objectExists(query, "table", table)) {
      console.log("Table already absent; continuing: " + table);
      return;
    }

    const count = await query(
      "SELECT COUNT(*) AS total FROM " + quoteIdentifier(table)
    );

    if (Number(count[0]?.total || 0) > 0) {
      fail(
        label +
        ": refusing to drop a non-empty table: " +
        table +
        ". A data-preserving upgrade is required."
      );
    }

    await query(statement);
    return;
  }

  /*
   * These schema operations are safe to repeat in the initial migrations.
   * A changed applied migration is separately rejected by its checksum.
   */
  const recoverableCreate =
    /^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\b/i
      .test(statement);

  const recoverableDrop =
    /^DROP\s+(?:TRIGGER|INDEX)\s+IF\s+EXISTS\b/i
      .test(statement);

  if (recoverableCreate || recoverableDrop) {
    await query(statement);
    return;
  }

  /*
   * Do not guess how to resume future data-changing migrations.
   * INSERT/UPDATE/DELETE and other complex migrations need an explicit,
   * tested recovery strategy.
   */
  fail(
    label +
    ": this migration operation has no automatic recovery strategy. " +
    "No attempt was made to execute it."
  );
}

export async function applyMigrations({
  query,
  directory = "migrations"
}) {
  await query(`
    CREATE TABLE IF NOT EXISTS store_migrations_v2 (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('running', 'done')),
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS store_migration_steps_v2 (
      migration_name TEXT NOT NULL,
      step_number INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('running', 'done')),
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      PRIMARY KEY(migration_name, step_number)
    );
  `);

  const files = fs.readdirSync(directory)
    .filter(file => /^\d+.*\.sql$/.test(file))
    .sort();

  if (!files.length) {
    fail("No migration files were found.");
  }

  for (const file of files) {
    const sql = normalizeSQL(
      fs.readFileSync(path.join(directory, file), "utf8")
    );

    const fileHash = fingerprint(sql);

    const existing = await query(
      "SELECT * FROM store_migrations_v2 WHERE name=?",
      [file]
    );

    if (existing.length && existing[0].checksum !== fileHash) {
      fail(
        "Migration checksum mismatch: " + file +
        ". Restore the exact original migration file. " +
        "Do not edit an already-started migration."
      );
    }

    if (existing[0]?.state === "done") {
      console.log("Migration already applied: " + file);
      continue;
    }

    /*
     * This migration is an initial-schema conversion, not a production
     * upgrade of an already-used shop.
     */
    if (file === "0002_inventory_payments.sql") {
      if (await objectExists(query, "table", "orders")) {
        const orders = await query(
          "SELECT COUNT(*) AS total FROM orders"
        );

        if (Number(orders[0]?.total || 0) > 0) {
          fail(
            "0002_inventory_payments.sql requires an unused V2 store. " +
            "Existing orders were found. No further steps were applied."
          );
        }
      }
    }

    if (!existing.length) {
      await query(
        "INSERT INTO store_migrations_v2(" +
        "name,checksum,state,started_at" +
        ") VALUES(?,?,'running',?)",
        [file, fileHash, Date.now()]
      );
    }

    const statements = sql
      .split(/^\s*-- statement-breakpoint\s*$/m)
      .map(statement => statement.trim())
      .filter(Boolean);

    for (let index = 0; index < statements.length; index++) {
      const number = index + 1;
      const statement = statements[index];
      const statementHash = fingerprint(statement);
      const label = file + ", statement " + number;

      if (!statement.endsWith(";")) {
        fail(label + ": missing final semicolon.");
      }

      const previous = await query(
        "SELECT * FROM store_migration_steps_v2 " +
        "WHERE migration_name=? AND step_number=?",
        [file, number]
      );

      if (
        previous.length &&
        previous[0].checksum !== statementHash
      ) {
        fail(label + ": statement checksum mismatch.");
      }

      if (previous[0]?.state === "done") {
        console.log(
          "Step already applied: " + file + " " +
          number + "/" + statements.length
        );
        continue;
      }

      if (!previous.length) {
        await query(
          "INSERT INTO store_migration_steps_v2(" +
          "migration_name,step_number,checksum,state,started_at" +
          ") VALUES(?,?,?,'running',?)",
          [file, number, statementHash, Date.now()]
        );
      }

      console.log(
        "Applying " + file + " — statement " +
        number + "/" + statements.length
      );

      try {
        await runRecoverableStatement(query, statement, label);
      } catch (error) {
        console.error("Failed SQL statement:\n" + statement);

        fail(
          "Migration failed: " + label + ". " +
          String(error?.message || "Unknown migration error.")
        );
      }

      await query(
        "UPDATE store_migration_steps_v2 " +
        "SET state='done',completed_at=? " +
        "WHERE migration_name=? AND step_number=?",
        [Date.now(), file, number]
      );
    }

    await query(
      "UPDATE store_migrations_v2 " +
      "SET state='done',completed_at=? WHERE name=?",
      [Date.now(), file]
    );

    console.log("Migration completed: " + file);
  }
}