const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Throttles /login specifically — the one route in this app that's
// reachable with no token at all, and so the one an attacker can hammer
// with password guesses (see SECURITY_REVIEW.md's finding #3). Keyed by IP;
// 8 attempts per 10 minutes total is generous for a genuine typo or two but
// stops a script from trying thousands of guesses against one account. If
// this app ever sits behind a reverse proxy, pair this with
// `app.set('trust proxy', ...)` in server.js so `req.ip` reflects the real
// client rather than the proxy for every request, not just this one.
//
// This store is in-memory and per-process, and server.js now runs one
// process per CPU core (see its WEB_CONCURRENCY comment) — Node's cluster
// module round-robins incoming connections across them, so a given IP's
// consecutive login attempts don't reliably land on the same worker and
// don't share a single counter. Dividing the base limit by the actual
// worker count (server.js sets WEB_CONCURRENCY to the resolved value,
// including its os.cpus().length default, before forking) keeps the
// cluster-wide total close to the original 8-per-10-minutes intent instead
// of silently becoming 8-per-worker — not perfectly precise, since
// round-robin doesn't guarantee an even split of any one IP's requests,
// but far closer than ignoring the split entirely.
const TOTAL_LOGIN_ATTEMPTS = 8;
const WORKER_COUNT = Math.max(1, Number(process.env.WEB_CONCURRENCY) || 1);
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Math.max(2, Math.ceil(TOTAL_LOGIN_ATTEMPTS / WORKER_COUNT)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
});

function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version || 0 }, JWT_SECRET, { expiresIn: '12h' });
}

function publicUser(user, permissions) {
  return {
    id: user.id,
    name: user.name,
    title: user.title,
    email: user.email,
    role: user.role,
    scope_type: user.scope_type,
    scope_id: user.scope_id,
    avatar: user.avatar || null,
    overview_limit: user.overview_limit || null,
    is_executive_owner: !!user.is_executive_owner,
    must_change_password: !!user.must_change_password,
    permissions,
  };
}

// Real credential check against a bcrypt hash stored in the database — not a
// hardcoded shared string checked in client-side JavaScript.
router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter both your email address and password.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  const genericError = () => res.status(401).json({ error: 'Incorrect email or password.' });
  if (!user) return genericError();
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return genericError();

  const token = signToken(user);
  const permissions = db
    .prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?')
    .all(user.id)
    .map((r) => r.permission_key);

  res.json({ token, user: publicUser(user, permissions) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Self-service password change — every signed-in user can do this for their
// own account, verified against their real current password (not just
// "logged in therefore trusted"), so someone at your desk can't change your
// password just because your session is open. Also the one place an account
// still on a temporary password (must_change_password — see
// SECURITY_REVIEW.md's finding #1) clears that flag: bumping token_version
// here invalidates any other outstanding token for this account (a stolen
// or shoulder-surfed temporary password stops being useful for an already-
// open session the moment the real owner sets their own password), and a
// freshly-signed token is returned so THIS session keeps working without
// having to sign in again right after.
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
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?')
    .run(hash, req.user.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'change_password', 'user', req.user.id, `${row.name} changed their own password.`
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const permissions = db.prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?').all(req.user.id).map((r) => r.permission_key);
  res.json({ token: signToken(updated), user: publicUser(updated, permissions) });
});

// Self-service "sign out everywhere" — bumps token_version with no password
// change involved, instantly invalidating every outstanding token for this
// account, including the one THIS request used (see SECURITY_REVIEW.md's
// finding #6). The real answer to "I think I left myself signed in on a
// shared computer" or "my laptop was stolen" without waiting out a token's
// remaining 12h life. The caller's own client is expected to clear its
// stored token and return to the sign-in screen right after this succeeds.
router.post('/logout-everywhere', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'logout_everywhere', 'user', req.user.id, `${req.user.name} signed out of every session.`
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
