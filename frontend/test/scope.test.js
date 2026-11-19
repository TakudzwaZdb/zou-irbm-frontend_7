import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManagePlanOwner,
  computeRag,
  computeVariance,
  expectedPacePct,
  institutionalRollup,
  isOwner,
  nodeOwnKpis,
  nodeRagCls,
  performanceRollup,
  scopeBreadcrumb,
  varianceRollup,
} from '../src/lib/scope.js';
import { latestInRange } from '../src/lib/period.js';

const settings = { ragGreen: 80, ragAmber: 50 };
const kpi = { id: 1, baseline: 0, target: 100 };

test('scope breadcrumb uses the assigned scope for custom and non-canonical roles', () => {
  const org = {
    programmes: [{ id: 10, name: 'Programme A' }],
    subs: [{ id: 20, name: 'Sub-programme A', programme_id: 10 }],
    units: [{ id: 30, name: 'Unit A', kind: 'Department', sub_id: 20 }],
    employees: [],
  };
  const expected = ['Programme A', 'Sub-programme A', 'Department: Unit A'];

  assert.deepEqual(scopeBreadcrumb(org, { role: 'auditor', scope_type: 'unit', scope_id: 30 }), expected);
  assert.deepEqual(scopeBreadcrumb(org, { role: 'programme', scope_type: 'unit', scope_id: 30 }), expected);
  assert.equal(scopeBreadcrumb(org, { role: 'auditor', scope_type: null, scope_id: null }), null);
});

test('submission permission allows a scoped manager to submit only matching KPI ownership', () => {
  const user = {
    role: 'manager',
    scope_type: 'unit',
    scope_id: 30,
    permissions: ['submit_data_entries'],
  };

  assert.equal(isOwner(user, { owner_type: 'unit', owner_id: 30 }), true);
  assert.equal(isOwner(user, { owner_type: 'unit', owner_id: 31 }), false);
  assert.equal(isOwner(user, { owner_type: 'sub', owner_id: 20 }), false);
  assert.equal(isOwner({ ...user, permissions: [] }, { owner_type: 'unit', owner_id: 30 }), false);
});

test('planning controls match scoped plan ownership and keep employee scopes read-only', () => {
  const manager = {
    role: 'manager',
    scope_type: 'unit',
    scope_id: 30,
    permissions: ['submit_plan_budget'],
  };

  assert.equal(canManagePlanOwner(manager, 'unit', 30), true);
  assert.equal(canManagePlanOwner(manager, 'unit', 31), false);
  assert.equal(canManagePlanOwner({ ...manager, scope_type: 'employee' }, 'unit', 30), false);
  assert.equal(canManagePlanOwner({ ...manager, permissions: [] }, 'unit', 30), false);
});

test('RAG thresholds use unrounded progress', () => {
  const result = computeRag(kpi, { value: 79.6 }, settings);

  assert.equal(result.pct, 79.6);
  assert.equal(result.cls, 'chip-rag-amber');
});

test('equal baseline and target do not invent progress when unmet and respect lower direction', () => {
  assert.equal(computeRag({ baseline: 5, target: 5 }, { value: 4 }, settings).rawPct, null);
  assert.equal(computeRag({ baseline: 5, target: 5, measurement_direction: 'lower' }, { value: 5 }, settings).rawPct, 100);
  assert.equal(computeRag({ baseline: 5, target: 5, measurement_direction: 'lower' }, { value: 6 }, settings).rawPct, null);
});

test('fractional shortfalls are behind pace and retain full-precision variance', () => {
  const result = computeVariance(kpi, { value: 49.6, month: 6 }, settings);

  assert.equal(result.expectedPct, 50);
  assert.equal(result.variance, -0.4);
  assert.equal(result.flag, 'behind');
});

test('submitted snapshot preview is scored as the actual, not added to the baseline', () => {
  const screenshotKpi = { id: 5, baseline: 15, target: 25 };
  const pending = { value: 34, override_value: 35, preview_value: 19, status: 'submitted', month: 11 };

  assert.equal(computeRag(screenshotKpi, pending, settings).pct, 40);
  const latest = latestInRange([pending]);
  assert.equal(latest, null, 'Overview must not include a first-time submission before CPU approval');
});

test('Overview keeps the last approved actual while an amendment awaits CPU approval', () => {
  const screenshotKpi = { id: 5, baseline: 15, target: 25 };
  const amended = {
    value: 18,
    preview_value: 19,
    entered_value: 19,
    status: 'submitted',
    approved_at: '2026-10-25T12:00:00Z',
    month: 11,
  };
  const latest = latestInRange([amended]);

  assert.equal(latest.value, 18);
  assert.equal(latest.preview_value, null);
  assert.equal(computeRag(screenshotKpi, latest, settings).pct, 30);
});

test('Overview recalculates score and pace from a CPU-approved actual', () => {
  const screenshotKpi = { id: 5, baseline: 15, target: 25 };
  const approved = { value: 19, status: 'approved', approved_at: '2026-11-17T09:00:00Z', month: 11 };
  const latest = latestInRange([approved]);
  const variance = computeVariance(screenshotKpi, latest, settings);

  assert.equal(computeRag(screenshotKpi, latest, settings).pct, 40);
  assert.equal(variance.expectedPct, 91.7);
  assert.equal(variance.variance, -51.7);
  assert.equal(variance.flag, 'attention');
});

test('expected monthly pace is not rounded before comparison', () => {
  const result = computeVariance(kpi, { value: 8.3, month: 1 }, settings);

  assert.ok(Math.abs(expectedPacePct(1) - 100 / 12) < Number.EPSILON * 10);
  assert.equal(result.flag, 'behind');
});

test('tier rollups preserve precise progress and RAG classifications', () => {
  const org = {
    programmes: [{ id: 10 }],
    subs: [{ id: 20, programme_id: 10 }],
    units: [{ id: 30, sub_id: 20 }],
    employees: [{ id: 40, unit_id: 30 }],
  };
  const employeeKpi = { ...kpi, id: 2, owner_type: 'employee', owner_id: 40 };
  const kpis = [employeeKpi];
  const programmeKpis = nodeOwnKpis(org, kpis, 'programme', 10);
  const rollup = performanceRollup(programmeKpis, { 2: { value: 49.9 } }, settings);

  assert.equal(rollup.avgPct, 49.9);
  assert.equal(rollup.counts.red, 1);
  assert.equal(nodeRagCls(rollup, settings), 'chip-rag-red');
});

test('institutional average gives each Programme equal weight', () => {
  const org = {
    programmes: [{ id: 10 }, { id: 20 }],
    subs: [{ id: 11, programme_id: 10 }, { id: 21, programme_id: 20 }],
    units: [],
    employees: [],
  };
  const kpis = [
    { ...kpi, id: 1, owner_type: 'sub', owner_id: 11 },
    { ...kpi, id: 2, owner_type: 'sub', owner_id: 21 },
    { ...kpi, id: 3, owner_type: 'sub', owner_id: 21 },
    { ...kpi, id: 4, owner_type: 'sub', owner_id: 21 },
  ];
  const values = {
    1: { value: 0 },
    2: { value: 100 },
    3: { value: 100 },
    4: { value: 100 },
  };
  const institutional = institutionalRollup(org, kpis, values, settings).performance;

  assert.equal(performanceRollup(kpis, values, settings).avgPct, 75);
  assert.equal(institutional.avgPct, 50);
  assert.equal(institutional.count, 4);
  assert.equal(institutional.counts.green, 3);
  assert.equal(institutional.counts.red, 1);
});

test('variance rollups average exact results before display rounding', () => {
  const rows = varianceRollup(
    [{ ...kpi, id: 3 }, { ...kpi, id: 4 }],
    { 3: { value: 49.9, month: 6 }, 4: { value: 50, month: 6 } },
    settings
  );

  assert.equal(rows.items[0].flag, 'behind');
  assert.ok(rows.avgRawVariance < 0);
});
