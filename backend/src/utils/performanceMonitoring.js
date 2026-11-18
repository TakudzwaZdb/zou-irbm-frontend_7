const db = require('../db');
const {
  calculatePerformanceAgainstTarget,
  calculateBaselineProgress,
  classifyProgressVariance,
} = require('./performanceAgainstTarget');
const { consecutiveRedStreak } = require('./compliance');
const { createPerformanceNotification } = require('./performanceNotifications');

const DAY_MS = 86400000;
const MONITOR_LOCK_ID = 7820142026;

async function loadSettings() {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const values = {};
  rows.forEach((row) => { values[row.key] = Number(row.value); });
  const configured = (key, fallback) => Number.isFinite(values[key]) ? values[key] : fallback;
  return {
    ragAmber: configured('ragAmber', 50),
    lateCutoffEmployee: configured('lateCutoffEmployee', 3),
    lateCutoffUnit: configured('lateCutoffUnit', 5),
    lateCutoffSub: configured('lateCutoffSub', 7),
    escalateProgramme: configured('escalateProgramme', 6),
    escalateVC: configured('escalateVC', 11),
    redEscalateProgramme: configured('redEscalateProgramme', 2),
    redEscalateVC: configured('redEscalateVC', 4),
    alertWarningGap: configured('alertWarningGap', 10),
    alertCriticalGap: configured('alertCriticalGap', 25),
  };
}

function periodDueAt(year, month, cutoffDays) {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59) + cutoffDays * DAY_MS);
}

function utcSqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function ownerPath(kpi) {
  let subId = null;
  let unitId = null;
  let employeeUserId = null;
  let repUserId = null;
  let unitHeadUserId = null;

  if (kpi.owner_type === 'sub') {
    subId = kpi.owner_id;
  } else if (kpi.owner_type === 'unit') {
    unitId = kpi.owner_id;
  } else {
    const employee = await db.prepare('SELECT unit_id, user_id FROM employees WHERE id = ?').get(kpi.owner_id);
    if (employee) {
      unitId = employee.unit_id;
      employeeUserId = employee.user_id;
    }
  }
  if (unitId != null) {
    const unit = await db.prepare('SELECT sub_id, head_user_id FROM units WHERE id = ?').get(unitId);
    if (unit) {
      subId = unit.sub_id;
      unitHeadUserId = unit.head_user_id;
    }
  }
  if (subId == null) return { employeeUserId, unitHeadUserId, repUserId, programmeHeadUserId: null };
  const sub = await db.prepare('SELECT programme_id, rep_user_id FROM subs WHERE id = ?').get(subId);
  if (!sub) return { employeeUserId, unitHeadUserId, repUserId, programmeHeadUserId: null };
  repUserId = sub.rep_user_id;
  const programme = await db.prepare('SELECT head_user_id FROM programmes WHERE id = ?').get(sub.programme_id);
  return { employeeUserId, unitHeadUserId, repUserId, programmeHeadUserId: programme?.head_user_id ?? null };
}

async function recipientsFor(ids) {
  const uniqueIds = [...new Set(ids.filter((id) => id != null).map(Number))];
  if (!uniqueIds.length) return [];
  const placeholders = uniqueIds.map((_, index) => `$${index + 1}`).join(', ');
  return db.pool.query(
    `SELECT id, name, email FROM users WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    uniqueIds
  ).then((result) => result.rows);
}

async function notifyUsers(ids, alert, escalation, keySuffix, subject, body) {
  const recipients = await recipientsFor(ids);
  for (const recipient of recipients) {
    // eslint-disable-next-line no-await-in-loop
    await createPerformanceNotification({
      recipientId: recipient.id,
      alertId: alert?.id ?? null,
      escalationId: escalation?.id ?? null,
      notificationKey: `${keySuffix}:user-${recipient.id}`,
      subject,
      body,
    });
  }
}

async function ensureEscalation(alert, kpi, path, level, reason, now) {
  const assignedTo = level === 1
    ? path.programmeHeadUserId || path.repUserId || path.unitHeadUserId
    : (await db.prepare("SELECT id FROM users WHERE role = 'vc' AND deleted_at IS NULL ORDER BY id LIMIT 1").get())?.id
      || (await db.prepare("SELECT id FROM users WHERE role = 'cpu' AND deleted_at IS NULL ORDER BY id LIMIT 1").get())?.id;
  const responseDueAt = new Date(now.getTime() + (level === 1 ? 5 : 2) * DAY_MS);
  const existing = await db.prepare(
    'SELECT * FROM performance_escalations WHERE alert_id = ? AND level = ?'
  ).get(alert.id, level);
  let escalation = existing;
  let eventChanged = false;
  if (existing) {
    const detectedAt = new Date(`${alert.detected_at.replace(' ', 'T')}Z`);
    const updatedAt = new Date(`${existing.updated_at.replace(' ', 'T')}Z`);
    if (['resolved', 'closed'].includes(existing.status) && detectedAt > updatedAt) {
      await db.prepare(
        `UPDATE performance_escalations SET status = 'open', assigned_to = ?, reason = ?, evidence = ?,
         response_due_at = ?, resolution = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?`
      ).run(
        assignedTo ?? null,
        reason,
        `KPI ${kpi.name}; ${alert.year}-${String(alert.month).padStart(2, '0')}; severity ${alert.severity}.`,
        utcSqlDate(responseDueAt),
        utcSqlDate(now),
        existing.id
      );
      escalation = { ...existing, status: 'open', assigned_to: assignedTo };
      eventChanged = true;
    }
  } else {
    escalation = await db.prepare(
      `INSERT INTO performance_escalations
         (alert_id, level, reference_code, assigned_to, reason, evidence, response_due_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(alert_id, level) DO NOTHING
       RETURNING id, reference_code, status, assigned_to, created_at`
    ).get(
      alert.id,
      level,
      `ESC-${alert.id}-L${level}`,
      assignedTo ?? null,
      reason,
      `KPI ${kpi.name}; ${alert.year}-${String(alert.month).padStart(2, '0')}; severity ${alert.severity}.`,
      utcSqlDate(responseDueAt)
    );
    eventChanged = !!escalation;
  }
  if (!escalation || !eventChanged) return escalation;
  await db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (NULL, ?, ?, ?, ?)'
  ).run(`escalate_level_${level}`, 'performance_escalation', escalation.id, `${escalation.reference_code}: ${reason}`);
  if (escalation) {
    await notifyUsers(
      [escalation.assigned_to],
      alert,
      escalation,
      `escalation-${escalation.id}-${alert.detected_at}`,
      `Performance escalation ${escalation.reference_code}`,
      reason
    );
  }
  return escalation;
}

async function processEscalations(alert, kpi, path, settings, now, dueAt) {
  let levelOneReason = null;
  let levelTwoReason = null;
  if (alert.severity === 'missing') {
    const daysLate = Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS));
    if (daysLate >= settings.escalateProgramme) levelOneReason = `No approved actual was reported; submission is ${daysLate} days overdue.`;
    if (daysLate >= settings.escalateVC) levelTwoReason = `No approved actual was reported; submission is ${daysLate} days overdue.`;
  } else {
    const history = await db.prepare(
      'SELECT * FROM kpi_values WHERE kpi_id = ? AND (year < ? OR (year = ? AND month <= ?)) ORDER BY year DESC, month DESC'
    ).all(kpi.id, alert.year, alert.year, alert.month);
    const streak = consecutiveRedStreak(history, kpi, settings.ragAmber);
    if (streak >= settings.redEscalateProgramme) levelOneReason = `KPI has remained below the configured baseline-progress threshold for ${streak} consecutive reporting periods.`;
    if (streak >= settings.redEscalateVC) levelTwoReason = `KPI has remained below the configured baseline-progress threshold for ${streak} consecutive reporting periods.`;
  }

  if (levelOneReason) await ensureEscalation(alert, kpi, path, 1, levelOneReason, now);
  if (levelTwoReason) await ensureEscalation(alert, kpi, path, 2, levelTwoReason, now);
}

async function evaluateKpiPeriod(kpi, year, month, now, settings) {
  const valueRow = await db.prepare(
    'SELECT * FROM kpi_values WHERE kpi_id = ? AND year = ? AND month = ?'
  ).get(kpi.id, year, month);
  const isOfficial = valueRow && (valueRow.status === 'approved' || valueRow.approved_at != null);
  const actual = isOfficial
    ? valueRow.override_value != null ? Number(valueRow.override_value) : valueRow.value == null ? null : Number(valueRow.value)
    : null;
  const expectedProgress = (month / 12) * 100;
  const progress = calculateBaselineProgress(kpi, actual);
  const targetResult = calculatePerformanceAgainstTarget(kpi, actual);
  const cutoff = kpi.owner_type === 'employee'
    ? settings.lateCutoffEmployee
    : kpi.owner_type === 'unit' ? settings.lateCutoffUnit : settings.lateCutoffSub;
  const dueAt = periodDueAt(year, month, cutoff);
  let severity = null;
  let variance = null;
  let details = null;

  if (actual == null) {
    if (now > dueAt) {
      severity = 'missing';
      details = `No approved actual performance was reported by ${utcSqlDate(dueAt)}.`;
    }
  } else if (progress != null) {
    const classification = classifyProgressVariance(progress, expectedProgress, settings.alertWarningGap, settings.alertCriticalGap);
    variance = classification.variance;
    severity = classification.severity;
    if (severity) {
      details = `Baseline progress is ${progress.toFixed(1)}%, versus ${expectedProgress.toFixed(1)}% expected (${variance.toFixed(1)} percentage points).`;
    }
  }

  const existing = await db.prepare(
    'SELECT id, severity, status, detected_at, actual, baseline_progress, target_performance FROM performance_alerts WHERE kpi_id = ? AND year = ? AND month = ?'
  ).get(kpi.id, year, month);
  if (!severity) {
    if (existing && existing.status !== 'resolved') {
      await db.prepare(
        "UPDATE performance_alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ?"
      ).run(utcSqlDate(now), utcSqlDate(now), existing.id);
      await db.prepare(
        'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (NULL, ?, ?, ?, ?)'
      ).run('resolve_performance_alert', 'performance_alert', existing.id, `Alert cleared for ${year}-${String(month).padStart(2, '0')}.`);
    }
    return;
  }

  const sameValue = (left, right) => left == null && right == null || Number(left) === Number(right);
  const metricsChanged = existing && (
    existing.severity !== severity
    || !sameValue(existing.actual, actual)
    || !sameValue(existing.baseline_progress, progress)
    || !sameValue(existing.target_performance, targetResult.performancePct)
  );
  if (existing?.status === 'resolved' && !metricsChanged) return;

  const alert = await db.prepare(
    `INSERT INTO performance_alerts
       (kpi_id, year, month, severity, status, actual, target, baseline_progress, target_performance, expected_progress, variance, details)
     VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kpi_id, year, month) DO UPDATE SET
       severity = excluded.severity,
       status = CASE WHEN performance_alerts.status = 'resolved' THEN 'open' ELSE performance_alerts.status END,
       actual = excluded.actual,
       target = excluded.target,
       baseline_progress = excluded.baseline_progress,
       target_performance = excluded.target_performance,
       expected_progress = excluded.expected_progress,
       variance = excluded.variance,
       details = excluded.details,
       detected_at = CASE WHEN performance_alerts.status = 'resolved' THEN excluded.detected_at ELSE performance_alerts.detected_at END,
       updated_at = excluded.updated_at,
       resolved_at = NULL
     RETURNING id, severity, status, detected_at`
  ).get(
    kpi.id, year, month, severity, actual, Number(kpi.target), progress,
    targetResult.performancePct, expectedProgress, variance, details
  );

  const isNewEvent = !existing || existing.status === 'resolved' || existing.severity !== severity || metricsChanged;
  if (isNewEvent) {
    const path = await ownerPath(kpi);
    const recipients = [path.employeeUserId, path.unitHeadUserId, path.repUserId, path.programmeHeadUserId];
    await notifyUsers(
      recipients,
      alert,
      null,
      `alert-${alert.id}-${severity}-${alert.detected_at}`,
      `${severity === 'missing' ? 'Missing submission' : 'Performance alert'}: ${kpi.name}`,
      `${kpi.name} (${year}-${String(month).padStart(2, '0')}): ${details}`
    );
    if (existing) {
      await db.prepare(
        'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (NULL, ?, ?, ?, ?)'
      ).run('update_performance_alert', 'performance_alert', alert.id, `${existing.severity} to ${severity}: ${details}`);
    } else {
      await db.prepare(
        'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (NULL, ?, ?, ?, ?)'
      ).run('create_performance_alert', 'performance_alert', alert.id, `${severity}: ${details}`);
    }
  }

  const path = await ownerPath(kpi);
  await processEscalations(alert, kpi, path, settings, now, dueAt);
}

async function refreshKpiPeriod(kpiId, year, month, now = new Date()) {
  const kpi = await db.prepare('SELECT * FROM kpis WHERE id = ? AND deleted_at IS NULL').get(kpiId);
  if (!kpi || !['sub', 'unit', 'employee'].includes(kpi.owner_type)) return;
  const settings = await loadSettings();
  await evaluateKpiPeriod(kpi, Number(year), Number(month), now, settings);
}

async function runPerformanceMonitoring(now = new Date()) {
  const lockClient = await db.pool.connect();
  let acquired = false;
  try {
    const lockResult = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [MONITOR_LOCK_ID]);
    acquired = lockResult.rows[0]?.locked === true;
    if (!acquired) return;

    const settings = await loadSettings();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const previous = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    const periods = [
      { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1 },
      { year: currentYear, month: currentMonth },
    ];
    const kpis = await db.prepare(
      "SELECT * FROM kpis WHERE owner_type IN ('sub','unit','employee') AND deleted_at IS NULL ORDER BY id"
    ).all();
    for (const period of periods) {
      for (const kpi of kpis) {
        // eslint-disable-next-line no-await-in-loop
        await evaluateKpiPeriod(kpi, period.year, period.month, now, settings);
      }
    }
  } finally {
    if (acquired) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [MONITOR_LOCK_ID]);
      } finally {
        lockClient.release();
      }
    } else {
      lockClient.release();
    }
  }
}

module.exports = { runPerformanceMonitoring, refreshKpiPeriod, periodDueAt };
