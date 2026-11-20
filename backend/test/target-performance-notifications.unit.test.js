const { test } = require('node:test');
const assert = require('node:assert/strict');
const { targetPerformanceNotificationPlan } = require('../src/utils/targetPerformanceNotifications');

const kpi = { id: 44, name: 'Student retention', owner_type: 'unit' };
const path = {
  employeeUserId: null,
  unitHeadUserId: 22,
  repUserId: 33,
  programmeHeadUserId: 44,
};
const settings = { redEscalateProgramme: 2, redEscalateVC: 4 };

test('target-performance escalation notifications reach the owner chain and institutional tier at their thresholds', () => {
  const notifications = targetPerformanceNotificationPlan(
    kpi,
    path,
    4,
    settings,
    { year: 2026, month: 11 },
    55,
  );

  assert.equal(notifications.length, 2);
  assert.deepEqual(notifications[0].recipientIds, [22, 33, 44]);
  assert.match(notifications[0].notificationKey, /2026-08-programme$/);
  assert.deepEqual(notifications[1].recipientIds, [55]);
  assert.match(notifications[1].notificationKey, /2026-08-institutional$/);
});

test('notification planning observes configured thresholds and excludes employee KPIs from institutional escalation', () => {
  assert.deepEqual(
    targetPerformanceNotificationPlan(kpi, path, 1, settings, { year: 2026, month: 11 }, 55),
    [],
  );
  assert.equal(
    targetPerformanceNotificationPlan(
      { ...kpi, owner_type: 'employee' },
      path,
      4,
      settings,
      { year: 2026, month: 11 },
      55,
    ).length,
    0,
  );
  assert.deepEqual(
    targetPerformanceNotificationPlan(kpi, { ...path, programmeHeadUserId: null }, 2, settings, { year: 2026, month: 11 }, null)[0].recipientIds,
    [22, 33],
  );
});
