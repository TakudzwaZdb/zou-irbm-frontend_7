const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { generateSecret, verifyTotp, otpauthUrl } = require('../utils/totp');

const router = express.Router();

// Throttles /login specifically — the one route in this app that's
// reachable with no token at all, and so the one an attacker can hammer
// with password guesses (see SECURITY_REVIEW.md's finding #3). Two limiters,
// not one, because a single IP-keyed limiter (this app's original approach)
// has a real failure mode on a university network: everyone behind the same
// NAT gateway or proxy shares one apparent IP, so ONE person mistyping their
// own password repeatedly locks out everyone else on that network for the
// rest of the window — confirmed live in this session (a second, unrelated,
// correctly-typed login got a 429 purely because it came from the same IP
// as an earlier account's failed attempts).
//
// - accountLoginLimiter is keyed on the email being attempted, not the
//   caller's IP — it stops a script (or a person) from grinding through
//   password guesses against ONE account, from anywhere, without touching
//   anyone else's ability to sign in from the same network.
// - ipLoginLimiter is the backstop: a much larger per-IP cap that still
//   catches the other real attack shape — spraying a handful of guesses
//   across MANY different accounts from one source — which a purely
//   per-account limiter would never trip on its own.
// Both apply to the same request; either one alone would miss a real case
// the other catches.
//
// If this app ever sits behind a reverse proxy, pair ipLoginLimiter with
// `app.set('trust proxy', ...)` in server.js so `req.ip` reflects the real
// client rather than the proxy for every request, not just this one —
// otherwise every external request looks like it's from the same "IP" (the
// proxy) and ipLoginLimiter's cap effectively applies to the whole app
// rather than one real client.
//
// Both stores are in-memory and per-process, and server.js runs one process
// per CPU core (see its WEB_CONCURRENCY comment) — Node's cluster module
// round-robins incoming connections across them, so a given key's
// consecutive attempts don't reliably land on the same worker and don't
// share a single counter. Dividing each base limit by the actual worker
// count (server.js sets WEB_CONCURRENCY to the resolved value, including
// its os.cpus().length default, before forking) keeps each cluster-wide
// total close to its stated intent instead of silently multiplying by the
// worker count — not perfectly precise, since round-robin doesn't guarantee
// an even split of any one key's requests, but far closer than ignoring the
// split entirely.
const ACCOUNT_LOGIN_ATTEMPTS = 8; // per account being attempted, from any IP
const IP_LOGIN_ATTEMPTS = 30; // per source IP, across every account it tries
const WORKER_COUNT = Math.max(1, Number(process.env.WEB_CONCURRENCY) || 1);

function accountKey(req) {
  const email = req.body?.email;
  // Same normalization the actual credential check below uses, so this
  // can't be sidestepped by varying case/whitespace on the same account.
  return email ? String(email).trim().toLowerCase() : 'no-email-given';
}

const accountLoginLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  limit: Math.max(2, Math.ceil(ACCOUNT_LOGIN_ATTEMPTS / WORKER_COUNT)),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: accountKey,
  // Deliberately not IP-based by design (see the comment above) — silence
  // express-rate-limit's default warning that a custom keyGenerator without
  // req.ip may be less safe; ipLoginLimiter below is that safety net.
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many sign-in attempts on this account. Please wait a few minutes and try again.' },
});

const ipLoginLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  limit: Math.max(2, Math.ceil(IP_LOGIN_ATTEMPTS / WORKER_COUNT)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this network. Please wait a few minutes and try again.' },
});

function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version || 0 }, JWT_SECRET, { expiresIn: '12h' });
}

// A deliberately narrow, short-lived ticket minted the moment a password
// check passes for an MFA-enabled account — proof of "who you're claiming
// to be and that you know the password", nothing more. It cannot be used
// as a real bearer token (see middleware/auth.js's explicit mfaPending
// check) and expires fast enough that it's useless if intercepted after
// the sign-in screen has moved on.
function signMfaTicket(user) {
  return jwt.sign({ sub: user.id, mfaPending: true }, JWT_SECRET, { expiresIn: '5m' });
}

// Same account+IP double-limiter shape as the password check itself (see
// the big comment above) — a 6-digit TOTP code is only 1,000,000
// possibilities, so brute-forcing it directly (skipping the password
// entirely once an mfaToken ticket is obtained) is a real attack this must
// also throttle, not just the initial /login call.
const mfaAccountLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  limit: Math.max(2, Math.ceil(ACCOUNT_LOGIN_ATTEMPTS / WORKER_COUNT)),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Keyed on the account the ticket actually belongs to (decoded, not
    // trusted from the request body) so this can't be sidestepped by
    // reusing someone else's mfaToken across many guesses.
    try {
      const payload = jwt.verify(req.body?.mfaToken, JWT_SECRET);
      return payload.mfaPending ? `mfa:${payload.sub}` : 'mfa:invalid-ticket';
    } catch {
      return 'mfa:invalid-ticket';
    }
  },
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many verification attempts. Please wait a few minutes and try again.' },
});
const mfaIpLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  limit: Math.max(2, Math.ceil(IP_LOGIN_ATTEMPTS / WORKER_COUNT)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts from this network. Please wait a few minutes and try again.' },
});

function generateRecoveryCodes(count = 10) {
  // xxxx-xxxx shape, drawn from an unambiguous alphabet (no 0/O/1/I) so a
  // person copying one down by hand doesn't misread it.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes = [];
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) code += alphabet[crypto.randomInt(alphabet.length)];
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
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
    mfa_enabled: !!user.mfa_enabled,
    permissions,
  };
}

// Real credential check against a bcrypt hash stored in the database — not a
// hardcoded shared string checked in client-side JavaScript.
router.post('/login', ipLoginLimiter, accountLoginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter both your email address and password.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  const genericError = () => res.status(401).json({ error: 'Incorrect email or password.' });
  if (!user) return genericError();
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return genericError();
  // A deactivated account (deleted_at set — see routes/org.js's
  // deactivateUserAccount, fired whenever the person tied to it is removed
  // from the org structure) keeps its row, its history, and its correct
  // password forever — nothing about the account itself is destroyed — but
  // must not be able to sign in until it's restored. Same generic message as
  // a wrong password, so a deactivated account isn't distinguishable from a
  // nonexistent one to whoever's trying to sign in.
  if (user.deleted_at) return genericError();

  // A correct password on an MFA-enabled account isn't enough on its own —
  // hand back a short-lived ticket instead of a real session token, and the
  // sign-in screen collects the 6-digit code (or a recovery code) next,
  // via POST /mfa/verify below. An account that never enabled MFA signs in
  // exactly as before — this is opt-in, never a forced second step.
  if (user.mfa_enabled) {
    return res.json({ mfaRequired: true, mfaToken: signMfaTicket(user) });
  }

  const token = signToken(user);
  const permissions = db
    .prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?')
    .all(user.id)
    .map((r) => r.permission_key);

  res.json({ token, user: publicUser(user, permissions) });
});

// The second step for an MFA-enabled account: the mfaToken from /login
// (proof the password already checked out) plus either a real 6-digit TOTP
// code from their authenticator app, or one of their ten one-time recovery
// codes (see db.js's mfa_recovery_codes — for a lost/replaced device).
// Issues the exact same { token, user } shape /login does on success, so
// the frontend's post-login handling doesn't need two separate paths.
router.post('/mfa/verify', ipLoginLimiter, mfaIpLimiter, mfaAccountLimiter, (req, res) => {
  const { mfaToken, code } = req.body || {};
  if (!mfaToken || !code) return res.status(400).json({ error: 'A verification code is required.' });
  let payload;
  try {
    payload = jwt.verify(mfaToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'That verification session has expired. Please sign in again.' });
  }
  if (!payload.mfaPending) return res.status(401).json({ error: 'Invalid verification session.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user || user.deleted_at || !user.mfa_enabled || !user.mfa_secret) {
    return res.status(401).json({ error: 'Invalid verification session.' });
  }

  const trimmedCode = String(code).trim();
  let usedRecoveryCodeId = null;
  let ok = verifyTotp(user.mfa_secret, trimmedCode);
  if (!ok && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(trimmedCode)) {
    // Recovery codes are stored bcrypt-hashed, exactly like passwords, so a
    // leaked database row can't be replayed to sign in — the same
    // never-store-it-plain rule this app already applies everywhere else.
    const unused = db.prepare('SELECT * FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL').all(user.id);
    const match = unused.find((r) => bcrypt.compareSync(trimmedCode.toUpperCase(), r.code_hash));
    if (match) { ok = true; usedRecoveryCodeId = match.id; }
  }
  if (!ok) return res.status(401).json({ error: 'Incorrect or expired code.' });

  if (usedRecoveryCodeId) {
    db.prepare("UPDATE mfa_recovery_codes SET used_at = datetime('now') WHERE id = ?").run(usedRecoveryCodeId);
    db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
      user.id, 'mfa_recovery_code_used', 'user', user.id, `${user.name} signed in using a one-time MFA recovery code.`
    );
  }

  const token = signToken(user);
  const permissions = db.prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?').all(user.id).map((r) => r.permission_key);
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

// ---- optional TOTP MFA: self-service enroll/confirm/disable --------------

router.get('/mfa/status', requireAuth, (req, res) => {
  res.json({ enabled: !!req.user.mfa_enabled });
});

// Step 1 of enrolling: generate a fresh secret and hand back the
// otpauth:// URI (the frontend renders this as a QR code, or the person
// can type the raw secret into their authenticator app by hand). Nothing
// is enabled yet — the secret is stored but mfa_enabled stays 0 until they
// prove they actually captured it correctly via POST /mfa/enable below.
// Calling this again before confirming simply overwrites the pending
// secret with a new one, which is fine — nothing was live yet.
router.post('/mfa/setup', requireAuth, (req, res) => {
  const secret = generateSecret();
  db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(secret, req.user.id);
  res.json({ secret, otpauthUrl: otpauthUrl({ secret, accountName: req.user.email }) });
});

// Step 2: the person types back one real code their authenticator app just
// generated from the secret POST /mfa/setup gave them. Only on a correct
// code does MFA actually become live — and ten recovery codes are
// generated and returned exactly once here, before they're needed, the
// same way a password is only ever shown once at creation.
router.post('/mfa/enable', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const row = db.prepare('SELECT mfa_secret FROM users WHERE id = ?').get(req.user.id);
  if (!row?.mfa_secret) return res.status(400).json({ error: 'Start MFA setup first.' });
  if (!verifyTotp(row.mfa_secret, code)) {
    return res.status(400).json({ error: 'That code did not match. Check your authenticator app and try again.' });
  }
  db.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(req.user.id);
  db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(req.user.id); // clear any codes from a previous enrollment
  const codes = generateRecoveryCodes();
  const insert = db.prepare('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)');
  codes.forEach((c) => insert.run(req.user.id, bcrypt.hashSync(c, 10)));
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'mfa_enabled', 'user', req.user.id, `${req.user.name} enabled two-factor authentication.`
  );
  res.json({ enabled: true, recoveryCodes: codes });
});

// Self-service disable — requires the current password (same re-auth
// pattern as POST /change-password above) so a person who steps away from
// an already-open session can't turn off someone else's MFA. Clears the
// secret and every recovery code together; nothing is left half-configured.
router.post('/mfa/disable', requireAuth, (req, res) => {
  const { password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!password || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Your current password is required to disable two-factor authentication.' });
  }
  db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(req.user.id);
  db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(req.user.id);
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'mfa_disabled', 'user', req.user.id, `${req.user.name} disabled two-factor authentication.`
  );
  res.json({ enabled: false });
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

// The real, honest answer to "forgot password" on the sign-in screen —
// deliberately NOT a fake "enter your email, we'll send a link" form: this
// app has no email/SMS delivery behind it (same reasoning as the admin-
// assisted reset itself, see routes/users.js's POST /:id/reset-password),
// and a form that pretends to send a reset email nobody receives would be
// worse than no form at all. Instead, this tells whoever's locked out
// exactly who can actually help, with real, live contact details — never a
// hardcoded name that could go stale the day ICT staff changes.
// Deliberately unauthenticated (that's the entire point — reachable before
// signing in) and deliberately narrow: only name/title/email for the
// ictadmin role, the same fields already visible to any signed-in account
// via GET /api/messages/directory, just reachable one step earlier.
router.get('/ict-admins', (req, res) => {
  const admins = db.prepare("SELECT name, title, email FROM users WHERE role = 'ictadmin' ORDER BY name").all();
  res.json({ admins });
});

module.exports = router;
