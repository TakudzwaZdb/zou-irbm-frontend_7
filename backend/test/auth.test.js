const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server, api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});
after(async () => { await server.stop(); });

test('correct credentials log in and return a real bearer token', async () => {
  const r = await api.request('/api/auth/login', { method: 'POST', body: { email: 't.moyo@zou.ac.zw', password: 'Zou@2026' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token && r.body.token.split('.').length === 3, 'expected a real JWT (three dot-separated parts)');
  assert.equal(r.body.user.email, 't.moyo@zou.ac.zw');
  assert.equal(r.body.user.role, 'cpu');
  // The password hash itself must never leak into the response.
  assert.equal(r.body.user.password_hash, undefined);
});

test('wrong password is rejected with a generic message', async () => {
  const r = await api.request('/api/auth/login', { method: 'POST', body: { email: 't.moyo@zou.ac.zw', password: 'wrong-password' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Incorrect email or password.');
});

test('a nonexistent account gets the exact same generic message (no user enumeration)', async () => {
  const r = await api.request('/api/auth/login', { method: 'POST', body: { email: 'nobody-like-this@zou.ac.zw', password: 'whatever' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Incorrect email or password.');
});

test('a protected route with no token is rejected', async () => {
  const r = await api.request('/api/auth/me');
  assert.equal(r.status, 401);
});

test('a protected route with a garbage token is rejected', async () => {
  const r = await api.request('/api/auth/me', { token: 'not-a-real-jwt' });
  assert.equal(r.status, 401);
});

test('a valid token reaches GET /me and reports the right identity', async () => {
  const { token } = await api.login('l.chikomo@zou.ac.zw');
  const r = await api.request('/api/auth/me', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'ictadmin');
});

test('RBAC: a non-ictadmin role is refused the ictadmin-only user directory', async () => {
  const { token } = await api.login('t.chikwanha@zou.ac.zw'); // individual
  const r = await api.request('/api/users', { token });
  assert.equal(r.status, 403);
});

test('RBAC: ictadmin itself can reach the same route', async () => {
  const { token } = await api.login('l.chikomo@zou.ac.zw');
  const r = await api.request('/api/users', { token });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.users) && r.body.users.length > 0);
});

test('sign out everywhere immediately invalidates the token that called it', async () => {
  const { token } = await api.login('n.moyana@zou.ac.zw');
  let r = await api.request('/api/auth/me', { token });
  assert.equal(r.status, 200);

  r = await api.request('/api/auth/logout-everywhere', { method: 'POST', token });
  assert.equal(r.status, 200);

  r = await api.request('/api/auth/me', { token });
  assert.equal(r.status, 401, 'the very token used to sign out everywhere must itself stop working immediately');
});

test('an admin-driven password reset forces a real change before anything else works', async () => {
  const { token: adminToken } = await api.login('l.chikomo@zou.ac.zw');
  // Find a real seeded account to reset that isn't already mid-test elsewhere.
  const dir = await api.request('/api/users', { token: adminToken });
  const target = dir.body.users.find((u) => u.email === 's.chikonzo@zou.ac.zw');
  assert.ok(target, 'expected the seeded Unit Head account to exist');

  const reset = await api.request(`/api/users/${target.id}/reset-password`, { method: 'POST', token: adminToken, body: {} });
  assert.equal(reset.status, 200);
  const tempPassword = reset.body.newPassword;
  assert.ok(tempPassword && tempPassword.length >= 8);

  const login = await api.login(target.email, tempPassword);
  assert.equal(login.user.must_change_password, true);

  // Everything except /me and /change-password must be blocked while this is set.
  const blocked = await api.request('/api/org', { token: login.token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

  const changed = await api.request('/api/auth/change-password', {
    method: 'POST', token: login.token,
    body: { currentPassword: tempPassword, newPassword: 'a-real-new-password-123' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.must_change_password, false);

  // The old temporary password is dead now; the new one works and is unblocked.
  await assert.rejects(() => api.login(target.email, tempPassword));
  const relogin = await api.login(target.email, 'a-real-new-password-123');
  const unblocked = await api.request('/api/org', { token: relogin.token });
  assert.notEqual(unblocked.status, 403);
});

test('a deactivated account cannot sign in, and restoring it reactivates login', async () => {
  const { token: adminToken } = await api.login('l.chikomo@zou.ac.zw');
  const dir = await api.request('/api/users', { token: adminToken });
  const target = dir.body.users.find((u) => u.email === 'b.gwatidzo@zou.ac.zw');
  assert.ok(target);

  const removed = await api.request(`/api/users/${target.id}`, { method: 'DELETE', token: adminToken });
  assert.equal(removed.status, 200);

  const blockedLogin = await api.request('/api/auth/login', { method: 'POST', body: { email: target.email, password: 'Zou@2026' } });
  assert.equal(blockedLogin.status, 401);
  assert.equal(blockedLogin.body.error, 'Incorrect email or password.', 'a deactivated account must be indistinguishable from a wrong password');

  const restored = await api.request(`/api/users/${target.id}/restore`, { method: 'POST', token: adminToken });
  assert.equal(restored.status, 200);

  const workingLogin = await api.request('/api/auth/login', { method: 'POST', body: { email: target.email, password: 'Zou@2026' } });
  assert.equal(workingLogin.status, 200, 'restoring the account must let it sign in again with its original password');
});
