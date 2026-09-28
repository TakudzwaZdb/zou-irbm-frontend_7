// Real, persistent PostgreSQL database — replaces the earlier node:sqlite
// (DatabaseSync) implementation so this app can run against a managed
// database (e.g. Azure Database for PostgreSQL Flexible Server) instead of
// a single file on local disk. Route files were written against
// better-sqlite3/node:sqlite's synchronous `db.prepare(sql).get/all/run(...)`
// shape, so this module reproduces that SAME shape — `.prepare()`, `.exec()`,
// `.transaction()` — but every call now returns a Promise (Postgres access
// is inherently async), which is why every route handler that touches the
// database is `async` and every db call is `await`ed.
//
// Connection: reads standard PG* env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/
// PGDATABASE) or a single DATABASE_URL, whichever is set — see README/
// AZURE_SETUP.md for exact values for local Postgres vs. Azure. Azure
// Database for PostgreSQL Flexible Server requires TLS; set DB_SSL=true
// (or include sslmode=require in DATABASE_URL) to enable it — local
// Postgres needs neither.
require('dotenv').config();
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');

const useSsl = process.env.DB_SSL === 'true'
  || /sslmode=require/.test(process.env.DATABASE_URL || '');

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
    host: process.env.PGHOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.PGDATABASE || process.env.DB_NAME || 'zou_irbm',
  };
if (useSsl) {
  // rejectUnauthorized: false keeps this working out of the box against
  // Azure's managed cert chain without bundling Azure's root CA — tighten
  // this (ca: fs.readFileSync(...)) if your org's policy requires full
  // chain verification. See AZURE_SETUP.md.
  poolConfig.ssl = { rejectUnauthorized: false };
}
poolConfig.max = Number(process.env.DB_POOL_MAX || 5);

const pool = new Pool(poolConfig);
pool.on('error', (err) => {
  // A connection sitting idle in the pool can be dropped by the server
  // (Azure Flexible Server recycles idle connections) — that must not
  // crash the process; the pool transparently opens a new one on next use.
  console.error('Postgres pool idle-client error (recovering):', err.message);
});

// Carries "the client for the currently-open transaction" across the whole
// async call chain started inside db.transaction()'s callback, so nested
// db.prepare(...).run() calls made from within it hit the SAME connection
// (and therefore the same transaction) instead of grabbing an unrelated
// connection from the pool — required for BEGIN/COMMIT/ROLLBACK to mean
// anything.
const als = new AsyncLocalStorage();
function currentExecutor() {
  return als.getStore() || pool;
}

// ---- SQLite -> Postgres SQL translation --------------------------------
// Route files keep their original SQL text (positional `?` placeholders,
// SQLite's `datetime('now')`, `INSERT OR IGNORE`) — translating it here
// means the 400+ call sites across routes/*.js only need `await` + `async`,
// not a rewrite of every SQL string.
const NOW_UTC = "to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')";
// Tables whose primary key is not a single auto-incrementing `id` column —
// `.run()` must not try to append `RETURNING id` for inserts into these.
const NO_ID_TABLES = new Set(['permissions', 'role_definitions', 'user_permissions', 'role_permissions', 'settings']);

const sqlCache = new Map();
function translate(sql) {
  let cached = sqlCache.get(sql);
  if (cached) return cached;

  let out = sql;
  const isInsertOrIgnore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(out);
  if (isInsertOrIgnore) {
    out = out.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
  }
  out = out.replace(/datetime\(\s*'now'\s*\)/gi, NOW_UTC);
  let paramIndex = 0;
  out = out.replace(/\?/g, () => `$${++paramIndex}`);
  if (isInsertOrIgnore) {
    out = `${out.replace(/;\s*$/, '')} ON CONFLICT DO NOTHING`;
  }

  const tableMatch = /^\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(sql);
  const insertTable = tableMatch ? tableMatch[1] : null;
  const canReturnId = insertTable && !NO_ID_TABLES.has(insertTable) && !/\bRETURNING\b/i.test(out);

  cached = { pgSql: out, canReturnId };
  sqlCache.set(sql, cached);
  return cached;
}

function cleanParams(params) {
  return params.map((p) => (p === undefined ? null : p));
}

function prepare(sql) {
  const { pgSql, canReturnId } = translate(sql);
  const runSql = canReturnId ? `${pgSql.replace(/;\s*$/, '')} RETURNING id` : pgSql;

  return {
    async get(...params) {
      const res = await currentExecutor().query(pgSql, cleanParams(params));
      return res.rows[0];
    },
    async all(...params) {
      const res = await currentExecutor().query(pgSql, cleanParams(params));
      return res.rows;
    },
    async run(...params) {
      const res = await currentExecutor().query(runSql, cleanParams(params));
      return {
        changes: res.rowCount,
        lastInsertRowid: res.rows && res.rows[0] ? res.rows[0].id : undefined,
      };
    },
  };
}

// Raw multi-statement / no-params execution — node-postgres's simple query
// protocol (used automatically when a query has no parameters) runs a
// semicolon-separated batch of statements in one round trip, same as
// better-sqlite3's db.exec().
async function exec(sql) {
  const { pgSql } = translate(sql);
  return currentExecutor().query(pgSql);
}

// better-sqlite3-style transaction helper (see seed.js: `const txn =
// db.transaction(fn); await txn();`). Opens one real client for the whole
// transaction and publishes it via AsyncLocalStorage so every db call made
// from inside `fn` — however deeply nested — runs on that same connection.
function transaction(fn) {
  return async function transactionWrapper(...args) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await als.run(client, () => fn(...args));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection already broken */ }
      throw err;
    } finally {
      client.release();
    }
  };
}

// ---- Schema (final current-state shape — no migration history to replay,
// since this is a fresh target database) --------------------------------
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  group_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_definitions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC})
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  -- Nullable: an account created with auth_provider='azure' (see
  -- routes/org.js's POST /individuals and routes/auth.js's /azure/callback)
  -- has no password at all — it signs in exclusively through Microsoft
  -- Entra ID, matched on this row's email. Every other account keeps a
  -- real bcrypt hash here, same as before.
  password_hash TEXT,
  role TEXT NOT NULL,
  scope_type TEXT,
  scope_id INTEGER,
  avatar TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  overview_limit TEXT,
  is_executive_owner INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  -- 'local' = signs in with the password above (routes/auth.js's POST
  -- /login). 'azure' = no password is ever set for this account; it signs
  -- in only via Microsoft Entra ID (POST /auth/azure/login ->
  -- /auth/azure/callback), matched to this row by email (and, after a
  -- first successful sign-in, by azure_oid below too). See the big
  -- comment above POST /individuals in routes/org.js for why an Individual
  -- account is always provisioned this way now.
  auth_provider TEXT NOT NULL DEFAULT 'local',
  -- Microsoft's stable per-account identifier (the 'oid' claim from Entra
  -- ID's id_token) for an auth_provider='azure' row — recorded on that
  -- account's first successful Microsoft sign-in so later sign-ins can be
  -- matched even if the person's email address is later changed in Entra
  -- ID. NULL until then; unused for auth_provider='local' rows.
  azure_oid TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key TEXT NOT NULL REFERENCES role_definitions(key) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS programmes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  head TEXT NOT NULL,
  head_user_id INTEGER REFERENCES users(id),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS subs (
  id SERIAL PRIMARY KEY,
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  name TEXT NOT NULL,
  head TEXT NOT NULL,
  unit_label TEXT NOT NULL DEFAULT 'Unit',
  rep_user_id INTEGER REFERENCES users(id),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS units (
  id SERIAL PRIMARY KEY,
  sub_id INTEGER NOT NULL REFERENCES subs(id),
  name TEXT NOT NULL,
  head TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Unit',
  head_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS individuals (
  id SERIAL PRIMARY KEY,
  -- Nullable: a 'default' role account (see routes/org.js's POST
  -- /individuals) is deliberately created with no department/unit —
  -- unit_id stays NULL for the life of that account, and every unit-scoped
  -- query (cascadeSoftDeleteUnit's own lookup, the org tree, "Manage
  -- individuals" panels) simply never matches it, which is exactly right:
  -- it isn't part of any unit's structure.
  unit_id INTEGER REFERENCES units(id),
  name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS kpi_templates (
  id SERIAL PRIMARY KEY,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  measure TEXT NOT NULL,
  baseline REAL NOT NULL,
  target REAL NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS kpis (
  id SERIAL PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('sub','unit','individual')),
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  measure TEXT NOT NULL,
  baseline REAL NOT NULL,
  target REAL NOT NULL,
  is_automated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  template_id INTEGER REFERENCES kpi_templates(id) ON DELETE SET NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS kpi_values (
  id SERIAL PRIMARY KEY,
  kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  value REAL,
  override_value REAL,
  override_note TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','programme_approved','approved')),
  explanation TEXT,
  entered_value REAL,
  submitted_at TEXT,
  programme_approved_at TEXT,
  approved_at TEXT,
  return_comment TEXT,
  override_cleared_value REAL,
  override_cleared_note TEXT,
  override_cleared_at TEXT,
  UNIQUE(kpi_id, year, month)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (${NOW_UTC}),
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_proposals (
  id SERIAL PRIMARY KEY,
  cycle_year INTEGER NOT NULL,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('unit','sub','programme','university')),
  owner_id INTEGER,
  narrative TEXT,
  budget REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved')),
  submitted_at TEXT,
  approved_at TEXT,
  return_comment TEXT
);

CREATE TABLE IF NOT EXISTS structural_proposals (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('programme','sub')),
  text TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC})
);

CREATE TABLE IF NOT EXISTS kpi_assignments (
  id SERIAL PRIMARY KEY,
  kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  individual_id INTEGER NOT NULL REFERENCES individuals(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  deleted_at TEXT,
  UNIQUE(kpi_id, individual_id)
);

CREATE TABLE IF NOT EXISTS kpi_contributions (
  id SERIAL PRIMARY KEY,
  kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  individual_id INTEGER NOT NULL REFERENCES individuals(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  value REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved')),
  explanation TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  return_comment TEXT,
  UNIQUE(kpi_id, individual_id, year, month)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  sender_deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS message_recipients (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  read_at TEXT,
  deleted_at TEXT,
  UNIQUE(message_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS kpi_hidden (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  hidden_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  UNIQUE(user_id, kpi_id)
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_kpi_values_period ON kpi_values(year, month);
CREATE INDEX IF NOT EXISTS idx_kpi_contributions_period ON kpi_contributions(year, month);
CREATE INDEX IF NOT EXISTS idx_message_recipients_recipient ON message_recipients(recipient_id);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user ON mfa_recovery_codes(user_id);

-- Appointment integrity: Individual accounts may repeat, but every other
-- role may occur only once per organisation scope (partial unique indexes —
-- supported identically in Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS users_unique_active_scoped_appointment
  ON users (role, scope_type, scope_id)
  WHERE deleted_at IS NULL AND role <> 'individual' AND scope_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_unique_active_global_appointment
  ON users (role)
  WHERE deleted_at IS NULL AND role <> 'individual' AND scope_id IS NULL;
`;

const BUILT_IN_ROLES = [
  ['exec', 'Executive'], ['cpu', 'Corporate Planning Unit'],
  ['ictadmin', 'ICT Systems Administrator'], ['rep', 'Sub-programme Rep'],
  ['unithead', 'Unit Head'], ['individual', 'Individual'],
  ['programme', 'Programme Head'], ['council', 'University Council'],
  // A bare, scope-less, read-only account — see routes/org.js's POST
  // /individuals. Not manually assignable via the ordinary role-change
  // dropdowns (see frontend pages/Users.jsx's ROLES list, which
  // deliberately omits it); the only way an account gets this role is
  // through that specific creation flow.
  ['default', 'Default (Read-only)'],
];

let readyPromise = null;
async function ensureSchema() {
  await pool.query(SCHEMA_SQL);

  // Idempotent widen: individuals.unit_id used to be NOT NULL — a 'default'
  // role account (see routes/org.js) is created with no unit at all, so a
  // database created before that feature existed needs this dropped once.
  // A no-op (no error) if it's already nullable.
  await pool.query('ALTER TABLE individuals ALTER COLUMN unit_id DROP NOT NULL');

  // Idempotent widen/backfill for the same reason: a database created before
  // Entra ID / auth_provider existed needs password_hash relaxed and the two
  // new columns added once. All four statements are no-ops on a database
  // that already has them (IF NOT EXISTS / already-nullable).
  await pool.query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS azure_oid TEXT');

  const insertRole = prepare('INSERT OR IGNORE INTO role_definitions (key, label, built_in) VALUES (?, ?, 1)');
  for (const [key, label] of BUILT_IN_ROLES) {
    // eslint-disable-next-line no-await-in-loop
    await insertRole.run(key, label);
  }

  // Keep the `permissions` catalog and each built-in role's default grants
  // in sync with utils/permissions.js — idempotent, safe to run on every
  // process start (mirrors what the old SQLite db.js did unconditionally).
  const { PERMISSIONS, defaultPermsForRole } = require('./utils/permissions');
  const insertPerm = prepare('INSERT OR IGNORE INTO permissions (key, label, group_name) VALUES (?, ?, ?)');
  for (const p of PERMISSIONS) {
    // eslint-disable-next-line no-await-in-loop
    await insertPerm.run(p.key, p.label, p.group);
  }
  const insertRolePerm = prepare('INSERT OR IGNORE INTO role_permissions (role_key, permission_key) VALUES (?, ?)');
  for (const [roleKey] of BUILT_IN_ROLES) {
    // eslint-disable-next-line no-await-in-loop
    for (const permKey of defaultPermsForRole(roleKey)) {
      // eslint-disable-next-line no-await-in-loop
      await insertRolePerm.run(roleKey, permKey);
    }
  }
}

// Call (and await) once before serving traffic — see server.js. Memoized so
// every module that requires('./db') and calls ready() shares the same
// in-flight/completed schema setup rather than racing separate CREATE
// TABLE statements (CREATE TABLE IF NOT EXISTS is idempotent regardless,
// but this avoids redundant round-trips).
function ready() {
  if (!readyPromise) readyPromise = ensureSchema();
  return readyPromise;
}

async function close() {
  await pool.end();
}

module.exports = { prepare, exec, transaction, ready, close, pool };
