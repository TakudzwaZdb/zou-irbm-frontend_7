const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
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
  'ragGreen', 'ragAmber', 'lateCutoffEmployee', 'lateCutoffUnit', 'lateCutoffSub',
  'escalateProgramme', 'escalateVC', 'redEscalateProgramme', 'redEscalateVC',
  'submissionOpenDay', 'submissionCloseDay', 'alertWarningGap', 'alertCriticalGap',
]);

// The submission-window pair (see utils/submissionWindow.js) is a day-of-
// month, so it gets a real bounds check unlike the other settings above —
// an out-of-range value here wouldn't just be a bad number, it would make
// the window computation land on the wrong calendar month entirely.
const DAY_OF_MONTH_KEYS = new Set(['submissionOpenDay', 'submissionCloseDay']);
const ALERT_GAP_KEYS = new Set(['alertWarningGap', 'alertCriticalGap']);

router.patch('/', requirePerm('manage_settings'), async (req, res) => {
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
  for (const key of Object.keys(body)) {
    if (!ALERT_GAP_KEYS.has(key)) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: `${key} must be a number between 0 and 100.` });
    }
  }
  if (Object.keys(body).some((key) => ALERT_GAP_KEYS.has(key))) {
    const currentRows = await db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?)').all('alertWarningGap', 'alertCriticalGap');
    const current = Object.fromEntries(currentRows.map((row) => [row.key, Number(row.value)]));
    const warning = Number(body.alertWarningGap ?? current.alertWarningGap ?? 10);
    const critical = Number(body.alertCriticalGap ?? current.alertCriticalGap ?? 25);
    if (critical <= warning) {
      return res.status(400).json({ error: 'The critical performance gap must be greater than the warning gap.' });
    }
  }
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of Object.keys(body)) {
    // eslint-disable-next-line no-await-in-loop
    await upsert.run(k, String(body[k]));
  }
  await db.prepare('INSERT INTO audit_log (user_id, action, entity, detail) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'update_settings', 'settings', JSON.stringify(body)
  );
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach((r) => { settings[r.key] = isNaN(Number(r.value)) ? r.value : Number(r.value); });
  res.json({ settings });
});

module.exports = router;
