const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, client } = require('./helpers');

let server, api, token;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
  token = (await api.login('l.chikomo@zou.ac.zw')).token;
});

after(async () => { if (server) await server.stop(); });

test('ICT administrator can be assigned to multiple users individually and in bulk', async () => {
  const directory = await api.request('/api/users', { token });
  assert.equal(directory.status, 200);

  const employees = directory.body.users.filter((user) => user.role === 'employee');
  const unitHead = directory.body.users.find((user) => user.role === 'unithead' && user.scope_type === 'unit');
  assert.ok(employees.length >= 4, 'expected at least four Employee accounts');
  assert.ok(unitHead, 'expected a Unit Head with a valid Unit scope');

  for (const employee of employees.slice(0, 2)) {
    const assigned = await api.request(`/api/users/${employee.id}/role`, {
      method: 'PATCH',
      token,
      body: { role: 'ictadmin', scopeType: 'unit', scopeId: unitHead.scope_id },
    });
    assert.equal(assigned.status, 200, assigned.body.error);
  }

  const bulk = await api.request('/api/users/assign-role', {
    method: 'POST',
    token,
    body: { userIds: employees.slice(2, 4).map((user) => user.id), role: 'ictadmin' },
  });
  assert.equal(bulk.status, 200, bulk.body.error);
  assert.equal(bulk.body.assigned, 2);
  assert.equal(bulk.body.failed, 0);

  const updatedDirectory = await api.request('/api/users', { token });
  for (const employee of employees.slice(0, 4)) {
    assert.equal(
      updatedDirectory.body.users.find((user) => user.id === employee.id)?.role,
      'ictadmin',
      `${employee.name} should hold the ICT administrator role`,
    );
  }
});
