import assert from 'node:assert/strict';
import test from 'node:test';
import { currentNav } from '../src/lib/nav.js';

test('CPU and ICT Admin can navigate to Compliance & Escalations', () => {
  const hasPerm = () => true;

  assert.ok(currentNav({ role: 'cpu' }, hasPerm).includes('compliance'));
  assert.ok(currentNav({ role: 'ictadmin' }, hasPerm).includes('compliance'));
});
