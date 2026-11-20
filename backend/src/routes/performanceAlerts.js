const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm, requireAnyPerm } = require('../middleware/auth');
const { canReadKpi } = require('../utils/scope');
const { appendAlertOwnerFilter } = require('../utils/performanceAlertFilters');
const { correctiveActionPermissionError } = require('../utils/performanceAlertPermissions');
const { createPerformanceNotification } = require('../utils/performanceNotifications');

const router = express.Router();
router.use(requireAuth);

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getVisibleAlert(req, res, alertId) {
  const id = positiveId(alertId);
  if (id == null) {
    res.status(400).json({ error: 'Alert id must be a positive integer.' });
    return null;
  }
  const alert = await db.prepare(
    `SELECT a.*, k.name AS kpi_name, k.owner_type, k.owner_id, k.measure, k.weight,
            p.name AS programme_name, s.name AS sub_name, u.name AS unit_name, e.name AS employee_name,
            CASE k.owner_type
              WHEN 'university' THEN 'University'
              WHEN 'programme' THEN p.name
              WHEN 'sub' THEN s.name
              WHEN 'unit' THEN u.name
              WHEN 'employee' THEN e.name
            END AS owner_name
     FROM performance_alerts a
     JOIN kpis k ON k.id = a.kpi_id
     LEFT JOIN employees e ON k.owner_type = 'employee' AND e.id = k.owner_id
     LEFT JOIN units u ON (k.owner_type = 'unit' AND u.id = k.owner_id)
                       OR (k.owner_type = 'employee' AND u.id = e.unit_id)
     LEFT JOIN subs s ON (k.owner_type = 'sub' AND s.id = k.owner_id)
                       OR (k.owner_type = 'unit' AND s.id = u.sub_id)
                       OR (k.owner_type = 'employee' AND s.id = u.sub_id)
     LEFT JOIN programmes p ON (k.owner_type = 'programme' AND p.id = k.owner_id) OR p.id = s.programme_id
     WHERE a.id = ? AND k.deleted_at IS NULL`
  ).get(id);
  if (!alert) {
    res.status(404).json({ error: 'Performance alert not found.' });
    return null;
  }
  if (!await canReadKpi(req.user, { id: alert.kpi_id, owner_type: alert.owner_type, owner_id: alert.owner_id })) {
    res.status(403).json({ error: 'This alert is outside your organisational scope.' });
    return null;
  }
  return alert;
}

async function audit(userId, action, entity, entityId, detail) {
  await db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, action, entity, entityId, detail);
}

async function notifyAlertUsers(userIds, alert, eventKey, subject, body, escalationId = null, excludeUserId = null) {
  const recipients = [...new Set(userIds.filter((id) => id != null && id !== excludeUserId))];
  for (const recipientId of recipients) {
    // eslint-disable-next-line no-await-in-loop
    await createPerformanceNotification({
      recipientId,
      alertId: alert.id,
      escalationId,
      notificationKey: `${eventKey}:user-${recipientId}`,
      subject,
      body,
    });
  }
}

async function correctiveActionReviewers(alert, excludeUserId) {
  const result = await db.pool.query(
    `SELECT DISTINCT u.id, u.role, u.scope_type, u.scope_id
     FROM users u
     WHERE u.deleted_at IS NULL
       AND u.id <> $1
       AND (
         EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id AND up.permission_key = 'approve_corrective_actions')
         OR EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_key = u.role AND rp.permission_key = 'approve_corrective_actions')
       )
       AND (
         EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id AND up.permission_key = 'view_performance_alerts')
         OR EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_key = u.role AND rp.permission_key = 'view_performance_alerts')
       )
     ORDER BY u.id`,
    [excludeUserId]
  );
  const reviewers = [];
  for (const reviewer of result.rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await canReadKpi(reviewer, { id: alert.kpi_id, owner_type: alert.owner_type, owner_id: alert.owner_id })) {
      reviewers.push(reviewer.id);
    }
  }
  return reviewers;
}

async function scopedAssignees(alert) {
  const ids = [];
  let unitId = null;
  let subId = null;
  if (alert.owner_type === 'sub') subId = alert.owner_id;
  else if (alert.owner_type === 'unit') unitId = alert.owner_id;
  else {
    const employee = await db.prepare('SELECT unit_id, user_id FROM employees WHERE id = ?').get(alert.owner_id);
    if (employee) {
      unitId = employee.unit_id;
      if (employee.user_id != null) ids.push(employee.user_id);
    }
  }
  if (unitId != null) {
    const unit = await db.prepare('SELECT sub_id, head_user_id FROM units WHERE id = ?').get(unitId);
    if (unit) {
      subId = unit.sub_id;
      if (unit.head_user_id != null) ids.push(unit.head_user_id);
    }
  }
  if (subId != null) {
    const sub = await db.prepare('SELECT programme_id, rep_user_id FROM subs WHERE id = ?').get(subId);
    if (sub) {
      if (sub.rep_user_id != null) ids.push(sub.rep_user_id);
      const programme = await db.prepare('SELECT head_user_id FROM programmes WHERE id = ?').get(sub.programme_id);
      if (programme?.head_user_id != null) ids.push(programme.head_user_id);
    }
  }
  const leaders = await db.prepare(
    "SELECT id FROM users WHERE role IN ('vc','cpu') AND deleted_at IS NULL"
  ).all();
  ids.push(...leaders.map((user) => user.id));
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const marks = uniqueIds.map((_, index) => `$${index + 1}`).join(', ');
  const result = await db.pool.query(
    `SELECT id, name, title, role FROM users WHERE id IN (${marks}) AND deleted_at IS NULL ORDER BY name`,
    uniqueIds
  );
  return result.rows;
}

router.get('/', requirePerm('view_performance_alerts'), async (req, res) => {
  const year = Number(req.query.year) || new Date().getUTCFullYear();
  const month = Number(req.query.month) || new Date().getUTCMonth() + 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'A valid reporting year and month are required.' });
  }
  const status = req.query.status ? String(req.query.status) : null;
  if (status && !['open', 'acknowledged', 'action_planned', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid alert status filter.' });
  }
  const ownerType = req.query.ownerType ? String(req.query.ownerType) : null;
  const ownerId = req.query.ownerId == null || req.query.ownerId === '' ? null : Number(req.query.ownerId);
  if (ownerType && !['programme', 'sub', 'unit', 'employee'].includes(ownerType)) {
    return res.status(400).json({ error: 'Invalid organisational tier filter.' });
  }
  if (ownerId != null && (!Number.isInteger(ownerId) || ownerId < 1 || !ownerType)) {
    return res.status(400).json({ error: 'An organisational unit filter must be a positive id with a tier selected.' });
  }
  const params = [year, month];
  let filterSql = '';
  if (status) {
    params.push(status);
    filterSql += ` AND a.status = $${params.length}`;
  }
  if (ownerType === 'programme' && ownerId == null) {
    return res.status(400).json({ error: 'Select a Programme to filter its alerts.' });
  }
  filterSql += appendAlertOwnerFilter(ownerType, ownerId, params);
  const result = await db.pool.query(
    `SELECT a.*, k.name AS kpi_name, k.owner_type, k.owner_id, k.measure, k.weight,
            p.name AS programme_name, s.name AS sub_name, u.name AS unit_name, e.name AS employee_name,
            CASE k.owner_type
              WHEN 'university' THEN 'University'
              WHEN 'programme' THEN p.name
              WHEN 'sub' THEN s.name
              WHEN 'unit' THEN u.name
              WHEN 'employee' THEN e.name
            END AS owner_name
     FROM performance_alerts a
     JOIN kpis k ON k.id = a.kpi_id
     LEFT JOIN employees e ON k.owner_type = 'employee' AND e.id = k.owner_id
     LEFT JOIN units u ON (k.owner_type = 'unit' AND u.id = k.owner_id)
                       OR (k.owner_type = 'employee' AND u.id = e.unit_id)
     LEFT JOIN subs s ON (k.owner_type = 'sub' AND s.id = k.owner_id)
                       OR (k.owner_type = 'unit' AND s.id = u.sub_id)
                       OR (k.owner_type = 'employee' AND s.id = u.sub_id)
     LEFT JOIN programmes p ON (k.owner_type = 'programme' AND p.id = k.owner_id) OR p.id = s.programme_id
     WHERE a.year = $1 AND a.month = $2 AND k.deleted_at IS NULL ${filterSql}
     ORDER BY CASE a.severity WHEN 'red' THEN 0 WHEN 'missing' THEN 1 ELSE 2 END, a.updated_at DESC`,
    params
  );
  const alerts = [];
  for (const alert of result.rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await canReadKpi(req.user, { id: alert.kpi_id, owner_type: alert.owner_type, owner_id: alert.owner_id })) alerts.push(alert);
  }
  const ids = alerts.map((alert) => alert.id);
  let escalations = [];
  let actions = [];
  let reviewerCandidates = [];
  if (ids.length) {
    const marks = ids.map((_, index) => `$${index + 1}`).join(', ');
    [escalations, actions, reviewerCandidates] = await Promise.all([
      db.pool.query(
        `SELECT pe.*, u.name AS assigned_name FROM performance_escalations pe
         LEFT JOIN users u ON u.id = pe.assigned_to
         WHERE pe.alert_id IN (${marks}) ORDER BY pe.created_at DESC`,
        ids
      ).then((r) => r.rows),
      db.pool.query(
        `SELECT ca.*, responsible.name AS responsible_name, responsible.title AS responsible_title,
                responsible.role AS responsible_role, creator.name AS creator_name
         FROM corrective_action_plans ca
         LEFT JOIN users responsible ON responsible.id = ca.responsible_user_id
         LEFT JOIN users creator ON creator.id = ca.created_by
         WHERE ca.alert_id IN (${marks}) ORDER BY ca.due_date, ca.id`,
        ids
      ).then((r) => r.rows),
      db.pool.query(
        `SELECT DISTINCT u.id, u.name, u.title, u.role, u.scope_type, u.scope_id,
                COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(e.role_title), ''),
                  CASE u.role
                    WHEN 'cpu' THEN 'Corporate Planning Unit reviewer'
                    WHEN 'vc' THEN 'Vice-Chancellor'
                    WHEN 'exec' THEN 'Executive reviewer'
                    WHEN 'rep' THEN 'Sub-programme representative'
                    WHEN 'unithead' THEN 'Department / Unit Head'
                    WHEN 'programme' THEN 'Programme Head'
                    WHEN 'ictadmin' THEN 'ICT Systems Administrator'
                    WHEN 'council' THEN 'University Council reviewer'
                    ELSE u.role
                  END) AS designation,
                COALESCE(unit.name, sub.name, programme.name, employee_unit.name,
                  CASE u.role WHEN 'cpu' THEN 'Corporate Planning Unit' ELSE NULL END) AS department
         FROM users u
         LEFT JOIN employees e ON u.scope_type = 'employee' AND e.id = u.scope_id
         LEFT JOIN units unit ON u.scope_type = 'unit' AND unit.id = u.scope_id
         LEFT JOIN units employee_unit ON employee_unit.id = e.unit_id
         LEFT JOIN subs sub ON u.scope_type = 'sub' AND sub.id = u.scope_id
         LEFT JOIN programmes programme ON u.scope_type = 'programme' AND programme.id = u.scope_id
         WHERE u.deleted_at IS NULL
           AND (
             EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id AND up.permission_key = 'approve_corrective_actions')
             OR EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_key = u.role AND rp.permission_key = 'approve_corrective_actions')
           )
         ORDER BY u.name`
      ).then((r) => r.rows),
    ]);
  }
  const escalationsByAlert = new Map();
  escalations.forEach((item) => {
    const group = escalationsByAlert.get(item.alert_id) || [];
    group.push(item);
    escalationsByAlert.set(item.alert_id, group);
  });
  const actionsByAlert = new Map();
  actions.forEach((item) => {
    const group = actionsByAlert.get(item.alert_id) || [];
    group.push(item);
    actionsByAlert.set(item.alert_id, group);
  });
  const decoratedAlerts = [];
  for (const alert of alerts) {
    const reviewers = [];
    for (const reviewer of reviewerCandidates) {
      // eslint-disable-next-line no-await-in-loop
      if (await canReadKpi(reviewer, alert)) {
        reviewers.push({
          id: reviewer.id,
          name: reviewer.name,
          designation: reviewer.designation,
          department: reviewer.department,
        });
      }
    }
    const correctiveActions = (actionsByAlert.get(alert.id) || []).map((action) => ({
      ...action,
      reviewers: reviewers.filter((reviewer) => reviewer.id !== action.created_by),
    }));
    decoratedAlerts.push({
      ...alert,
      escalations: escalationsByAlert.get(alert.id) || [],
      correctiveActions,
    });
  }
  const summary = decoratedAlerts.reduce((counts, alert) => {
    counts.total += 1;
    counts[alert.severity] += 1;
    counts[alert.status] += 1;
    return counts;
  }, { total: 0, red: 0, amber: 0, missing: 0, open: 0, acknowledged: 0, action_planned: 0, resolved: 0 });
  res.json({ period: { year, month }, summary, alerts: decoratedAlerts });
});

router.get('/:id/assignees', requirePerm('view_performance_alerts'), async (req, res) => {
  const alert = await getVisibleAlert(req, res, req.params.id);
  if (!alert) return;
  res.json({ users: await scopedAssignees(alert) });
});

router.get('/notifications', requirePerm('view_performance_alerts'), async (req, res) => {
  const notifications = await db.prepare(
    `SELECT id, alert_id, escalation_id, subject, body, created_at, read_at
     FROM performance_notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 50`
  ).all(req.user.id);
  res.json({ notifications });
});

router.patch('/notifications/read-all', requirePerm('view_performance_alerts'), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(positiveId).filter((id) => id != null))] : [];
  if (!ids.length || ids.length > 50) return res.status(400).json({ error: 'Provide between 1 and 50 notification ids.' });
  const marks = ids.map((_, index) => `$${index + 2}`).join(', ');
  const result = await db.pool.query(
    `UPDATE performance_notifications SET read_at = COALESCE(read_at, to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'))
     WHERE recipient_id = $1 AND id IN (${marks})`,
    [req.user.id, ...ids]
  );
  res.json({ updated: result.rowCount });
});

router.patch('/notifications/:id/read', requirePerm('view_performance_alerts'), async (req, res) => {
  const id = positiveId(req.params.id);
  if (id == null) return res.status(400).json({ error: 'Notification id must be a positive integer.' });
  const readAt = req.body?.read === false ? null : "datetime('now')";
  const result = readAt == null
    ? await db.prepare('UPDATE performance_notifications SET read_at = NULL WHERE id = ? AND recipient_id = ?').run(id, req.user.id)
    : await db.prepare(
      'UPDATE performance_notifications SET read_at = COALESCE(read_at, datetime(\'now\')) WHERE id = ? AND recipient_id = ?'
    ).run(id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ ok: true });
});

router.patch('/:id/status', requirePerm('manage_performance_alerts'), async (req, res) => {
  const alert = await getVisibleAlert(req, res, req.params.id);
  if (!alert) return;
  const { status, note } = req.body || {};
  const valid = ['acknowledged', 'action_planned', 'resolved'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Choose acknowledged, action_planned, or resolved.' });
  const allowedNext = {
    open: ['acknowledged', 'action_planned', 'resolved'],
    acknowledged: ['action_planned', 'resolved'],
    action_planned: ['acknowledged', 'resolved'],
    resolved: [],
  };
  if (!allowedNext[alert.status]?.includes(status)) {
    return res.status(409).json({ error: `Cannot change a ${alert.status} alert to ${status}.` });
  }
  if (status === 'action_planned') {
    const action = await db.prepare(
      "SELECT id FROM corrective_action_plans WHERE alert_id = ? AND status NOT IN ('rejected','completed') LIMIT 1"
    ).get(alert.id);
    if (!action) return res.status(400).json({ error: 'Create a corrective action plan before marking this alert action planned.' });
  }
  if (status === 'resolved' && (!note || !String(note).trim())) {
    return res.status(400).json({ error: 'A resolution note is required.' });
  }
  await db.transaction(async () => {
    await db.prepare(
      `UPDATE performance_alerts SET status = ?, updated_at = datetime('now'),
       resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE NULL END WHERE id = ?`
    ).run(status, status, alert.id);
    await audit(req.user.id, 'change_performance_alert_status', 'performance_alert', alert.id, `${alert.status} to ${status}${note ? `: ${String(note).trim()}` : ''}`);
  })();
  res.json({ ok: true });
});

router.post('/:id/escalations', requirePerm('manage_performance_alerts'), async (req, res) => {
  const alert = await getVisibleAlert(req, res, req.params.id);
  if (!alert) return;
  const level = Number(req.body?.level);
  if (!Number.isInteger(level) || level < 1 || level > 3) return res.status(400).json({ error: 'Escalation level must be 1, 2, or 3.' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const evidence = typeof req.body?.evidence === 'string' ? req.body.evidence.trim() : null;
  if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'Provide an escalation reason between 5 and 2000 characters.' });
  let assignedTo = req.body?.assignedTo == null ? null : Number(req.body.assignedTo);
  if (assignedTo != null) {
    if (!Number.isInteger(assignedTo) || assignedTo < 1) return res.status(400).json({ error: 'Assignee id must be a positive integer.' });
    const assignedUser = await db.prepare('SELECT id, role, scope_type, scope_id FROM users WHERE id = ? AND deleted_at IS NULL').get(assignedTo);
    if (!assignedUser || !await canReadKpi(assignedUser, { id: alert.kpi_id, owner_type: alert.owner_type, owner_id: alert.owner_id })) {
      return res.status(400).json({ error: 'The assignee must be an active user with access to this KPI scope.' });
    }
  } else {
    const candidates = await scopedAssignees(alert);
    const preferredRoles = level === 1 ? ['programme', 'rep', 'unithead'] : ['vc', 'cpu'];
    assignedTo = candidates.find((candidate) => preferredRoles.includes(candidate.role))?.id ?? null;
  }
  const responseDueAt = new Date(Date.now() + (level === 1 ? 5 : 2) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  let inserted;
  await db.transaction(async () => {
    inserted = await db.prepare(
      `INSERT INTO performance_escalations
         (alert_id, level, reference_code, assigned_to, reason, evidence, response_due_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(alert_id, level) DO NOTHING
       RETURNING id`
    ).get(alert.id, level, `ESC-${alert.id}-L${level}`, assignedTo, reason, evidence, responseDueAt, req.user.id);
    if (inserted) await audit(req.user.id, 'create_performance_escalation', 'performance_escalation', inserted.id, reason);
  })();
  if (!inserted) return res.status(409).json({ error: 'An escalation already exists at this level for this alert.' });
  if (assignedTo != null) {
    await createPerformanceNotification({
      recipientId: assignedTo,
      alertId: alert.id,
      escalationId: inserted.id,
      notificationKey: `manual-escalation-${inserted.id}`,
      subject: `Escalation assigned: ${alert.kpi_name}`,
      body: `ESC-${alert.id}-L${level} · ${alert.owner_name}. ${reason}`,
    });
  }
  res.status(201).json({ escalationId: inserted.id });
});

router.patch('/escalations/:id', requirePerm('manage_performance_alerts'), async (req, res) => {
  const id = positiveId(req.params.id);
  if (id == null) return res.status(400).json({ error: 'Escalation id must be a positive integer.' });
  const escalation = await db.prepare('SELECT * FROM performance_escalations WHERE id = ?').get(id);
  if (!escalation) return res.status(404).json({ error: 'Escalation not found.' });
  const alert = await getVisibleAlert(req, res, escalation.alert_id);
  if (!alert) return;
  const { status, resolution, evidence, assignedTo } = req.body || {};
  if (!['acknowledged', 'in_progress', 'resolved', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Choose acknowledged, in_progress, resolved, or closed.' });
  }
  const escalationTransitions = {
    open: ['acknowledged', 'in_progress', 'resolved', 'closed'],
    acknowledged: ['in_progress', 'resolved', 'closed'],
    in_progress: ['acknowledged', 'resolved', 'closed'],
    resolved: [],
    closed: [],
  };
  if (!escalationTransitions[escalation.status]?.includes(status)) {
    return res.status(409).json({ error: `Cannot change a ${escalation.status} escalation to ${status}.` });
  }
  if (['resolved', 'closed'].includes(status) && (!resolution || !String(resolution).trim())) {
    return res.status(400).json({ error: 'A resolution summary is required.' });
  }
  let nextAssignee = escalation.assigned_to;
  if (assignedTo !== undefined) {
    nextAssignee = assignedTo == null ? null : Number(assignedTo);
    if (nextAssignee != null) {
      if (!Number.isInteger(nextAssignee) || nextAssignee < 1) return res.status(400).json({ error: 'Assignee id must be a positive integer.' });
      const user = await db.prepare('SELECT id, role, scope_type, scope_id FROM users WHERE id = ? AND deleted_at IS NULL').get(nextAssignee);
      if (!user || !await canReadKpi(user, { id: alert.kpi_id, owner_type: alert.owner_type, owner_id: alert.owner_id })) {
        return res.status(400).json({ error: 'The assignee must be an active user with access to this KPI scope.' });
      }
    }
  }
  await db.transaction(async () => {
    await db.prepare(
      `UPDATE performance_escalations SET status = ?, resolution = ?, evidence = ?, assigned_to = ?,
       updated_at = datetime('now'), resolved_at = CASE WHEN ? IN ('resolved','closed') THEN datetime('now') ELSE NULL END
       WHERE id = ?`
    ).run(status, resolution || escalation.resolution, evidence ?? escalation.evidence, nextAssignee, status, escalation.id);
    await audit(req.user.id, 'update_performance_escalation', 'performance_escalation', escalation.id, `${escalation.status} to ${status}${resolution ? `: ${resolution}` : ''}`);
  })();
  if (nextAssignee != null && nextAssignee !== escalation.assigned_to) {
    await createPerformanceNotification({
      recipientId: nextAssignee,
      alertId: alert.id,
      escalationId: escalation.id,
      notificationKey: `escalation-assigned-${escalation.id}-${Date.now()}`,
      subject: `Escalation assigned to you: ${alert.kpi_name}`,
      body: `${escalation.reference_code} · ${alert.owner_name}. ${escalation.reason}`,
    });
  }
  await notifyAlertUsers(
    [escalation.created_by, escalation.assigned_to],
    alert,
    `escalation-status-${escalation.id}-${status}-${Date.now()}`,
    `Escalation ${status.replace('_', ' ')}: ${alert.kpi_name}`,
    `${escalation.reference_code} · ${alert.owner_name}.${resolution ? ` Resolution: ${String(resolution).trim()}` : ''}`,
    escalation.id,
    req.user.id
  );
  res.json({ ok: true });
});

router.post('/:id/actions', requirePerm('manage_corrective_actions'), async (req, res) => {
  const alert = await getVisibleAlert(req, res, req.params.id);
  if (!alert) return;
  if (alert.status === 'resolved') return res.status(409).json({ error: 'A corrective action cannot be added to a resolved alert.' });
  const { title, rootCause, intervention, dueDate, expectedImprovement, resources, responsibleUserId, escalationId } = req.body || {};
  const fields = [title, rootCause, intervention, expectedImprovement];
  if (fields.some((value) => typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 4000)) {
    return res.status(400).json({ error: 'Title, root cause, intervention, and expected improvement are required (3 to 4000 characters each).' });
  }
  if (responsibleUserId == null || responsibleUserId === '') {
    return res.status(400).json({ error: 'Select a responsible person with a designation.' });
  }
  if (!isDate(dueDate)) return res.status(400).json({ error: 'Enter a valid due date in YYYY-MM-DD format.' });
  if (dueDate < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'The corrective action due date cannot be in the past.' });
  let responsibleId = responsibleUserId == null ? null : Number(responsibleUserId);
  if (responsibleId != null) {
    if (!Number.isInteger(responsibleId) || responsibleId < 1) return res.status(400).json({ error: 'Responsible user id must be a positive integer.' });
    const user = await db.prepare('SELECT id, role, scope_type, scope_id FROM users WHERE id = ? AND deleted_at IS NULL').get(responsibleId);
    if (!user || !await canReadKpi(user, { id: alert.kpi_id, owner_type: alert.owner_type, owner_id: alert.owner_id })) {
      return res.status(400).json({ error: 'The responsible person must be an active user with access to this KPI scope.' });
    }
  }
  let escalationRowId = null;
  if (escalationId != null) {
    if (positiveId(escalationId) == null) return res.status(400).json({ error: 'Escalation id must be a positive integer.' });
    const escalation = await db.prepare('SELECT id, alert_id FROM performance_escalations WHERE id = ?').get(escalationId);
    if (!escalation || escalation.alert_id !== alert.id) return res.status(400).json({ error: 'Choose an escalation belonging to this alert.' });
    escalationRowId = escalation.id;
  }
  let inserted;
  await db.transaction(async () => {
    inserted = await db.prepare(
      `INSERT INTO corrective_action_plans
         (alert_id, escalation_id, title, root_cause, intervention, responsible_user_id, due_date, expected_improvement, resources, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`
    ).get(alert.id, escalationRowId, title.trim(), rootCause.trim(), intervention.trim(), responsibleId, dueDate,
      expectedImprovement.trim(), resources == null ? null : String(resources).trim(), req.user.id);
    await audit(req.user.id, 'create_corrective_action', 'corrective_action', inserted.id, title.trim());
    if (alert.status !== 'action_planned') {
      await db.prepare(
        "UPDATE performance_alerts SET status = 'action_planned', updated_at = datetime('now') WHERE id = ?"
      ).run(alert.id);
      await audit(req.user.id, 'change_performance_alert_status', 'performance_alert', alert.id, `${alert.status} to action_planned`);
    }
  })();
  if (responsibleId != null) {
    await createPerformanceNotification({
      recipientId: responsibleId,
      alertId: alert.id,
      escalationId: escalationRowId,
      notificationKey: `corrective-action-${inserted.id}`,
      subject: `Action assigned to you: ${title.trim()}`,
      body: `KPI: ${alert.kpi_name} · ${alert.owner_name}. Due ${dueDate}. Expected improvement: ${expectedImprovement.trim()}`,
    });
  }
  res.status(201).json({ actionId: inserted.id });
});

router.patch('/actions/:id', requireAnyPerm('manage_corrective_actions', 'approve_corrective_actions', 'data_entry'), async (req, res) => {
  const id = positiveId(req.params.id);
  if (id == null) return res.status(400).json({ error: 'Corrective action id must be a positive integer.' });
  const action = await db.prepare('SELECT * FROM corrective_action_plans WHERE id = ?').get(id);
  if (!action) return res.status(404).json({ error: 'Corrective action plan not found.' });
  const alert = await getVisibleAlert(req, res, action.alert_id);
  if (!alert) return;
  const { status, outcome, evidence } = req.body || {};
  const allowedNext = {
    draft: ['submitted'],
    submitted: ['approved', 'rejected'],
    approved: ['in_progress'],
    in_progress: ['completed'],
    rejected: ['draft'],
    completed: [],
  };
  if (!allowedNext[action.status]?.includes(status)) {
    return res.status(400).json({ error: `Cannot change a ${action.status} plan to ${status || 'the requested state'}.` });
  }
  const permissionError = correctiveActionPermissionError(action, status, req.user);
  if (permissionError) return res.status(403).json({ error: permissionError });
  if (status === 'completed' && (!outcome || !String(outcome).trim())) {
    return res.status(400).json({ error: 'Record the outcome before completing a corrective action plan.' });
  }
  const revisingRejectedPlan = action.status === 'rejected' && status === 'draft';
  let revisedPlan = null;
  if (revisingRejectedPlan) {
    const { title, rootCause, intervention, dueDate, expectedImprovement, resources, responsibleUserId } = req.body || {};
    const fields = [title, rootCause, intervention, expectedImprovement];
    if (fields.some((value) => typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 4000)) {
      return res.status(400).json({ error: 'Title, root cause, intervention, and expected improvement are required (3 to 4000 characters each).' });
    }
    if (responsibleUserId == null || responsibleUserId === '') {
      return res.status(400).json({ error: 'Select a responsible person with a designation.' });
    }
    if (!isDate(dueDate)) return res.status(400).json({ error: 'Enter a valid due date in YYYY-MM-DD format.' });
    if (dueDate < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'The corrective action due date cannot be in the past.' });
    let responsibleId = responsibleUserId == null || responsibleUserId === '' ? null : Number(responsibleUserId);
    if (responsibleId != null) {
      if (!Number.isInteger(responsibleId) || responsibleId < 1) return res.status(400).json({ error: 'Responsible user id must be a positive integer.' });
      const responsible = await db.prepare('SELECT id, role, scope_type, scope_id FROM users WHERE id = ? AND deleted_at IS NULL').get(responsibleId);
      if (!responsible || !await canReadKpi(responsible, { id: alert.kpi_id, owner_type: alert.owner_type, owner_id: alert.owner_id })) {
        return res.status(400).json({ error: 'The responsible person must be an active user with access to this KPI scope.' });
      }
    }
    revisedPlan = {
      title: title.trim(),
      rootCause: rootCause.trim(),
      intervention: intervention.trim(),
      dueDate,
      expectedImprovement: expectedImprovement.trim(),
      resources: resources == null ? null : String(resources).trim() || null,
      responsibleId,
    };
  }
  await db.transaction(async () => {
    await db.prepare(
      `UPDATE corrective_action_plans SET status = ?, outcome = ?, evidence = ?,
       title = ?, root_cause = ?, intervention = ?, responsible_user_id = ?, due_date = ?,
       expected_improvement = ?, resources = ?,
       approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
       updated_at = datetime('now'),
       completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END
       WHERE id = ?`
    ).run(
      status,
      outcome ?? action.outcome,
      evidence ?? action.evidence,
      revisedPlan?.title ?? action.title,
      revisedPlan?.rootCause ?? action.root_cause,
      revisedPlan?.intervention ?? action.intervention,
      revisedPlan ? revisedPlan.responsibleId : action.responsible_user_id,
      revisedPlan?.dueDate ?? action.due_date,
      revisedPlan?.expectedImprovement ?? action.expected_improvement,
      revisedPlan ? revisedPlan.resources : action.resources,
      status,
      req.user.id,
      status,
      action.id
    );
    const detail = revisingRejectedPlan
      ? 'Rejected plan revised and returned to draft.'
      : `${action.status} to ${status}${outcome ? `: ${outcome}` : ''}`;
    await audit(req.user.id, 'update_corrective_action', 'corrective_action', action.id, detail);
  })();
  if (revisedPlan?.responsibleId != null && revisedPlan.responsibleId !== action.responsible_user_id) {
    await createPerformanceNotification({
      recipientId: revisedPlan.responsibleId,
      alertId: alert.id,
      escalationId: action.escalation_id,
      notificationKey: `corrective-action-revised-${action.id}-${Date.now()}`,
      subject: `Action reassigned to you: ${revisedPlan.title}`,
      body: `KPI: ${alert.kpi_name} · ${alert.owner_name}. Due ${revisedPlan.dueDate}. Expected improvement: ${revisedPlan.expectedImprovement}`,
    });
  }
  if (status === 'submitted') {
    const reviewers = await correctiveActionReviewers(alert, req.user.id);
    await notifyAlertUsers(
      reviewers,
      alert,
      `corrective-action-review-${action.id}-${Date.now()}`,
      `Action plan awaiting review: ${action.title}`,
      `KPI: ${alert.kpi_name} · ${alert.owner_name}. Review the submitted corrective action plan; due ${action.due_date}.`,
      action.escalation_id,
      req.user.id
    );
  } else if (['approved', 'rejected', 'in_progress', 'completed'].includes(status)) {
    const statusLabels = {
      approved: 'approved',
      rejected: 'returned for revision',
      in_progress: 'started',
      completed: 'completed',
    };
    const details = [
      `KPI: ${alert.kpi_name} · ${alert.owner_name}.`,
      `Due ${action.due_date}.`,
      outcome ? `Outcome: ${String(outcome).trim()}` : null,
    ].filter(Boolean).join(' ');
    await notifyAlertUsers(
      [action.created_by, action.responsible_user_id, action.approved_by],
      alert,
      `corrective-action-status-${action.id}-${status}-${Date.now()}`,
      `Action plan ${statusLabels[status]}: ${action.title}`,
      details,
      action.escalation_id,
      req.user.id
    );
  }
  res.json({ ok: true });
});

router.get('/history/:id', requirePerm('view_performance_alerts'), async (req, res) => {
  const alert = await getVisibleAlert(req, res, req.params.id);
  if (!alert) return;
  const history = await db.prepare(
    `SELECT a.id, a.ts, a.action, a.entity, a.entity_id, a.detail, u.name AS user_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE (a.entity = 'performance_alert' AND a.entity_id = ?)
        OR (a.entity = 'performance_escalation' AND a.entity_id IN
          (SELECT id FROM performance_escalations WHERE alert_id = ?))
        OR (a.entity = 'corrective_action' AND a.entity_id IN
          (SELECT id FROM corrective_action_plans WHERE alert_id = ?))
     ORDER BY a.id DESC LIMIT 100`
  ).all(alert.id, alert.id, alert.id);
  res.json({ history });
});

router.get('/report/summary', requirePerm('view_reports'), async (req, res) => {
  const year = Number(req.query.year) || new Date().getUTCFullYear();
  const month = Number(req.query.month) || new Date().getUTCMonth() + 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'A valid reporting year and month are required.' });
  }
  const rows = await db.prepare(
    `SELECT a.*, k.owner_type, k.owner_id FROM performance_alerts a
     JOIN kpis k ON k.id = a.kpi_id WHERE a.year = ? AND a.month = ? AND k.deleted_at IS NULL`
  ).all(year, month);
  const visible = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await canReadKpi(req.user, { id: row.kpi_id, owner_type: row.owner_type, owner_id: row.owner_id })) visible.push(row);
  }
  const ids = visible.map((row) => row.id);
  let escalations = [];
  let actions = [];
  if (ids.length) {
    const marks = ids.map((_, index) => `$${index + 1}`).join(', ');
    [escalations, actions] = await Promise.all([
      db.pool.query(`SELECT pe.id, pe.alert_id, pe.level, pe.status FROM performance_escalations pe WHERE pe.alert_id IN (${marks})`, ids).then((r) => r.rows),
      db.pool.query(`SELECT ca.id, ca.alert_id, ca.status, ca.due_date FROM corrective_action_plans ca WHERE ca.alert_id IN (${marks})`, ids).then((r) => r.rows),
    ]);
  }
  const bySeverity = { red: 0, amber: 0, missing: 0 };
  const byAlertStatus = { open: 0, acknowledged: 0, action_planned: 0, resolved: 0 };
  visible.forEach((row) => { bySeverity[row.severity] += 1; byAlertStatus[row.status] += 1; });
  const byEscalationStatus = { open: 0, acknowledged: 0, in_progress: 0, resolved: 0, closed: 0 };
  escalations.forEach((row) => { byEscalationStatus[row.status] += 1; });
  const byActionStatus = { draft: 0, submitted: 0, approved: 0, in_progress: 0, completed: 0, rejected: 0, overdue: 0 };
  actions.forEach((row) => {
    byActionStatus[row.status] += 1;
    if (!['completed', 'rejected'].includes(row.status) && row.due_date < new Date().toISOString().slice(0, 10)) byActionStatus.overdue += 1;
  });
  const endIndex = year * 12 + month - 1;
  const startIndex = endIndex - 11;
  const startYear = Math.floor(startIndex / 12);
  const startMonth = (startIndex % 12) + 1;
  const historicalRows = await db.prepare(
    `SELECT a.year, a.month, a.severity, a.status, k.id AS kpi_id, k.owner_type, k.owner_id
     FROM performance_alerts a JOIN kpis k ON k.id = a.kpi_id
     WHERE (a.year > ? OR (a.year = ? AND a.month >= ?))
       AND (a.year < ? OR (a.year = ? AND a.month <= ?))
       AND k.deleted_at IS NULL`
  ).all(startYear, startYear, startMonth, year, year, month);
  const trendMap = new Map();
  for (const row of historicalRows) {
    // eslint-disable-next-line no-await-in-loop
    if (!await canReadKpi(req.user, { id: row.kpi_id, owner_type: row.owner_type, owner_id: row.owner_id })) continue;
    const key = `${row.year}-${row.month}`;
    const point = trendMap.get(key) || { year: row.year, month: row.month, active: 0, red: 0, amber: 0, missing: 0 };
    if (row.status !== 'resolved') {
      point.active += 1;
      point[row.severity] += 1;
    }
    trendMap.set(key, point);
  }
  const trends = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const trendYear = Math.floor(index / 12);
    const trendMonth = (index % 12) + 1;
    trends.push(trendMap.get(`${trendYear}-${trendMonth}`) || {
      year: trendYear, month: trendMonth, active: 0, red: 0, amber: 0, missing: 0,
    });
  }
  res.json({
    period: { year, month },
    totalAlerts: visible.length,
    bySeverity,
    byAlertStatus,
    byEscalationStatus,
    byActionStatus,
    trends,
  });
});

module.exports = router;
