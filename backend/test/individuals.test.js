const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { startTestServer, client, TEST_JWT_SECRET } = require('./helpers');

// Real, end-to-end coverage of the "Individual" redesign: an Individual is
// now created with just a name + a pre-approved email (no unit/department,
// no role title to type), gets the built-in 'default' role (identical to
// 'individual' minus data_entry — see utils/permissions.js), and has no
// password at all — they complete their own sign-in through Microsoft
// Entra ID (see routes/auth.js's /azure/login + /azure/callback,
// AZURE_SETUP.md). There is no PATCH /individuals/:id any more; every
// Individual, however it was created, is delete-only.
//
// This test server never has AZURE_TENANT_ID/AZURE_CLIENT_ID/
// AZURE_CLIENT_SECRET/AZURE_REDIRECT_URI set (see helpers.js's env block),
// so it can't complete a real Microsoft sign-in — that only happens against
// a genuine Entra ID tenant (see AZURE_SETUP.md). What IS covered here,
// with real HTTP requests against a real server and a real database, same
// as every other test in this suite:
//   - creation validation, no-department/no-password/default-role shape
//   - the resulting account's actual permission enforcement (read allowed,
//     data entry rejected) via a real bearer token — minted the same way
//     routes/auth.js's signToken() mints one for a real Azure sign-in, since
//     there's no tenant here to sign in through
//   - password sign-in being rejected for this account with a clear message
//   - delete/restore, including its real effect on that account's own
//     session (deactivated -> reactivated)
//   - /azure/login and /azure/callback failing SAFELY (503 / a redirect
//     with #azure_error) rather than crashing, for every input this
//     unconfigured test server can actually reach without a real tenant

let server, api, ictadmin;
// A second, separate server with fake-but-present AZURE_* values — just
// enough for azureAuth.isConfigured() to be true so /azure/callback's
// code/state validation branches are actually reachable, without ever
// exercising acquireTokenByCode (the one branch that would really call out
// to Microsoft — never triggered by the malformed-input cases below, since
// they all fail validation before reaching it).
let azureServer;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
  ictadmin = (await api.login('l.chikomo@zou.ac.zw')).token;

  azureServer = await startTestServer({
    AZURE_TENANT_ID: 'test-tenant-id',
    AZURE_CLIENT_ID: 'test-client-id',
    AZURE_CLIENT_SECRET: 'test-client-secret',
    AZURE_REDIRECT_URI: 'http://localhost:1/api/auth/azure/callback',
  });
});
after(async () => {
  await server.stop();
  await azureServer.stop();
});

// Mints a real, signature-valid session token for a given user id, exactly
// the shape routes/auth.js's signToken() produces — the one piece of a real
// Azure sign-in this suite cannot perform itself (see file comment above).
function tokenFor(userId, tokenVersion = 0) {
  return jwt.sign({ sub: userId, tv: tokenVersion }, TEST_JWT_SECRET, { expiresIn: '12h' });
}

test('POST /org/individuals creates a name+email-only, no-department, default-role, passwordless account', async () => {
  const r = await api.request('/api/org/individuals', {
    method: 'POST', token: ictadmin,
    body: { name: 'Tariro Mapfumo', email: 'tariro.mapfumo@zou.ac.zw' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.individual.unit_id, null, 'no department should ever be assigned');
  assert.equal(r.body.individual.role_title, 'Default');
  assert.equal(r.body.individual.name, 'Tariro Mapfumo');
  assert.equal(r.body.account.email, 'tariro.mapfumo@zou.ac.zw');
  assert.match(r.body.account.note, /Microsoft/);

  // Shows up in the live org tree with no unit, same as every other read.
  const org = await api.request('/api/org', { token: ictadmin });
  const found = org.body.individuals.find((i) => i.id === r.body.individual.id);
  assert.ok(found, 'created individual should appear in GET /org');
  assert.equal(found.unit_id, null);
});

test('POST /org/individuals validates name and email, and normalizes/lowercases the email', async () => {
  const noName = await api.request('/api/org/individuals', { method: 'POST', token: ictadmin, body: { email: 'x@zou.ac.zw' } });
  assert.equal(noName.status, 400);

  const noEmail = await api.request('/api/org/individuals', { method: 'POST', token: ictadmin, body: { name: 'No Email' } });
  assert.equal(noEmail.status, 400);
  assert.match(noEmail.body.error, /Microsoft/);

  const badEmail = await api.request('/api/org/individuals', { method: 'POST', token: ictadmin, body: { name: 'Bad Email', email: 'not-an-email' } });
  assert.equal(badEmail.status, 400);

  const mixedCase = await api.request('/api/org/individuals', {
    method: 'POST', token: ictadmin,
    body: { name: 'Mixed Case', email: '  Mixed.Case@ZOU.ac.zw  ' },
  });
  assert.equal(mixedCase.status, 201);
  assert.equal(mixedCase.body.account.email, 'mixed.case@zou.ac.zw');
});

test('POST /org/individuals rejects a duplicate email (case-insensitively) with a clear message', async () => {
  const first = await api.request('/api/org/individuals', {
    method: 'POST', token: ictadmin,
    body: { name: 'First Person', email: 'dupe.check@zou.ac.zw' },
  });
  assert.equal(first.status, 201);

  const dupe = await api.request('/api/org/individuals', {
    method: 'POST', token: ictadmin,
    body: { name: 'Second Person', email: 'DUPE.CHECK@zou.ac.zw' },
  });
  assert.equal(dupe.status, 400);
  assert.match(dupe.body.error, /already in use/);
});

test('the default role is real, read-only, and enforced server-side: view succeeds, data entry is rejected', async () => {
  const created = await api.request('/api/org/individuals', {
    method: 'POST', token: ictadmin,
    body: { name: 'Read Only Person', email: 'read.only@zou.ac.zw' },
  });
  assert.equal(created.status, 201);
  const userToken = tokenFor(created.body.individual.user_id);

  const me = await api.request('/api/auth/me', { token: userToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'default');
  assert.deepEqual([...me.body.user.permissions].sort(), ['view_framework', 'view_overview']);

  // A data-entry-gated write must be rejected — 'default' is 'individual'
  // minus data_entry, on purpose (see utils/permissions.js).
  const write = await api.request('/api/kpis/bulk-value', { method: 'PUT', token: userToken, body: { updates: [] } });
  assert.equal(write.status, 403);
  assert.match(write.body.error, /data_entry/);
});

test('a default-role account cannot sign in with a password — the login route points it at Microsoft instead', async () => {
  const created = await api.request('/api/org/individuals', {
    method: 'POST', token: ictadmin,
    body: { name: 'Azure Only Person', email: 'azure.only@zou.ac.zw' },
  });
  assert.equal(created.status, 201);

  const attempt = await api.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'azure.only@zou.ac.zw', password: 'anything-at-all' },
  });
  assert.equal(attempt.status, 401);
  assert.equal(attempt.body.code, 'USE_AZURE_LOGIN');
  assert.match(attempt.body.error, /Microsoft/);
});

test('PATCH /org/individuals/:id no longer exists — an Individual is delete-only', async () => {
  const created = await api.request('/api/org/individuals', {
    method: 'POST', token: ictadmin,
    body: { name: 'Immutable Person', email: 'immutable@zou.ac.zw' },
  });
  assert.equal(created.status, 201);

  const patch = await api.request(`/api/org/individuals/${created.body.individual.id}`, {
    method: 'PATCH', token: ictadmin, body: { name: 'Renamed' },
  });
  assert.equal(patch.status, 404);
});

test('DELETE /org/individuals/:id is fully reversible, including its effect on the account\'s own session', async () => {
  const created = await api.request('/api/org/individuals', {
    method: 'POST', token: ictadmin,
    body: { name: 'Removable Person', email: 'removable@zou.ac.zw' },
  });
  const individualId = created.body.individual.id;
  const userToken = tokenFor(created.body.individual.user_id);

  // Works before removal.
  assert.equal((await api.request('/api/auth/me', { token: userToken })).status, 200);

  const del = await api.request(`/api/org/individuals/${individualId}`, { method: 'DELETE', token: ictadmin });
  assert.equal(del.status, 200);
  assert.equal(del.body.ok, true);

  // Gone from the live tree, present in Recently Removed.
  const orgAfterDelete = await api.request('/api/org', { token: ictadmin });
  assert.ok(!orgAfterDelete.body.individuals.some((i) => i.id === individualId));
  const removed = await api.request('/api/org/removed', { token: ictadmin });
  assert.ok(removed.body.individuals.some((i) => i.id === individualId));

  // The account's own session stops working immediately — not just the
  // admin-facing list — because DELETE cascades to deactivating the login
  // account too (see routes/org.js's cascadeSoftDeleteIndividual).
  const meAfterDelete = await api.request('/api/auth/me', { token: userToken });
  assert.equal(meAfterDelete.status, 401);
  assert.match(meAfterDelete.body.error, /deactivated/);

  const restore = await api.request(`/api/org/individuals/${individualId}/restore`, { method: 'POST', token: ictadmin });
  assert.equal(restore.status, 200);
  assert.equal(restore.body.individual.unit_id, null);

  const orgAfterRestore = await api.request('/api/org', { token: ictadmin });
  assert.ok(orgAfterRestore.body.individuals.some((i) => i.id === individualId));

  // The very same token works again — restoring the individual reactivated
  // the same login account, not a new one.
  const meAfterRestore = await api.request('/api/auth/me', { token: userToken });
  assert.equal(meAfterRestore.status, 200);
  assert.equal(meAfterRestore.body.user.role, 'default');
});

test('GET /auth/azure/login fails safely (503), not a crash, when Microsoft sign-in is not configured', async () => {
  const r = await api.request('/api/auth/azure/login', {});
  assert.equal(r.status, 503);
  assert.match(r.body.error, /not been set up|AZURE_SETUP/i);
});

test('GET /auth/azure/callback fails safely (redirects with #azure_error), never a crash, when unconfigured', async () => {
  // fetch() follows redirects by default, which would resolve all the way
  // through to this server's own index.html and hide the very thing being
  // tested — read the raw 302 + Location header instead.
  async function rawGet(base, qs) {
    return fetch(`${base}/api/auth/azure/callback${qs}`, { redirect: 'manual' });
  }

  // This suite's main server never has the AZURE_* vars set (the default,
  // safe-out-of-the-box state for a fresh deployment) — isConfigured() is
  // false, so every shape of request, valid-looking or not, hits that same
  // guard first and degrades to a redirect, never a 500 or a hang.
  for (const qs of ['', '?code=abc', '?code=abc&state=not-a-real-jwt', '?error_description=User+declined']) {
    const r = await rawGet(server.baseUrl, qs);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /#azure_error=/);
  }
});

test('GET /auth/azure/callback validates code/state/error_description correctly once configured, without ever reaching Microsoft', async () => {
  async function rawGet(qs) {
    return fetch(`${azureServer.baseUrl}/api/auth/azure/callback${qs}`, { redirect: 'manual' });
  }

  const missingParams = await rawGet('?code=abc'); // no state
  assert.equal(missingParams.status, 302);
  assert.match(decodeURIComponent(missingParams.headers.get('location')), /did not complete/i);

  const badState = await rawGet('?code=abc&state=not-a-real-jwt');
  assert.equal(badState.status, 302);
  assert.match(decodeURIComponent(badState.headers.get('location')), /expired/i);

  // The identity provider's own error (e.g. the user declined consent) is
  // surfaced as-is and short-circuits before any Microsoft/token exchange
  // is attempted at all.
  const idpError = await rawGet('?error_description=' + encodeURIComponent('User declined consent'));
  assert.equal(idpError.status, 302);
  assert.match(decodeURIComponent(idpError.headers.get('location')), /User declined consent/);
});
