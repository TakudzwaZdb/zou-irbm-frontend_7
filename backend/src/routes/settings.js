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

// The full set of settings keys this app actually reads anywhere (see
// routes/compliance.js's getSettings, seed.js's initial rows). Whitelisted
// here so a PATCH body can only ever touch a real, known setting — never
// write an arbitrary key into the table (see SECURITY_REVIEW.md's
// "settings whitelist" note; still ICT-admin-only either way, this just
// keeps the table from accumulating unrecognized keys by accident).
const KNOWN_SETTING_KEYS = new Set([
  'ragGreen', 'ragAmber', 'lateCutoffIndividual', 'lateCutoffUnit', 'lateCutoffSub',
  'escalateProgramme', 'escalateVC', 'redEscalateProgramme', 'redEscalateVC',
  'submissionOpenDay', 'submissionCloseDay',
]);

// The submission-window pair (see utils/submissionWindow.js) is a day-of-
// month, so it gets a real bounds check unlike the other settings above —
// an out-of-range value here wouldn't just be a bad number, it would make
// the window computation land on the wrong calendar month entirely.
const DAY_OF_MONTH_KEYS = new Set(['submissionOpenDay', 'submissionCloseDay']);

router.patch('/', requirePerm('manage_settings'), (req, res) => {
  const body = req.body || {};
  const unknown = Object.keys(body).filter((k) => !KNOWN_SETTING_KEYS.has(k));
  if (unknown.length) return res.status(400).json({ error: `Unknown setting(s): ${unknown.join(', ')}.` });
  for (const k of Object.keys(body)) {
    if (!DAY_OF_MONTH_KEYS.has(k)) continue;
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 1 || n > 31) {
      return res.status(400).json({ error: `${k} must be a whole number between 1 and 31.` });
    }
  }
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
