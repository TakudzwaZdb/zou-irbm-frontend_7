const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Real credential check against a bcrypt hash stored in the database — not a
// hardcoded shared string checked in client-side JavaScript.
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter both your email address and password.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  const genericError = () => res.status(401).json({ error: 'Incorrect email or password.' });
  if (!user) return genericError();
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return genericError();

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h' });
  const permissions = db
    .prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?')
    .all(user.id)
    .map((r) => r.permission_key);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      title: user.title,
      email: user.email,
      role: user.role,
      scope_type: user.scope_type,
      scope_id: user.scope_id,
      avatar: user.avatar || null,
      permissions,
    },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Self-service password change — every signed-in user can do this for their
// own account, verified against their real current password (not just
// "logged in therefore trusted"), so someone at your desk can't change your
// password just because your session is open.
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Enter your current password and a new password.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'change_password', 'user', req.user.id, `${row.name} changed their own password.`
  );
  res.json({ ok: true });
});

// Profile photo — every signed-in user can set/replace/remove their OWN
// avatar (an admin-driven photo upload for other accounts isn't needed;
// this is a personal-profile action, gated only by "is this your account").
// Stored as a data: URL string directly in the users row — a real,
// persisted image the browser can render straight back with no separate
// file host to stand up. A hard size cap keeps a phone photo from bloating
// the database — the frontend also downsizes the image client-side before
// it ever reaches this request.
const MAX_AVATAR_DATA_URL_LENGTH = 2_000_000; // ~1.4MB of actual image data once base64 overhead is backed out
router.put('/me/avatar', requireAuth, (req, res) => {
  const { avatarDataUrl } = req.body || {};
  if (!avatarDataUrl || typeof avatarDataUrl !== 'string' || !avatarDataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'A valid image is required.' });
  }
  if (avatarDataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return res.status(400).json({ error: 'That image is too large — please use a smaller photo.' });
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarDataUrl, req.user.id);
  res.json({ avatar: avatarDataUrl });
});

router.delete('/me/avatar', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
