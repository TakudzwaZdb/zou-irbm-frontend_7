const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm, requireAnyPerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// A KPI "template" is created once against a Unit instead of one named
// person (see db.js's kpi_templates table for the full rationale). This is
// the catalog side of that: creating one, listing what exists (with real
// adoption numbers), removing one, and an Employee picking one up as
// their own. The actual per-person KPI a pick creates is a completely
// normal owner_type='employee' row in the `kpis` table — everything else
// in this app (data entry, submission, approval, RAG, overrides, hiding)
// already works on it with zero special-casing, exactly like the shared-KPI
// self-claim mechanism this replaces.

async function unitOr404(unitId, res) {
  const unit = await db.prepare('SELECT * FROM units WHERE id = ? AND deleted_at IS NULL').get(unitId);
  if (!unit) { res.status(404).json({ error: 'Unit not found.' }); return null; }
  return unit;
}

// Everyone signed in can read the catalog (same openness as GET /api/kpis) —
// the frontend narrows what it shows per role. Each template carries
// `pickedCount` (how many employees in that unit have already made it
// theirs) so whoever created it can see real adoption, not just a static
// definition sitting unused.
router.get('/', async (req, res) => {
  // Soft-removed templates (deleted_at set — see DELETE /:id below) drop out
  // of the active pool without their definition ever being destroyed.
  const templates = await db.prepare(
    `SELECT t.*, u.name AS unit_name,
       (SELECT COUNT(*) FROM kpis k WHERE k.template_id = t.id AND k.deleted_at IS NULL) AS picked_count
     FROM kpi_templates t JOIN units u ON u.id = t.unit_id
     WHERE u.deleted_at IS NULL AND t.deleted_at IS NULL
     ORDER BY t.id DESC`
  ).all();
  res.json({ templates });
});

// Recently-removed templates — same "Recently Removed" idea as
// routes/kpis.js's GET /removed and routes/org.js's GET /api/org/removed,
// scoped to this one catalog so whoever can create a template can also see
// (and restore) one they or someone else just took out of the pool.
router.get('/removed', requireAnyPerm('create_kpi', 'delete_kpi'), async (req, res) => {
  const templates = await db.prepare(
    `SELECT t.*, u.name AS unit_name
     FROM kpi_templates t JOIN units u ON u.id = t.unit_id
     WHERE t.deleted_at IS NOT NULL
     ORDER BY t.deleted_at DESC`
  ).all();
  res.json({ templates });
});

// Create one — same permission as creating any other KPI (create_kpi), just
// scoped to a Unit instead of one specific owner. This deliberately does
// NOT create a live kpis row: nobody owns it yet, and nobody is on the hook
// for entering data against it, until an actual person in that unit picks
// it up below.
router.post('/', requirePerm('create_kpi'), async (req, res) => {
  const { unitId, name, type, measure, baseline, target } = req.body || {};
  const measurementDirection = req.body?.measurementDirection || 'higher';
  const weight = req.body?.weight == null ? 1 : Number(req.body.weight);
  const achievementRule = req.body?.achievementRule || 'ratio';
  const reportingMode = req.body?.reportingMode || 'cumulative';
  const periodAggregation = req.body?.periodAggregation || 'latest';
  const reportingPeriods = req.body?.reportingPeriods || [];
  if (!unitId || !name || !type || !measure || baseline == null || target == null) {
    return res.status(400).json({ error: 'unitId, name, type, measure, baseline, and target are all required.' });
  }
  if (!['higher', 'lower'].includes(measurementDirection)) return res.status(400).json({ error: 'measurementDirection must be higher or lower.' });
  if (!Number.isFinite(weight) || weight <= 0) return res.status(400).json({ error: 'weight must be a positive number.' });
  if (!['ratio', 'exact_target', 'baseline_progress'].includes(achievementRule)) {
    return res.status(400).json({ error: 'achievementRule must be ratio, exact_target, or baseline_progress.' });
  }
  if (!['cumulative', 'period'].includes(reportingMode)) {
    return res.status(400).json({ error: 'reportingMode must be cumulative or period.' });
  }
  if (!['sum', 'latest'].includes(periodAggregation)) {
    return res.status(400).json({ error: 'periodAggregation must be sum or latest.' });
  }
  if (!Array.isArray(reportingPeriods) || reportingPeriods.some((milestone) =>
    !milestone || typeof milestone !== 'object'
      || typeof milestone.periodType !== 'string'
      || milestone.periodIndex == null || !Number.isInteger(Number(milestone.periodIndex)) || Number(milestone.periodIndex) < 1
      || milestone.expectedValue == null || !Number.isFinite(Number(milestone.expectedValue))
  )) {
    return res.status(400).json({ error: 'reportingPeriods must contain milestones with periodType, periodIndex, and numeric expectedValue.' });
  }
  const unit = await unitOr404(unitId, res); if (!unit) return;

  const { lastInsertRowid: id } = await db
    .prepare('INSERT INTO kpi_templates (unit_id, name, type, measure, baseline, target, measurement_direction, weight, reporting_mode, period_aggregation, reporting_periods, achievement_rule, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(Number(unitId), name, type, measure, Number(baseline), Number(target), measurementDirection, weight, reportingMode, periodAggregation, JSON.stringify(reportingPeriods), achievementRule, req.user.id);

  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_kpi_template', 'kpi_template', id,
    `KPI template "${name}" created for employees in ${unit.name} (baseline ${baseline}, target ${target}, ${measurementDirection}-is-better, weight ${weight}).`
  );
  res.status(201).json({ template: await db.prepare('SELECT * FROM kpi_templates WHERE id = ?').get(id) });
});

// Removing a template never touches anyone's already-instantiated personal
// KPI (kpis.template_id just gets set to NULL — see db.js's ON DELETE SET
// NULL) — it only takes the entry out of the pool for anyone who hasn't
// picked it up yet. Nothing is destroyed: a deleted_at stamp, not a real
// DELETE (see db.js's softDeleteTables), so the definition itself — name,
// type, measure, baseline, target — stays intact and restorable below.
router.delete('/:id', requireAnyPerm('create_kpi', 'delete_kpi'), async (req, res) => {
  const template = await db.prepare('SELECT * FROM kpi_templates WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found.' });

  await db.prepare("UPDATE kpi_templates SET deleted_at = datetime('now') WHERE id = ?").run(template.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'delete_kpi_template', 'kpi_template', template.id,
    `KPI template "${template.name}" removed from the pool. Nothing is deleted — it's recoverable from Recently Removed.`
  );
  res.json({ ok: true });
});

// Restore a previously-removed template — clears deleted_at and it
// reappears in the active pool exactly as it was, same pattern as every
// other restore route in this app.
router.post('/:id/restore', requireAnyPerm('create_kpi', 'delete_kpi'), async (req, res) => {
  const template = await db.prepare('SELECT * FROM kpi_templates WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Removed template not found.' });

  await db.prepare('UPDATE kpi_templates SET deleted_at = NULL WHERE id = ?').run(template.id);
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'restore_kpi_template', 'kpi_template', template.id, `KPI template "${template.name}" restored.`
  );
  res.json({ ok: true });
});

// The self-service moment: an Employee in the template's own Unit makes
// it theirs. This creates a real kpis row exactly the way POST /api/kpis
// does for a directly-created employee KPI (same initial draft
// kpi_values row for the current period), just with owner_id set to the
// picking Employee and template_id recorded for adoption tracking.
router.post('/:id/pick', requirePerm('data_entry'), async (req, res) => {
  const template = await db.prepare('SELECT * FROM kpi_templates WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found.' });
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Only an Employee can pick up a KPI template.' });

  const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.user.scope_id);
  if (!employee || employee.unit_id !== template.unit_id) {
    return res.status(403).json({ error: 'This KPI template was created for a different unit than your own.' });
  }
  const already = await db.prepare("SELECT 1 FROM kpis WHERE template_id = ? AND owner_type = 'employee' AND owner_id = ? AND deleted_at IS NULL").get(template.id, employee.id);
  if (already) return res.status(400).json({ error: 'You have already added this KPI.' });

  const pickTxn = db.transaction(async () => {
    const { lastInsertRowid: id } = await db
      .prepare('INSERT INTO kpis (owner_type, owner_id, name, type, measure, baseline, target, measurement_direction, weight, reporting_mode, period_aggregation, reporting_periods, achievement_rule, lifecycle_status, template_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'draft\', ?)')
      .run('employee', employee.id, template.name, template.type, template.measure, template.baseline, template.target, template.measurement_direction, template.weight, template.reporting_mode, template.period_aggregation, template.reporting_periods, template.achievement_rule, template.id);
    const now = new Date();
    await db.prepare('INSERT INTO kpi_values (kpi_id, year, month, status) VALUES (?, ?, ?, \'draft\')').run(id, now.getFullYear(), now.getMonth() + 1);
    return id;
  });
  const id = await pickTxn();

  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'pick_kpi_template', 'kpi', id, `Picked up "${template.name}" from ${employee.name}'s unit's KPI pool as a personal KPI.`
  );
  res.status(201).json({ kpi: await db.prepare('SELECT * FROM kpis WHERE id = ?').get(id) });
});

module.exports = router;
