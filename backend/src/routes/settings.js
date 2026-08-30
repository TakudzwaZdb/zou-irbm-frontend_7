const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach((r) => { settings[r.key] = isNaN(Number(r.value)) ? r.value : Number(r.value); });
  res.json({ settings });
});

router.patch('/', requirePerm('manage_settings'), (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  Object.keys(body).forEach((k) => upsert.run(k, String(body[k])));
  db.prepare('INSERT INTO audit_log (user_id, action, entity, detail) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'update_settings', 'settings', JSON.stringify(body)
  );
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach((r) => { settings[r.key] = isNaN(Number(r.value)) ? r.value : Number(r.value); });
  res.json({ settings });
});

module.exports = router;
