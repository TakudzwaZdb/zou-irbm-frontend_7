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
  -- Deliberately no scope_type (or anything else scope-related) here — a
  -- role is just a name plus a permission bundle. Organisation scope is a
  -- property of the PERSON, not the role: which Programme/Sub-programme/
  -- Unit (or, for the built-in Employee role only, which individual
  -- employee record) an account is scoped to is picked per person on the
  -- Permissions & Roles page's "Assign role & scope" (see routes/users.js's
  -- PATCH /:id/role), independently of which role they're being given, not
  -- something a role declares or requires up front at POST /org/roles.
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC})
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  -- Nullable: an account created with auth_provider='azure' (see
  -- routes/org.js's POST /employees and routes/auth.js's /azure/callback)
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
  -- comment above POST /employees in routes/org.js for why an Employee
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
  -- Nullable: Programme creation is name-only now (see routes/org.js's
  -- POST /programmes) — a Head is a role appointment made afterwards from
  -- the Permissions & Roles page, not text collected at creation, so a
  -- freshly-created Programme has no head at all until someone is given
  -- that role. Kept, still-nullable, for legacy display of anything
  -- created before this change.
  head TEXT,
  head_user_id INTEGER REFERENCES users(id),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS subs (
  id SERIAL PRIMARY KEY,
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  name TEXT NOT NULL,
  -- Nullable — same rationale as programmes.head above.
  head TEXT,
  unit_label TEXT NOT NULL DEFAULT 'Unit',
  rep_user_id INTEGER REFERENCES users(id),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS units (
  id SERIAL PRIMARY KEY,
  sub_id INTEGER NOT NULL REFERENCES subs(id),
  name TEXT NOT NULL,
  -- Nullable — same rationale as programmes.head above.
  head TEXT,
  kind TEXT NOT NULL DEFAULT 'Unit',
  head_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  -- Nullable: a 'default' role account (see routes/org.js's POST
  -- /employees) is deliberately created with no department/unit —
  -- unit_id stays NULL for the life of that account, and every unit-scoped
  -- query (cascadeSoftDeleteUnit's own lookup, the org tree, "Manage
  -- employees" panels) simply never matches it, which is exactly right:
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
  owner_type TEXT NOT NULL CHECK(owner_type IN ('sub','unit','employee')),
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
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (${NOW_UTC}),
  deleted_at TEXT,
  UNIQUE(kpi_id, employee_id)
);

CREATE TABLE IF NOT EXISTS kpi_contributions (
  id SERIAL PRIMARY KEY,
  kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  value REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved')),
  explanation TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  return_comment TEXT,
  UNIQUE(kpi_id, employee_id, year, month)
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

-- Appointment integrity: Employee accounts may repeat, but every other
-- role may occur only once per organisation scope (partial unique indexes —
-- supported identically in Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS users_unique_active_scoped_appointment
  ON users (role, scope_type, scope_id)
  WHERE deleted_at IS NULL AND role <> 'employee' AND scope_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_unique_active_global_appointment
  ON users (role)
  WHERE deleted_at IS NULL AND role <> 'employee' AND scope_id IS NULL;
`;

const BUILT_IN_ROLES = [
  ['exec', 'Executive'], ['cpu', 'Corporate Planning Unit'],
  ['ictadmin', 'ICT Systems Administrator'], ['rep', 'Sub-programme Rep'],
  ['unithead', 'Unit Head'], ['employee', 'Employee'],
  ['programme', 'Programme Head'], ['council', 'University Council'],
  // Vice Chancellor — its own built-in role (see utils/permissions.js's
  // DEFAULT_PERMS_BY_ROLE for its privileges and seed.js for the seeded
  // account). Built-in like every role above: not deletable as a role type
  // from the Permissions & Roles page, but any account holding it is fully
  // removable/restorable/reassignable/rescopable exactly like an exec, cpu,
  // or council account — nothing here special-cases it.
  ['vc', 'Vice Chancellor'],
  // A bare, scope-less, read-only account — see routes/org.js's POST
  // /employees. Not manually assignable via the ordinary role-change
  // dropdowns (see frontend pages/Users.jsx's ROLES list, which
  // deliberately omits it); the only way an account gets this role is
  // through that specific creation flow.
  ['default', 'Default (Read-only)'],
];

// One-time migration: the 'individual' role/entity was renamed to
// 'employee' across the whole app (table, columns, role/scope_type/
// owner_type values, the four add/create/edit/delete_individuals
// permission keys, and the two partial unique indexes below whose WHERE
// clause names the role). Must run BEFORE SCHEMA_SQL below — SCHEMA_SQL's
// `CREATE TABLE IF NOT EXISTS employees` would otherwise create a second,
// empty table alongside a still-existing old `individuals` table instead of
// recognizing it as already migrated. Every step here is guarded so it's a
// no-op on a database that was created fresh (already has `employees`, no
// `individuals`) or that already ran this migration once.
async function migrateIndividualRoleToEmployee() {
  // Everything below only matters on a database that still has the OLD
  // `individuals` table — a genuinely fresh database (nothing created yet;
  // SCHEMA_SQL runs AFTER this function returns) has none of the tables
  // these UPDATEs touch, and one already migrated has no `individuals`
  // table either. Both cases must be a clean no-op, not an error against
  // tables that don't exist yet.
  const oldTable = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'individuals'");
  if (!oldTable.rowCount) return;

  // Everything from here down runs on ONE dedicated connection, inside a
  // single transaction. Without this, each `pool.query()` call could land
  // on a different pooled connection and commit independently — a crash
  // partway through (this really happened once: the kpis constraint step
  // below used to run before the DROP CONSTRAINT fix) leaves the table
  // already renamed while later steps (role_definitions, the permissions
  // catalog, settings) never ran, and the guard above ("does `individuals`
  // still exist?") then wrongly reports "already migrated" on retry,
  // silently skipping the rest forever. Wrapping in BEGIN/COMMIT with a
  // ROLLBACK on any error means either everything below happens or NONE of
  // it does — including the table rename — so the guard stays a reliable,
  // safe-to-retry signal.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('ALTER TABLE individuals RENAME TO employees');
    const oldCol1 = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'kpi_assignments' AND column_name = 'individual_id'");
    if (oldCol1.rowCount) {
      await client.query('ALTER TABLE kpi_assignments RENAME COLUMN individual_id TO employee_id');
    }
    const oldCol2 = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'kpi_contributions' AND column_name = 'individual_id'");
    if (oldCol2.rowCount) {
      await client.query('ALTER TABLE kpi_contributions RENAME COLUMN individual_id TO employee_id');
    }

    // kpis.owner_type's CHECK constraint named the allowed values inline —
    // Postgres auto-names an unnamed column CHECK '<table>_<column>_check'.
    // Must drop it BEFORE updating owner_type below — the OLD constraint
    // (owner_type IN ('sub','unit','individual')) rejects 'employee'
    // outright, so updating first would fail against the still-old
    // constraint.
    await client.query('ALTER TABLE kpis DROP CONSTRAINT IF EXISTS kpis_owner_type_check');

    // Same reasoning for the two partial unique indexes further down — drop
    // them BEFORE the users.role UPDATE below, not after. Each one's WHERE
    // clause still reads "role <> 'individual'" at this point (its NAME
    // never changed, so SCHEMA_SQL's own CREATE UNIQUE INDEX IF NOT EXISTS
    // won't touch it later either — see the note below). Updating role to
    // 'employee' first would make every migrated row newly fall INSIDE that
    // old exemption's negation and get enforced against the OLD constraint
    // text before SCHEMA_SQL ever gets a chance to recreate it correctly,
    // risking a spurious unique-violation on two Employee accounts that
    // legitimately share one (role, scope_type, scope_id) — e.g. two
    // Employee-role accounts both scoped broadly to the same Unit.
    await client.query('DROP INDEX IF EXISTS users_unique_active_scoped_appointment');
    await client.query('DROP INDEX IF EXISTS users_unique_active_global_appointment');

    // role_definitions.key and permissions.key are PARENT rows that
    // role_permissions/user_permissions reference by foreign key (no ON
    // UPDATE/DELETE CASCADE on either). ensureSchema's own INSERT OR IGNORE
    // seeding loops (see below, right after this function returns) are what
    // normally create the 'employee' role_definitions row and the four new
    // add_employee/create_employees/edit_employees/delete_employees
    // permission rows — but those loops run AFTER this transaction commits.
    // Re-pointing a child row at a key that doesn't exist as a parent row
    // YET would violate the FK constraint immediately (Postgres checks FK
    // constraints per-statement, not deferred, unless declared
    // DEFERRABLE — these aren't). So this migration must create those new
    // parent rows itself, right here, BEFORE repointing anything to them —
    // ON CONFLICT DO NOTHING makes it a harmless no-op on the (impossible
    // today, but cheap to guard) chance ensureSchema's loop already ran.
    // Same values BUILT_IN_ROLES / utils/permissions.js's PERMISSIONS seed
    // under these keys, so nothing changes once those loops run afterward.
    await client.query("INSERT INTO role_definitions (key, label, built_in) VALUES ('employee', 'Employee', 1) ON CONFLICT (key) DO NOTHING");
    await client.query(`
      INSERT INTO permissions (key, label, group_name) VALUES
        ('add_employee', 'Add an Employee (within own scope)', 'Framework'),
        ('create_employees', 'Create Employees', 'Framework'),
        ('edit_employees', 'Edit Employees', 'Framework'),
        ('delete_employees', 'Delete Employees', 'Framework')
      ON CONFLICT (key) DO NOTHING
    `);

    // Data values that used the literal string 'individual' as a role/
    // scope_type/owner_type/role_definitions/role_permissions key. The
    // role_permissions/user_permissions children are repointed at the new
    // parent keys BEFORE their old parent rows are deleted below — and, for
    // role_definitions specifically, BEFORE the old 'individual' row itself
    // is touched at all, since role_permissions.role_key still references
    // it by FK until every one of its rows has been repointed away.
    await client.query("UPDATE users SET role = 'employee' WHERE role = 'individual'");
    await client.query("UPDATE users SET scope_type = 'employee' WHERE scope_type = 'individual'");
    await client.query("UPDATE kpis SET owner_type = 'employee' WHERE owner_type = 'individual'");
    await client.query("UPDATE role_permissions SET role_key = 'employee' WHERE role_key = 'individual'");
    await client.query("DELETE FROM role_definitions WHERE key = 'individual'");
    // settings is a plain key-value table (key TEXT PRIMARY KEY) — the
    // late-submission cutoff setting's key itself named the role.
    await client.query("UPDATE settings SET key = 'lateCutoffEmployee' WHERE key = 'lateCutoffIndividual'");

    // The four permission keys that named the role (add_individual,
    // create/edit/delete_individuals) — repoint every grant to the new key
    // (which now already exists as a permissions row, inserted above)
    // BEFORE dropping the now-orphaned old catalog row, for the same FK
    // reason as role_definitions above.
    const permKeyRename = [
      ['add_individual', 'add_employee'],
      ['create_individuals', 'create_employees'],
      ['edit_individuals', 'edit_employees'],
      ['delete_individuals', 'delete_employees'],
    ];
    for (const [oldKey, newKey] of permKeyRename) {
      // eslint-disable-next-line no-await-in-loop
      await client.query('UPDATE role_permissions SET permission_key = $1 WHERE permission_key = $2', [newKey, oldKey]);
      // eslint-disable-next-line no-await-in-loop
      await client.query('UPDATE user_permissions SET permission_key = $1 WHERE permission_key = $2', [newKey, oldKey]);
      // eslint-disable-next-line no-await-in-loop
      await client.query('DELETE FROM permissions WHERE key = $1', [oldKey]);
    }

    // Re-add the constraint now that every row satisfies it. The two
    // partial unique indexes dropped above get recreated correctly (role <>
    // 'employee') when SCHEMA_SQL runs right after this function returns.
    await client.query("ALTER TABLE kpis ADD CONSTRAINT kpis_owner_type_check CHECK (owner_type IN ('sub','unit','employee'))");

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

let readyPromise = null;
async function ensureSchema() {
  await migrateIndividualRoleToEmployee();
  await pool.query(SCHEMA_SQL);

  // Idempotent widen: employees.unit_id used to be NOT NULL — a 'default'
  // role account (see routes/org.js) is created with no unit at all, so a
  // database created before that feature existed needs this dropped once.
  // A no-op (no error) if it's already nullable.
  await pool.query('ALTER TABLE employees ALTER COLUMN unit_id DROP NOT NULL');

  // Idempotent widen/backfill for the same reason: a database created before
  // Entra ID / auth_provider existed needs password_hash relaxed and the two
  // new columns added once. All four statements are no-ops on a database
  // that already has them (IF NOT EXISTS / already-nullable).
  await pool.query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS azure_oid TEXT');

  // Idempotent widen: programmes/subs/units.head used to be NOT NULL, back
  // when creating one also collected a Head name and auto-provisioned their
  // login account right there. Creation is name-only now — a Head/Rep is a
  // role appointment made afterwards from the Permissions & Roles page (see
  // routes/org.js) — so a database created before this change needs `head`
  // relaxed once. A no-op on a database that already allows NULL there.
  await pool.query('ALTER TABLE programmes ALTER COLUMN head DROP NOT NULL');
  await pool.query('ALTER TABLE subs ALTER COLUMN head DROP NOT NULL');
  await pool.query('ALTER TABLE units ALTER COLUMN head DROP NOT NULL');

  // NOTE: role_definitions briefly had a scope_type column here (a role
  // declaring a required organisation scope up front). That's reversed —
  // scope is a property of the PERSON, assigned per user on PATCH /:id/role
  // (routes/users.js), never something a role itself declares or requires —
  // so nothing here adds that column any more. A database that already ran
  // that migration still has it sitting unused; nothing reads or writes it.

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
