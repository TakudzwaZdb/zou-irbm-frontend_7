import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingKpisInScope } from '../src/lib/performanceKpis.js';

test('pending KPI configurations appear under their owning scope without crossing branches', () => {
  const nodes = [
    { key: 'university:0', parentKey: null },
    { key: 'programme:1', parentKey: 'university:0' },
    { key: 'sub:2', parentKey: 'programme:1' },
    { key: 'unit:3', parentKey: 'sub:2' },
    { key: 'employee:4', parentKey: 'unit:3' },
    { key: 'programme:5', parentKey: 'university:0' },
    { key: 'unit:6', parentKey: 'programme:5' },
  ];
  const kpis = [
    { id: 1, name: 'Sub draft', owner_type: 'sub', owner_id: 2, lifecycle_status: 'draft' },
    { id: 2, name: 'Unit submitted', owner_type: 'unit', owner_id: 3, lifecycle_status: 'submitted' },
    { id: 3, name: 'Employee rejected', owner_type: 'employee', owner_id: 4, lifecycle_status: 'rejected' },
    { id: 4, name: 'Other branch', owner_type: 'unit', owner_id: 6, lifecycle_status: 'draft' },
    { id: 5, name: 'Already active', owner_type: 'unit', owner_id: 3, lifecycle_status: 'active' },
  ];

  assert.deepEqual(
    pendingKpisInScope(kpis, nodes, 'programme:1').map((kpi) => kpi.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    pendingKpisInScope(kpis, nodes, 'programme:1', 'unit:3').map((kpi) => kpi.id),
    [2, 3],
  );
});
