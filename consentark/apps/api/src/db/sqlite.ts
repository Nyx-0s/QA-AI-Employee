import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * SQLite access: one database file inside DATA_DIR, WAL mode for safe
 * concurrent reads during task execution, and numbered migrations applied
 * exactly once (tracked in schema_migrations).
 */

const MIGRATIONS: string[] = [
  // 001 — initial schema
  `
  CREATE TABLE IF NOT EXISTS employees (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    role                  TEXT NOT NULL,
    description           TEXT NOT NULL,
    system_prompt         TEXT NOT NULL,
    backend               TEXT NOT NULL,
    model                 TEXT NOT NULL,
    tools_enabled         TEXT NOT NULL,   -- JSON array
    allowed_domains       TEXT NOT NULL,   -- JSON array
    confirm_before_submit INTEGER NOT NULL, -- 0/1
    max_steps_per_task    INTEGER NOT NULL,
    schedule              TEXT,            -- JSON object or NULL
    status                TEXT NOT NULL,
    created_at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    employee_id   TEXT NOT NULL REFERENCES employees(id),
    type          TEXT NOT NULL,
    objective     TEXT NOT NULL,
    url           TEXT,
    steps         TEXT,             -- JSON array or NULL
    output_schema TEXT,             -- JSON object or NULL
    status        TEXT NOT NULL,
    output        TEXT,             -- JSON or NULL
    plan          TEXT,             -- JSON or NULL
    error         TEXT,             -- JSON or NULL
    screenshots   TEXT NOT NULL,    -- JSON array (paths under DATA_DIR)
    started_at    TEXT,
    finished_at   TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_employee ON tasks(employee_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

  CREATE TABLE IF NOT EXISTS task_logs (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    at      TEXT NOT NULL,
    level   TEXT NOT NULL,
    phase   TEXT NOT NULL,
    message TEXT NOT NULL,
    data    TEXT             -- JSON or NULL
  );

  CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id, seq);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 002 — consent gate: approval state + when the task started waiting (Phase 2)
  `
  ALTER TABLE tasks ADD COLUMN awaiting_approval TEXT;
  ALTER TABLE tasks ADD COLUMN awaiting_at TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_awaiting ON tasks(status, awaiting_at);
  `,

  // 003 — employee-scoped credentials (Phase 4): SHA-256 hashes at rest.
  // The DB never holds a usable token; the plaintext is shown ONCE at hire.
  `
  CREATE TABLE IF NOT EXISTS employee_tokens (
    token_hash  TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_employee_tokens_employee ON employee_tokens(employee_id);
  `,
];

/** Open (creating if needed) the ConsentArk database under dataDir. */
export function openDatabase(dataDir: string): Database.Database {
  const absolute = resolve(dataDir);
  mkdirSync(absolute, { recursive: true });
  const db = new Database(join(absolute, "consentark.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (
      db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: number }>
    ).map((row) => row.id),
  );
  const mark = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );
  MIGRATIONS.forEach((sql, index) => {
    const id = index + 1;
    if (applied.has(id)) return;
    db.transaction(() => {
      db.exec(sql);
      mark.run(id, new Date().toISOString());
    })();
  });
}
