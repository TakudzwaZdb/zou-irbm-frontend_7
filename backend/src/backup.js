// Real, restorable SQLite backups of the live database — safe to run while
// the server is up and serving writes.
//
// Why VACUUM INTO rather than `cp`/`fs.copyFile`: the live DB runs in WAL
// mode (see db.js), which means the file on disk at any instant can be
// missing recently-committed data still sitting in the -wal side file, or —
// worse — mid-write, torn. A plain file copy of *just* zou.db, taken while
// the server is running, is not a reliable snapshot. `VACUUM INTO` is
// SQLite's own online-backup primitive: it opens a read transaction against
// the live database and streams a complete, consistent, single-file copy to
// a new path, without blocking writers (WAL's whole point) and without the
// server needing to pause, restart, or even know a backup is happening.
//
// Usage:
//   node src/backup.js                 → data/backups/zou-<timestamp>.db
//   node src/backup.js /custom/out.db  → that exact path
//   npm run backup                     → same as the no-arg form
//
// Retention: keeps the most recent KEEP backups made by this script in the
// default directory and deletes older ones — set BACKUP_KEEP=0 to disable
// pruning (e.g. when a custom destination is used, or backups are being
// rotated by an external tool instead).
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Read from the environment at call time, not at module-require time: this
// module is required once and reused (by the CLI entry point below, and by
// the test suite, which points it at a different disposable DB per test by
// setting DB_FILE just before calling backup()) — a module-level constant
// would freeze in whatever DB_FILE happened to be set when this file was
// first `require`d, which is not always the same as when backup() runs.
function resolveDbFile() {
  return process.env.DB_FILE || path.join(__dirname, '..', 'data', 'zou.db');
}
function resolveBackupDir() {
  return process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
}
function resolveKeep() {
  return process.env.BACKUP_KEEP !== undefined ? Number(process.env.BACKUP_KEEP) : 14;
}

function timestamp() {
  // Filesystem- and sort-safe: 2026-09-05T14-30-05Z
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n;
  for (const u of units) {
    v /= 1024;
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
  }
  return `${v.toFixed(1)} TB`;
}

function pruneOldBackups(dir, keep) {
  if (!keep || keep <= 0) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir)
      .filter((f) => /^zou-.*\.db$/.test(f))
      .map((f) => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
  const toDelete = entries.slice(keep);
  for (const { full } of toDelete) fs.unlinkSync(full);
  return toDelete.map((e) => e.f);
}

function backup(destArg) {
  const DB_FILE = resolveDbFile();
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(`No database file at ${DB_FILE} — nothing to back up. (Run \`npm run seed\` first, or check DB_FILE.)`);
  }

  const dest = destArg
    ? path.resolve(destArg)
    : path.join(resolveBackupDir(), `zou-${timestamp()}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    throw new Error(`Destination already exists, refusing to overwrite: ${dest}`);
  }

  // Open the LIVE file read/write (VACUUM INTO needs a real connection, but
  // issues no writes of its own to the source) — this runs safely alongside
  // the server process the same way any other WAL reader would.
  const src = new DatabaseSync(DB_FILE);
  try {
    src.exec('PRAGMA busy_timeout = 5000');
    // Parameter binding isn't supported for VACUUM INTO's filename in
    // node:sqlite, so the path is escaped and inlined instead of using a
    // prepared statement — dest is always ours (either derived from a fixed
    // timestamp or a path the operator passed on the command line), never
    // user/request input, so this is not an injection surface.
    src.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  // Sanity-check the copy is actually a valid, complete SQLite database
  // before calling this a successful backup — silently shipping a truncated
  // or corrupt file would be worse than no backup at all.
  const check = new DatabaseSync(dest);
  try {
    const [{ integrity_check: result }] = check.prepare('PRAGMA integrity_check').all();
    if (result !== 'ok') {
      throw new Error(`Backup written but failed integrity_check: ${result}`);
    }
    const [{ n }] = check.prepare('SELECT COUNT(*) AS n FROM users').get
      ? [check.prepare('SELECT COUNT(*) AS n FROM users').get()]
      : [{ n: null }];
    return { dest, size: fs.statSync(dest).size, userCount: n };
  } finally {
    check.close();
  }
}

if (require.main === module) {
  try {
    const destArg = process.argv[2];
    const result = backup(destArg);
    console.log(`✓ Backup written: ${result.dest} (${formatBytes(result.size)}${result.userCount != null ? `, ${result.userCount} users` : ''})`);
    console.log('✓ Integrity check passed.');
    if (!destArg) {
      const keep = resolveKeep();
      const deleted = pruneOldBackups(resolveBackupDir(), keep);
      if (deleted.length) console.log(`✓ Pruned ${deleted.length} older backup(s) beyond retention of ${keep}: ${deleted.join(', ')}`);
    }
  } catch (err) {
    console.error(`✗ Backup failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { backup, pruneOldBackups };
