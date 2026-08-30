const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// A KPI "template" is created once against a Unit instead of one named
// person (see db.js's kpi_templates table for the full rationale). This is
// the catalog side of that: creating one, listing what exists (with real
// adoption numbers), removing one, and an Individual picking one up as
// their own. The actual per-person KPI a pick creates is a completely
// normal owner_type='individual' row in the `kpis` table — everything else
// in this app (data entry, submission, approval, RAG, overrides, hiding)
// already works on it with zero special-casing, exactly like the shared-KPI
// self-claim mechanism this replaces.

function unitOr404(unitId, res) {
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId);
  if (!unit) { res.status(404).json({ error: 'Unit not found.' }); return null; }
  return unit;
}

// Everyone signed in can read the catalog (same openness as GET /api/kpis) —
// the frontend narrows what it shows per role. Each template carries
// `pickedCount` (how many individuals in that unit have already made it
// theirs) so whoever created it can see real adoption, not just a static
// definition sitting unused.
router.get('/', (req, res) => {
  const templates = db.prepare(
    `SELECT t.*, u.name AS unit_name,
       (SELECT COUNT(*) FROM kpis k WHERE k.template_id = t.id) AS picked_count
     FROM kpi_templates t JOIN units u ON u.id = t.unit_id
     ORDER BY t.id DESC`
  ).all();
  res.json({ templates });
});

// Create one — same permission as creating any other KPI (create_kpi), just
// scoped to a Unit instead of one specific owner. This deliberately does
// NOT create a live kpis row: nobody owns it yet, and nobody is on the hook
// for entering data against it, until an actual person in that unit picks
// it up below.
router.post('/', requirePerm('create_kpi'), (req, res) => {
  const { unitId, name, type, measure, baseline, target } = req.body || {};
  if (!unitId || !name || !type || !measure || baseline == null || target == null) {
    return res.status(400).json({ error: 'unitId, name, type, measure, baseline, and target are all required.' });
  }
  const unit = unitOr404(unitId, res); if (!unit) return;

  const id = db
    .prepare('INSERT INTO kpi_templates (unit_id, name, type, measure, baseline, target, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(Number(unitId), name, type, measure, Number(baseline), Number(target), req.user.id).lastInsertRowid;

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'create_kpi_template', 'kpi_template', id,
    `KPI template "${name}" created for individuals in ${unit.name} (baseline ${baseline}, target ${target}).`
  );
  res.status(201).json({ template: db.prepare('SELECT * FROM kpi_templates WHERE id = ?').get(id) });
});

// Removing a template never touches anyone's already-instantiated personal
// KPI (kpis.template_id just gets set to NULL — see db.js's ON DELETE SET
// NULL) — it only takes the entry out of the pool for anyone who hasn't
// picked it up yet.
router.delete('/:id', requirePerm('create_kpi'), (req, res) => {
  const template = db.prepare('SELECT * FROM kpi_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found.' });

  db.prepare('DELETE FROM kpi_templates WHERE id = ?').run(template.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'delete_kpi_template', 'kpi_template', template.id, `KPI template "${template.name}" removed.`
  );
  res.json({ ok: true });
});

// The self-service moment: an Individual in the template's own Unit makes
// it theirs. This creates a real kpis row exactly the way POST /api/kpis
// does for a directly-created individual KPI (same initial draft
// kpi_values row for the current period), just with owner_id set to the
// picking Individual and template_id recorded for adoption tracking.
router.post('/:id/pick', requirePerm('data_entry'), (req, res) => {
  const template = db.prepare('SELECT * FROM kpi_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found.' });
  if (req.user.role !== 'individual') return res.status(403).json({ error: 'Only an Individual can pick up a KPI template.' });

  const individual = db.prepare('SELECT * FROM individuals WHERE id = ?').get(req.user.scope_id);
  if (!individual || individual.unit_id !== template.unit_id) {
    return res.status(403).json({ error: 'This KPI template was created for a different unit than your own.' });
  }
  const already = db.prepare("SELECT 1 FROM kpis WHERE template_id = ? AND owner_type = 'individual' AND owner_id = ?").get(template.id, individual.id);
  if (already) return res.status(400).json({ error: 'You have already added this KPI.' });

  const pickTxn = db.transaction(() => {
    const id = db
      .prepare('INSERT INTO kpis (owner_type, owner_id, name, type, measure, baseline, target, template_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('individual', individual.id, template.name, template.type, template.measure, template.baseline, template.target, template.id).lastInsertRowid;
    const now = new Date();
    db.prepare('INSERT INTO kpi_values (kpi_id, year, month, status) VALUES (?, ?, ?, \'draft\')').run(id, now.getFullYear(), now.getMonth() + 1);
    return id;
  });
  const id = pickTxn();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'pick_kpi_template', 'kpi', id, `Picked up "${template.name}" from ${individual.name}'s unit's KPI pool as a personal KPI.`
  );
  res.status(201).json({ kpi: db.prepare('SELECT * FROM kpis WHERE id = ?').get(id) });
});

module.exports = router;
