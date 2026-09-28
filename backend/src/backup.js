// Real, restorable PostgreSQL backups of the live database — safe to run
// while the server is up and serving writes.
//
// Uses `pg_dump` in custom format (-Fc): Postgres's own consistent-snapshot
// backup primitive — it opens one transaction at the REPEATABLE READ
// isolation level against the live database and streams out everything
// visible as of that instant, without blocking concurrent readers or
// writers and without the server needing to pause, restart, or even know a
// backup is happening. Custom format (as opposed to plain SQL text) is
// compressed, and is what `pg_restore` (including the --list/-l table-of-
// contents read this file uses to verify a backup, and a real restore into
// a scratch database to prove it's actually usable) expects.
//
// Usage:
//   node src/backup.js                    → data/backups/zou-<timestamp>.dump
//   node src/backup.js /custom/out.dump   → that exact path
//   npm run backup                        → same as the no-arg form
//
// Restoring a backup (into an EXISTING, empty database — pg_restore never
// creates the database itself):
//   createdb zou_restored
//   pg_restore --no-owner --no-privileges -d zou_restored data/backups/zou-<timestamp>.dump
//
// Retention: keeps the most recent KEEP backups made by this script in the
// default directory and deletes older ones — set BACKUP_KEEP=0 to disable
// pruning (e.g. when a custom destination is used, or backups are being
// rotated by an external tool instead).
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { Client } = require('pg');

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// Same PG* env var resolution db.js uses (kept independent of db.js itself
// — this script must work even when db.js's own pool can't connect, e.g.
// while diagnosing a connection problem).
function resolvePgConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.PGHOST || process.env.DB_HOST || '127.0.0.1',
    port: String(process.env.PGPORT || process.env.DB_PORT || 5432),
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.PGDATABASE || process.env.DB_NAME || 'zou_irbm',
  };
}

// Read at call time, not module-require time — resolvePgConfig() above (and
// this) must reflect whatever env vars are set right before backup() runs
// (the test suite points this at a different disposable database per test
// by setting PG* env vars just before calling backup()), not whatever was
// set when this module was first `require`d.
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
      .filter((f) => /^zou-.*\.dump$/.test(f))
      .map((f) => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
  const toDelete = entries.slice(keep);
  for (const { full } of toDelete) fs.unlinkSync(full);
  return toDelete.map((e) => e.f);
}

// pg_dump/pg_restore take connection details as flags + PGPASSWORD in the
// environment (never on the command line, where it would leak into `ps`
// output or shell history) rather than in a connection string, so the same
// flags work whether or not DATABASE_URL is set.
function pgEnvAndArgs(cfg) {
  if (cfg.connectionString) {
    return { args: [cfg.connectionString], env: { ...process.env } };
  }
  return {
    args: ['-h', cfg.host, '-p', cfg.port, '-U', cfg.user, cfg.database],
    env: { ...process.env, PGPASSWORD: cfg.password },
  };
}

async function backup(destArg) {
  const cfg = resolvePgConfig();

  // Fail fast with a clear message if the source database itself isn't
  // reachable at all, rather than letting a much less legible pg_dump
  // stderr blob be the only signal.
  const probe = new Client(cfg.connectionString ? { connectionString: cfg.connectionString } : {
    host: cfg.host, port: Number(cfg.port), user: cfg.user, password: cfg.password, database: cfg.database,
  });
  try {
    await probe.connect();
  } catch (err) {
    throw new Error(`Could not reach database "${cfg.database || '(from DATABASE_URL)'}" to back it up: ${err.message}`);
  } finally {
    await probe.end().catch(() => {});
  }

  const dest = destArg
    ? path.resolve(destArg)
    : path.join(resolveBackupDir(), `zou-${timestamp()}.dump`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    throw new Error(`Destination already exists, refusing to overwrite: ${dest}`);
  }

  const { args: connArgs, env } = pgEnvAndArgs(cfg);
  try {
    await run('pg_dump', [...connArgs, '-F', 'c', '-f', dest], env);
  } catch (err) {
    throw new Error(`pg_dump failed: ${err.stderr || err.message}`);
  }

  // Verify the archive is real and complete two ways: (1) pg_restore can at
  // least read its table of contents (catches a truncated/corrupt file
  // immediately, cheaply), and (2) an actual restore into a scratch
  // database, queried back, proving the backup is genuinely usable — not
  // just structurally well-formed. Shipping a backup nobody can actually
  // restore from would be worse than no backup at all.
  let tableOfContents;
  try {
    ({ stdout: tableOfContents } = await run('pg_restore', ['--list', dest], { ...process.env }));
  } catch (err) {
    fs.unlinkSync(dest);
    throw new Error(`Backup written but pg_restore could not read it (corrupt archive): ${err.stderr || err.message}`);
  }
  if (!/TABLE DATA public users/.test(tableOfContents)) {
    fs.unlinkSync(dest);
    throw new Error('Backup written but its table of contents is missing the users table — refusing to call this a valid backup.');
  }

  const verifyDbName = `zou_backup_verify_${process.pid}_${Date.now()}`;
  const maintenance = new Client(cfg.connectionString ? { connectionString: cfg.connectionString } : {
    host: cfg.host, port: Number(cfg.port), user: cfg.user, password: cfg.password, database: 'postgres',
  });
  let userCount = null;
  await maintenance.connect();
  try {
    await maintenance.query(`CREATE DATABASE "${verifyDbName}"`);
    try {
      // pg_restore takes the target database as `-h/-p/-U ... -d dbname`
      // (or a connection string in place of all four) followed by the
      // dump file itself as the one positional argument.
      const restoreArgs = cfg.connectionString
        ? [cfg.connectionString.replace(/\/[^/?]+(\?|$)/, `/${verifyDbName}$1`)]
        : ['-h', cfg.host, '-p', cfg.port, '-U', cfg.user, '-d', verifyDbName];
      await run('pg_restore', [...restoreArgs, '--no-owner', '--no-privileges', dest], env);
      const verifyClient = new Client(cfg.connectionString ? { connectionString: cfg.connectionString } : {
        host: cfg.host, port: Number(cfg.port), user: cfg.user, password: cfg.password, database: verifyDbName,
      });
      await verifyClient.connect();
      try {
        const { rows } = await verifyClient.query('SELECT COUNT(*)::int AS n FROM users');
        userCount = rows[0].n;
      } finally {
        await verifyClient.end();
      }
    } finally {
      await maintenance.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [verifyDbName],
      ).catch(() => {});
      await maintenance.query(`DROP DATABASE IF EXISTS "${verifyDbName}"`).catch(() => {});
    }
  } catch (err) {
    fs.unlinkSync(dest);
    throw new Error(`Backup written but failed restore verification: ${err.stderr || err.message}`);
  } finally {
    await maintenance.end();
  }

  return { dest, size: fs.statSync(dest).size, userCount };
}

if (require.main === module) {
  (async () => {
    try {
      const destArg = process.argv[2];
      const result = await backup(destArg);
      console.log(`✓ Backup written: ${result.dest} (${formatBytes(result.size)}${result.userCount != null ? `, ${result.userCount} users` : ''})`);
      console.log('✓ Restore verification passed (restored into a scratch database and queried back).');
      if (!destArg) {
        const keep = resolveKeep();
        const deleted = pruneOldBackups(resolveBackupDir(), keep);
        if (deleted.length) console.log(`✓ Pruned ${deleted.length} older backup(s) beyond retention of ${keep}: ${deleted.join(', ')}`);
      }
    } catch (err) {
      console.error(`✗ Backup failed: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = { backup, pruneOldBackups };
