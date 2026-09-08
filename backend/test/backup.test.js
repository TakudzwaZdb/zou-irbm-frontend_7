const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const { startTestServer, client } = require('./helpers');
const { backup, pruneOldBackups } = require('../src/backup');

let server, api, ictadmin;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
  ictadmin = (await api.login('l.chikomo@zou.ac.zw')).token;
});
after(async () => { await server.stop(); });

// Real end-to-end coverage of the operational safety net: the backup has to
// work against the ACTUAL live database file of a server that is up and
// actively taking writes (WAL mode, see db.js) — not a database quietly
// sitting idle. Proves VACUUM INTO really does produce a complete, valid,
// independent copy under real concurrent-access conditions, not just when
// nothing else is touching the file.
test('backup produces a valid, complete, independent snapshot of a live, actively-written database', async () => {
  // Generate real write traffic on the live DB right before backing it up —
  // this is what a WAL checkpoint gap or a torn plain-copy would actually
  // stumble over.
  const created = await api.request('/api/org/programmes', {
    method: 'POST', token: ictadmin,
    body: { name: 'Backup Test Programme', head: 'Dr. Backup' },
  });
  assert.equal(created.status, 201);

  const dest = path.join(os.tmpdir(), `zou-backup-test-${process.pid}-${Date.now()}.db`);
  const prevDbFile = process.env.DB_FILE;
  process.env.DB_FILE = server.dbFile; // backup.js reads DB_FILE from the environment
  let result;
  try {
    result = backup(dest);
  } finally {
    if (prevDbFile === undefined) delete process.env.DB_FILE; else process.env.DB_FILE = prevDbFile;
  }

  assert.equal(result.dest, dest);
  assert.ok(fs.existsSync(dest), 'backup file was not written');
  assert.ok(result.size > 0, 'backup file is empty');

  // Independently re-open the backup (a fresh connection, not the one
  // backup.js used) and confirm it is a real, queryable, complete database —
  // not a stub, a partial write, or a corrupt file that merely exists.
  const check = new DatabaseSync(dest);
  try {
    const [{ integrity_check: integrity }] = check.prepare('PRAGMA integrity_check').all();
    assert.equal(integrity, 'ok');

    const liveCount = check.prepare('SELECT COUNT(*) AS n FROM programmes').get().n;
    assert.ok(liveCount > 0, 'backup has no programmes — looks like an empty/fresh DB, not a copy of the live one');

    const found = check.prepare('SELECT * FROM programmes WHERE name = ?').get('Backup Test Programme');
    assert.ok(found, 'the write made just before backing up is missing from the snapshot — backup ran against stale/incomplete state');

    // The users table (with real password hashes) must have made it across
    // too, proving this is a full-database copy, not a partial export.
    const userCount = check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    assert.ok(userCount > 0);
    assert.equal(userCount, result.userCount);
  } finally {
    check.close();
  }

  fs.unlinkSync(dest);
});

test('backup refuses to overwrite an existing destination file', async () => {
  const dest = path.join(os.tmpdir(), `zou-backup-test-collide-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(dest, 'not a real database, just occupying the path');

  const prevDbFile = process.env.DB_FILE;
  process.env.DB_FILE = server.dbFile;
  try {
    assert.throws(() => backup(dest), /already exists/i);
  } finally {
    if (prevDbFile === undefined) delete process.env.DB_FILE; else process.env.DB_FILE = prevDbFile;
    fs.unlinkSync(dest);
  }
});

test('backup errors clearly when the source database file does not exist', () => {
  const prevDbFile = process.env.DB_FILE;
  process.env.DB_FILE = path.join(os.tmpdir(), `zou-nonexistent-${process.pid}-${Date.now()}.db`);
  try {
    assert.throws(() => backup(), /no database file/i);
  } finally {
    if (prevDbFile === undefined) delete process.env.DB_FILE; else process.env.DB_FILE = prevDbFile;
  }
});

// Retention pruning is exercised directly against a scratch directory of
// fake backup files (real files on real disk with real, deliberately-spread
// mtimes — just not real databases, since pruneOldBackups only looks at
// filenames and mtimes, never opens the files).
test('pruneOldBackups deletes only the oldest backups beyond the keep count, never anything else in the directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zou-prune-test-'));
  try {
    const names = ['zou-2026-01-01T00-00-00Z.db', 'zou-2026-01-02T00-00-00Z.db', 'zou-2026-01-03T00-00-00Z.db', 'zou-2026-01-04T00-00-00Z.db'];
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
    assert.deepEqual(deleted.sort(), ['zou-2026-01-01T00-00-00Z.db', 'zou-2026-01-02T00-00-00Z.db']);

    const remaining = fs.readdirSync(dir).sort();
    assert.deepEqual(remaining, ['not-a-backup.txt', 'zou-2026-01-03T00-00-00Z.db', 'zou-2026-01-04T00-00-00Z.db']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pruneOldBackups is a no-op when keep is 0 (pruning disabled)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zou-prune-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'zou-2026-01-01T00-00-00Z.db'), 'x');
    const deleted = pruneOldBackups(dir, 0);
    assert.deepEqual(deleted, []);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
