// Real, non-mocked test infrastructure: every test in this suite runs
// against an ACTUAL server process (a real `node src/server.js`, forked
// exactly the way `npm start` runs it) talking to an ACTUAL SQLite file on
// disk, reached over ACTUAL HTTP — never an in-process app object, a mocked
// db module, or stubbed route handlers. The only thing that differs from a
// real deployment is which database file it points at: a fresh, disposable
// one per test file (see DB_FILE below), so tests can never collide with
// each other, with a developer's own local data/zou.db, or with whatever
// this session has been demo-ing against all day.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

const REPO_ROOT = path.join(__dirname, '..');
const DEMO_PASSWORD = 'Zou@2026';

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
// `npm start` — just pointed at a throwaway SQLite file and an ephemeral
// port so many test files can each get their own isolated instance and run
// safely in parallel (node:test's default runner does exactly that).
async function startTestServer() {
  const dbFile = path.join(os.tmpdir(), `zou-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const port = await getFreePort();
  const env = {
    ...process.env,
    DB_FILE: dbFile,
    JWT_SECRET: 'automated-test-suite-secret-never-used-outside-tests',
    PORT: String(port),
    WEB_CONCURRENCY: '1',
    SEED_PASSWORD: DEMO_PASSWORD,
    CORS_ORIGIN: '',
  };

  // Real migrations + real seed data, run exactly the way `npm run seed`
  // runs them for a human — just against the disposable DB file above.
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
    throw new Error(`${err.message}\n--- server stdout ---\n${stdout}\n--- server stderr ---\n${stderr}`);
  }

  async function stop() {
    await new Promise((resolve) => {
      child.on('exit', resolve);
      child.kill('SIGKILL');
    });
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbFile + suffix); } catch { /* already gone / never existed */ }
    }
  }

  return { baseUrl, stop, dbFile, DEMO_PASSWORD };
}

// A tiny fetch wrapper matching this app's real API conventions (JSON body
// in, JSON body out, Bearer token auth) — no HTTP mocking, every call is a
// genuine request against the server started above.
function client(baseUrl) {
  async function request(path, { method = 'GET', token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
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

module.exports = { startTestServer, client, DEMO_PASSWORD };
