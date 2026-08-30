// Real, persistent SQLite database (file on disk) — not in-memory, not mocked.
// Survives server restarts. Swap this module for pg/mysql2 later without
// touching route logic much, since all access goes through this one module.
//
// Uses Node's built-in node:sqlite (no native addon to compile) instead of
// better-sqlite3, so `npm install` never needs a C++ toolchain — this is
// what used to fail on machines without build tools / without a prebuilt
// binary for the local Node version. Requires Node.js 22.5+ (see README).
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'zou.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// better-sqlite3-style transaction helper, since the rest of the codebase
// (see seed.js) uses `const txn = db.transaction(fn); txn();`.
db.transaction = function transaction(fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    }
  };
};

db.exec(`
CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  group_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('exec','cpu','ictadmin','rep','unithead','individual')),
  scope_type TEXT CHECK(scope_type IN ('sub','unit','individual') OR scope_type IS NULL),
  scope_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS programmes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  head TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  programme_id INTEGER NOT NULL REFERENCES programmes(id),
  name TEXT NOT NULL,
  head TEXT NOT NULL,
  unit_label TEXT NOT NULL DEFAULT 'Unit',
  rep_user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_id INTEGER NOT NULL REFERENCES subs(id),
  name TEXT NOT NULL,
  head TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Unit',
  head_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS individuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS kpis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('sub','unit','individual')),
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  measure TEXT NOT NULL,
  baseline REAL NOT NULL,
  target REAL NOT NULL,
  is_automated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  value REAL,
  override_value REAL,
  override_note TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved')),
  explanation TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  return_comment TEXT,
  UNIQUE(kpi_id, year, month)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
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

-- The annual planning & budget cycle — a real submission/approval cascade
-- like kpi_values, but for a Unit/Department/Faculty/Region's next-cycle
-- plan proposal (narrative + a requested budget figure). A Sub-programme's
-- and Programme's own rows never carry their own budget number — their
-- budget is always DERIVED (summed) from the real, entered figures of the
-- units beneath them; see routes/plans.js. owner_id is NULL only for the
-- single 'university' row per cycle_year (the compiled annual plan CPU
-- submits once every Programme is in).
CREATE TABLE IF NOT EXISTS plan_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- A real, persisted queue of structural-change proposals (e.g. "split this
-- Sub-programme in two") — distinct from the immediate, direct org-unit
-- creation in POST /org/units. Nothing currently auto-actions an entry here
-- (there's no approval workflow wired to it, same as the reference
-- prototype this mirrors); it's a durable record of what's been proposed
-- and by whom, for CPU/exec to review manually.
CREATE TABLE IF NOT EXISTS structural_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK(scope IN ('programme','sub')),
  text TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Delegates day-to-day data entry on ONE Unit-owned KPI to a specific
-- Individual within that unit — "this is one of your duties" — without
-- changing who owns or approves the KPI: the Unit remains the owner of
-- record and the Sub-programme Rep still approves it (see routes/kpis.js's
-- isOwner/isApprover), only who's allowed to enter and submit the monthly
-- value for it widens to include the assignee. Only a Unit Head may create
-- or remove an assignment, and only for KPIs their own unit owns.
CREATE TABLE IF NOT EXISTS kpi_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  individual_id INTEGER NOT NULL REFERENCES individuals(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kpi_id, individual_id)
);

-- Each assignee's OWN monthly figure toward a shared Unit-owned KPI — e.g.
-- three advisors each assigned "Students Mentored", each filing their own
-- count. This is deliberately a separate table from kpi_values, not a
-- second writer racing to overwrite the same row: every assignee gets their
-- own row, their own draft/submitted/approved lifecycle, and their own
-- Unit Head review, exactly like a normal KPI submission but scoped one
-- level down. Approved contributions are summed automatically into the
-- Unit's own kpi_values row (see routes/kpis.js's recomputeUnitTotal) —
-- that sum is what the Unit Head then reviews and submits onward to the
-- Sub-programme Rep, same as any other Unit KPI. A KPI with no assignees
-- never touches this table at all; nothing changes for it.
CREATE TABLE IF NOT EXISTS kpi_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
`);

// Migration: databases created before the profile-photo feature won't have
// this column yet — CREATE TABLE IF NOT EXISTS above only applies to a
// brand-new file, so add it here if it's missing from an existing one.
// Stored as a data: URL (base64), the same "actually persisted, actually
// served back" approach as everything else in this app — no external file
// storage to configure for a reference implementation.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('avatar')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
}

// Migration: allow 'programme' as a role/scope_type (Programme Head feature —
// a real account tier that oversees one whole Programme). SQLite CHECK
// constraints can't be altered with ALTER TABLE, so an existing database
// (whose users table was created before this feature) needs a rebuild:
// create the table with the widened CHECK, copy every row across unchanged,
// swap it in. Detected by looking at the stored CREATE TABLE text itself,
// so this only ever runs once per database.
const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
if (!usersSql.includes("'programme'")) {
  console.log('Migrating users table to allow role/scope_type = "programme"...');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('exec','cpu','ictadmin','rep','unithead','individual','programme')),
      scope_type TEXT CHECK(scope_type IN ('sub','unit','individual','programme') OR scope_type IS NULL),
      scope_id INTEGER,
      avatar TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_new (id, name, title, email, password_hash, role, scope_type, scope_id, avatar, created_at)
      SELECT id, name, title, email, password_hash, role, scope_type, scope_id, avatar, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

// Migration: a Programme's own account holder (the Programme Head login),
// mirroring units.head_user_id / subs.rep_user_id — display-only, just like
// those two (see lib/scope.js's own scope-based ownership checks, which
// never trust these reference columns for authorization).
const programmeColumns = db.prepare('PRAGMA table_info(programmes)').all().map((c) => c.name);
if (!programmeColumns.includes('head_user_id')) {
  db.exec('ALTER TABLE programmes ADD COLUMN head_user_id INTEGER REFERENCES users(id)');
}

// Internal messaging — a real, persisted communication channel that works
// across every tier (Individual <-> Unit Head <-> Sub Rep <-> Programme
// Head <-> CPU <-> Exec <-> ICT Admin), not simulated: genuine rows, genuine
// read/unread state, genuine recipients resolved from the same users table
// everything else in the app uses. There's no outbound SMTP/email-delivery
// service configured for this reference deployment (same reasoning as the
// admin-assisted password reset in routes/users.js), so this is the actual,
// working "email system" — an in-app inbox addressed by each account's real
// @zou.ac.zw email — rather than a fake "sent!" toast with nowhere for a
// real email to go.
db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  read_at TEXT,
  UNIQUE(message_id, recipient_id)
);
`);

// Migration: per-participant message deletion — like real email, deleting a
// message only ever removes YOUR OWN copy of it, never the other side's.
// `messages.sender_deleted_at` is the sender clearing it from their own
// Sent; `message_recipients.deleted_at` is one specific recipient clearing
// it from their own Inbox — the same message can be gone from the sender's
// Sent while still sitting, unread or read, in three other people's
// Inboxes. See routes/messages.js's DELETE /:id for the actual purge logic
// (a message is only ever hard-deleted once every participant — sender AND
// every recipient — has cleared their own copy).
const messageColumns = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
if (!messageColumns.includes('sender_deleted_at')) {
  db.exec('ALTER TABLE messages ADD COLUMN sender_deleted_at TEXT');
}
const recipientColumns = db.prepare('PRAGMA table_info(message_recipients)').all().map((c) => c.name);
if (!recipientColumns.includes('deleted_at')) {
  db.exec('ALTER TABLE message_recipients ADD COLUMN deleted_at TEXT');
}

// A purely personal display preference: any signed-in person, at any tier,
// can mark a KPI they see in an exploratory/browsing view (Overview's
// drill-down) as not relevant to them, decluttering their OWN view of it
// going forward — this
// never touches the KPI itself, never affects what any other person sees,
// and is never consulted by an accountability list (My Data Entry's own
// owned/assigned KPIs, Approvals Queue's pending items): those always show
// in full regardless of this table, so hiding something can never be used
// to dodge a real duty. See routes/kpis.js's GET/POST/DELETE /hidden.
db.exec(`
CREATE TABLE IF NOT EXISTS kpi_hidden (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kpi_id INTEGER NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  hidden_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, kpi_id)
);
`);

// A KPI "template" — created once against a Unit rather than one named
// person, so whoever creates KPIs doesn't have to make an identical
// owner_type='individual' KPI per staff member. Anyone in that Unit can
// then pick it up for themselves (see routes/kpiTemplates.js's POST
// :id/pick), which INSTANTIATES their own real, independent kpis row
// (owner_type='individual', owner_id=their own individuals.id) — not a
// shared/summed figure like a Unit-owned KPI's contributors. This is what
// replaced individual self-claim of Unit-owned KPIs: an Individual now only
// ever sees KPIs genuinely created for individuals (this pool, scoped to
// their own unit) rather than being offered their whole Unit's own
// aggregate KPI to volunteer into.
db.exec(`
CREATE TABLE IF NOT EXISTS kpi_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  measure TEXT NOT NULL,
  baseline REAL NOT NULL,
  target REAL NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Links a real, live individual-owned KPI (kpis.id) back to the template it
// was picked from, if any — lets the template's creator see real adoption
// ("3 of 8 in this unit have picked this up") and lets the pick route check
// "have I already picked this one" without a separate join table. Nullable
// and ON DELETE SET NULL: deleting the template later never deletes anyone's
// already-instantiated personal KPI, it just detaches the link.
const kpiColumns = db.prepare('PRAGMA table_info(kpis)').all().map((c) => c.name);
if (!kpiColumns.includes('template_id')) {
  db.exec('ALTER TABLE kpis ADD COLUMN template_id INTEGER REFERENCES kpi_templates(id) ON DELETE SET NULL');
}

// Automated cumulative performance: what a submitter actually typed for
// ONE period — this period's own contribution on its own, never a running
// total — kept separate from kpi_values.value, which stays "the official
// cumulative total as of this period" exactly as every existing reader
// (RAG, the monthly pace tracker, Reports, the Annual Plan PDF, variance)
// already expects it to mean. See routes/kpis.js's previousOfficialValue /
// POST :id/approve: the moment a period is approved, value is recomputed
// as the previous period's own official value (or the KPI's baseline, for
// the very first one ever) PLUS this period's entered_value — so nobody
// has to remember or re-type a running total by hand, and nothing counts
// as official until an approver has actually signed off on it.
const kpiValueColumns = db.prepare('PRAGMA table_info(kpi_values)').all().map((c) => c.name);
if (!kpiValueColumns.includes('entered_value')) {
  db.exec('ALTER TABLE kpi_values ADD COLUMN entered_value REAL');
}

module.exports = db;
