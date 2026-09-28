// Real, non-mocked test infrastructure: every test in this suite runs
// against an ACTUAL server process (a real `node src/server.js`, forked
// exactly the way `npm start` runs it) talking to an ACTUAL PostgreSQL
// database, reached over ACTUAL HTTP — never an in-process app object, a
// mocked db module, or stubbed route handlers. The only thing that differs
// from a real deployment is which database it points at: a fresh,
// disposable one PER TEST FILE (created and dropped below), so tests can
// never collide with each other, with a developer's own local zou_irbm
// database, or with whatever this session has been demo-ing against all
// day. This mirrors the previous SQLite-file-per-test-run design 1:1, just
// with `CREATE DATABASE`/`DROP DATABASE` standing in for a temp file.
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const { Client } = require('pg');

const REPO_ROOT = path.join(__dirname, '..');
const DEMO_PASSWORD = 'Zou@2026';
// Every test server this file starts is given exactly this JWT_SECRET (see
// startTestServer below) — exported so a test can mint its own real,
// signature-valid token the same way routes/auth.js's signToken() would
// (`{ sub: userId, tv: tokenVersion }`), for the one case that can't sign in
// through /login: a 'default'-role Individual account, which is
// auth_provider = 'azure' and has no password at all (see routes/org.js's
// POST /individuals) — its actual sign-in only completes through a real
// Microsoft Entra ID tenant, which this test suite has no way to reach, so
// a hand-signed token is how its downstream permission enforcement gets
// exercised with a real, non-mocked HTTP request instead of being skipped.
const TEST_JWT_SECRET = 'automated-test-suite-secret-never-used-outside-tests';

// Connection details for the local/test Postgres server itself — overridable
// for CI or a different local setup, same as db.js's own PG* env vars.
const PG_HOST = process.env.PGHOST || '127.0.0.1';
const PG_PORT = Number(process.env.PGPORT || 5432);
const PG_USER = process.env.PGUSER || 'postgres';
const PG_PASSWORD = process.env.PGPASSWORD || 'zou_local_dev';
// The "maintenance" database used only to issue CREATE DATABASE / DROP
// DATABASE for each test file's own disposable database — never written to
// otherwise.
const MAINTENANCE_DB = process.env.PG_MAINTENANCE_DB || 'postgres';

async function withMaintenanceClient(fn) {
  const client = new Client({
    host: PG_HOST, port: PG_PORT, user: PG_USER, password: PG_PASSWORD, database: MAINTENANCE_DB,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createTestDatabase(name) {
  await withMaintenanceClient(async (client) => {
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropTestDatabase(name) {
  await withMaintenanceClient(async (client) => {
    // The server child process is already killed by the time this runs
    // (see stop() below), but forcibly terminate any straggler backends
    // first so DROP DATABASE never fails with "database is being accessed
    // by other users" on a slow connection teardown.
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [name],
    );
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

function runToCompletion(scriptAbsPath, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptAbsPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${scriptAbsPath} exited with code ${code}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server at ${baseUrl} did not become healthy within ${timeoutMs}ms.`);
}

// Spins up one disposable, fully-seeded instance of the real app: same
// migrations (db.js), same seed data (seed.js) any developer gets from
// `npm run seed`, same server (server.js) any developer gets from
// `npm start` — just pointed at a throwaway, disposable Postgres database
// and an ephemeral port so many test files can each get their own isolated
// instance and run safely in parallel (node:test's default runner does
// exactly that). envOverrides layers on top of everything below — e.g. a
// test exercising routes/auth.js's /azure/* endpoints needs
// azureAuth.isConfigured() to be true (all four AZURE_* vars present) to
// reach past its "not configured" short-circuit, without ever wanting a
// real Microsoft tenant behind them — fake-but-present values are enough
// for that, as long as the test itself never exercises the one branch that
// actually calls out to Microsoft (acquireTokenByCode).
async function startTestServer(envOverrides = {}) {
  const dbName = `zou_test_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await createTestDatabase(dbName);

  const port = await getFreePort();
  const env = {
    ...process.env,
    PGHOST: PG_HOST,
    PGPORT: String(PG_PORT),
    PGUSER: PG_USER,
    PGPASSWORD: PG_PASSWORD,
    PGDATABASE: dbName,
    DB_SSL: process.env.DB_SSL || '', // local test Postgres never needs TLS
    JWT_SECRET: TEST_JWT_SECRET,
    PORT: String(port),
    WEB_CONCURRENCY: '1',
    SEED_PASSWORD: DEMO_PASSWORD,
    CORS_ORIGIN: '',
    // Lets tests deterministically exercise every submission-window state
    // (not_open/open/late/closed — see utils/submissionWindow.js) via an
    // X-Test-Now request header, without which a real server always uses
    // the real clock. Only ever set here, for a disposable test server —
    // never present in a real deployment's own environment.
    ALLOW_TEST_CLOCK_OVERRIDE: '1',
    ...envOverrides,
  };

  // Real migrations + real seed data, run exactly the way `npm run seed`
  // runs them for a human — just against the disposable database above.
  await runToCompletion(path.join(REPO_ROOT, 'src', 'seed.js'), env);

  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'src', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });

  try {
    await waitForHealth(baseUrl);
  } catch (err) {
    child.kill('SIGKILL');
    await dropTestDatabase(dbName).catch(() => {});
    throw new Error(`${err.message}\n--- server stdout ---\n${stdout}\n--- server stderr ---\n${stderr}`);
  }

  async function stop() {
    await new Promise((resolve) => {
      child.on('exit', resolve);
      child.kill('SIGKILL');
    });
    await dropTestDatabase(dbName).catch((err) => {
      console.error(`Failed to drop test database ${dbName}:`, err.message);
    });
  }

  return { baseUrl, stop, dbName, DEMO_PASSWORD };
}

// A tiny fetch wrapper matching this app's real API conventions (JSON body
// in, JSON body out, Bearer token auth) — no HTTP mocking, every call is a
// genuine request against the server started above.
function client(baseUrl) {
  async function request(path, { method = 'GET', token, body, headers: extraHeaders } = {}) {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: json };
  }
  async function login(email, password = DEMO_PASSWORD) {
    const r = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    if (r.status !== 200 || !r.body?.token) {
      throw new Error(`Login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    return r.body; // { token, user }
  }
  return { request, login };
}

module.exports = { startTestServer, client, DEMO_PASSWORD, TEST_JWT_SECRET };
