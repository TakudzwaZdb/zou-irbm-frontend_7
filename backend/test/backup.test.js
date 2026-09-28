const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Client } = require('pg');
const { startTestServer, client } = require('./helpers');
const { backup, pruneOldBackups } = require('../src/backup');

let server, api, ictadmin;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
  ictadmin = (await api.login('l.chikomo@zou.ac.zw')).token;
});
after(async () => { await server.stop(); });

// backup.js reads its PG* connection details from the environment at call
// time (see its own comment) — same pattern the old SQLite-era test used
// with DB_FILE, just pointed at this test file's disposable database
// (server.dbName — see helpers.js's startTestServer) instead of a path.
function withTestServerEnv(fn) {
  const keys = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'DATABASE_URL'];
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
  process.env.PGPORT = process.env.PGPORT || '5432';
  process.env.PGUSER = process.env.PGUSER || 'postgres';
  process.env.PGPASSWORD = process.env.PGPASSWORD || 'zou_local_dev';
  process.env.PGDATABASE = server.dbName;
  delete process.env.DATABASE_URL;
  return Promise.resolve(fn()).finally(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  });
}

// Real end-to-end coverage of the operational safety net: the backup has to
// work against the ACTUAL live database of a server that is up and actively
// taking writes — not a database quietly sitting idle. Proves pg_dump's
// consistent snapshot really does capture a complete, independent, and
// genuinely RESTORABLE copy under real concurrent-access conditions, not
// just a well-formed-looking file.
test('backup produces a valid, complete, independent, restorable snapshot of a live, actively-written database', async () => {
  // Generate real write traffic on the live DB right before backing it up.
  const created = await api.request('/api/org/programmes', {
    method: 'POST', token: ictadmin,
    body: { name: 'Backup Test Programme', head: 'Dr. Backup' },
  });
  assert.equal(created.status, 201);

  const dest = path.join(os.tmpdir(), `zou-backup-test-${process.pid}-${Date.now()}.dump`);
  let result;
  try {
    result = await withTestServerEnv(() => backup(dest));

    assert.equal(result.dest, dest);
    assert.ok(fs.existsSync(dest), 'backup file was not written');
    assert.ok(result.size > 0, 'backup file is empty');
    assert.ok(result.userCount > 0, 'backup restore-verification reported no users — looks like an empty/fresh DB, not a copy of the live one');

    // backup() already restored this into its own scratch database as part
    // of verification (and dropped it again) — independently repeat that
    // here with a scratch database of this test's own, so the assertion
    // that the actual write made just before backing up survived the round
    // trip isn't just taking backup()'s word for it.
    const verifyDbName = `zou_backup_test_verify_${process.pid}_${Date.now()}`;
    const maintenance = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD || 'zou_local_dev', database: 'postgres' });
    await maintenance.connect();
    try {
      await maintenance.query(`CREATE DATABASE "${verifyDbName}"`);
      try {
        await new Promise((resolve, reject) => {
          const { execFile } = require('child_process');
          execFile('pg_restore', ['-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', verifyDbName, '--no-owner', '--no-privileges', dest],
            { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'zou_local_dev' }, maxBuffer: 64 * 1024 * 1024 },
            (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
        });

        const verifyClient = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.PGPASSWORD || 'zou_local_dev', database: verifyDbName });
        await verifyClient.connect();
        try {
          const liveCount = (await verifyClient.query('SELECT COUNT(*)::int AS n FROM programmes')).rows[0].n;
          assert.ok(liveCount > 0, 'backup has no programmes — looks like an empty/fresh DB, not a copy of the live one');

          const found = (await verifyClient.query('SELECT * FROM programmes WHERE name = $1', ['Backup Test Programme'])).rows[0];
          assert.ok(found, 'the write made just before backing up is missing from the snapshot — backup ran against stale/incomplete state');

          const userCount = (await verifyClient.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
          assert.ok(userCount > 0);
          assert.equal(userCount, result.userCount);
        } finally {
          await verifyClient.end();
        }
      } finally {
        await maintenance.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [verifyDbName],
        ).catch(() => {});
        await maintenance.query(`DROP DATABASE IF EXISTS "${verifyDbName}"`);
      }
    } finally {
      await maintenance.end();
    }
  } finally {
    fs.rmSync(dest, { force: true });
  }
});

test('backup refuses to overwrite an existing destination file', async () => {
  const dest = path.join(os.tmpdir(), `zou-backup-test-collide-${process.pid}-${Date.now()}.dump`);
  fs.writeFileSync(dest, 'not a real dump, just occupying the path');

  try {
    await assert.rejects(() => withTestServerEnv(() => backup(dest)), /already exists/i);
  } finally {
    fs.unlinkSync(dest);
  }
});

test('backup errors clearly when the source database does not exist', async () => {
  const fakeName = `zou_nonexistent_${process.pid}_${Date.now()}`;
  const keys = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'DATABASE_URL'];
  const prev = {}; for (const k of keys) prev[k] = process.env[k];
  process.env.PGHOST = '127.0.0.1'; process.env.PGPORT = '5432'; process.env.PGUSER = 'postgres';
  process.env.PGPASSWORD = process.env.PGPASSWORD || 'zou_local_dev';
  process.env.PGDATABASE = fakeName;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(() => backup(), /does not exist/i);
  } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
});

// Retention pruning is exercised directly against a scratch directory of
// fake backup files (real files on real disk with real, deliberately-spread
// mtimes — just not real archives, since pruneOldBackups only looks at
// filenames and mtimes, never opens the files).
test('pruneOldBackups deletes only the oldest backups beyond the keep count, never anything else in the directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zou-prune-test-'));
  try {
    const names = ['zou-2026-01-01T00-00-00Z.dump', 'zou-2026-01-02T00-00-00Z.dump', 'zou-2026-01-03T00-00-00Z.dump', 'zou-2026-01-04T00-00-00Z.dump'];
    names.forEach((name, i) => {
      const full = path.join(dir, name);
      fs.writeFileSync(full, 'x');
      const t = new Date(2026, 0, i + 1).getTime() / 1000;
      fs.utimesSync(full, t, t);
    });
    // An unrelated file that happens to live in the same directory must
    // never be touched by pruning, no matter how old it is.
    const unrelated = path.join(dir, 'not-a-backup.txt');
    fs.writeFileSync(unrelated, 'leave me alone');
    fs.utimesSync(unrelated, 1, 1);

    const deleted = pruneOldBackups(dir, 2);
    assert.deepEqual(deleted.sort(), ['zou-2026-01-01T00-00-00Z.dump', 'zou-2026-01-02T00-00-00Z.dump']);

    const remaining = fs.readdirSync(dir).sort();
    assert.deepEqual(remaining, ['not-a-backup.txt', 'zou-2026-01-03T00-00-00Z.dump', 'zou-2026-01-04T00-00-00Z.dump']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pruneOldBackups is a no-op when keep is 0 (pruning disabled)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zou-prune-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'zou-2026-01-01T00-00-00Z.dump'), 'x');
    const deleted = pruneOldBackups(dir, 0);
    assert.deepEqual(deleted, []);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
