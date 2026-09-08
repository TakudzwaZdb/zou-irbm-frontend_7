const jwt = require('jsonwebtoken');
const db = require('../db');

// No fallback to a shared, publicly-documented placeholder here on purpose
// (see SECURITY_REVIEW.md's finding #2 — the old 'dev-secret-do-not-use-in-
// production' fallback is exactly the kind of value everyone reading this
// source can guess). A missing JWT_SECRET now fails loudly at startup
// instead of silently signing every token with a value anyone can forge.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Set a long random value in backend/.env before starting the server (see .env.example).');
}

function getUserPermissions(userId) {
  return db
    .prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?')
    .all(userId)
    .map((r) => r.permission_key);
}

function loadUser(userId) {
  const user = db.prepare('SELECT id, name, title, email, role, scope_type, scope_id, avatar, overview_limit, is_executive_owner, must_change_password, mfa_enabled FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  user.must_change_password = !!user.must_change_password;
  user.mfa_enabled = !!user.mfa_enabled;
  user.permissions = getUserPermissions(user.id);
  return user;
}

// Routes still reachable while an account has must_change_password set —
// enough to see who you are and set a real password, nothing else. Every
// other route behind requireAuth (which is nearly all of them) 403s until
// that's done, so this is a real, server-enforced gate, not just a
// frontend redirect someone could skip by calling the API directly.
const PASSWORD_CHANGE_EXEMPT_PATHS = new Set(['/api/auth/me', '/api/auth/change-password']);

// Requires a valid bearer token; attaches req.user (with fresh permissions
// pulled from the DB on every request — never cached in the token).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token.' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
  // A short-lived MFA ticket (see routes/auth.js's POST /login and
  // /mfa/verify) is a different, deliberately narrower kind of token —
  // proof that a password check passed, nothing more — and must never be
  // accepted as a real bearer token here even though it's signed with the
  // same secret and could otherwise pass every check below. Only
  // /mfa/verify (and /login itself) ever inspects one of these directly.
  if (payload.mfaPending) return res.status(401).json({ error: 'MFA verification required.' });
  // Real revocation for an otherwise-stateless token: the token's own
  // token_version (baked in at sign-in — see routes/auth.js's /login) must
  // still match the account's current one. A password change, an admin
  // password reset, or "sign out everywhere" bumps the column and every
  // token minted before that bump stops working immediately, rather than
  // staying valid for up to the remaining 12h of its natural expiry.
  const versionRow = db.prepare('SELECT token_version, deleted_at FROM users WHERE id = ?').get(payload.sub);
  if (!versionRow) return res.status(401).json({ error: 'Account no longer exists.' });
  // A token minted before the account was removed from the org structure
  // (see routes/org.js's deactivateUserAccount) must stop working the
  // moment that happens, same as a bumped token_version below — otherwise
  // someone already signed in could keep using the app for up to 12h after
  // being removed.
  if (versionRow.deleted_at) return res.status(401).json({ error: 'This account has been deactivated.' });
  if (Number(payload.tv || 0) !== Number(versionRow.token_version || 0)) {
    return res.status(401).json({ error: 'This session was signed out. Please sign in again.' });
  }
  const user = loadUser(payload.sub);
  if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
  req.user = user;
  if (user.must_change_password && !PASSWORD_CHANGE_EXEMPT_PATHS.has(req.originalUrl.split('?')[0])) {
    return res.status(403).json({ error: 'You must change your password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}

// Requires req.user (must run after requireAuth) to hold ALL listed permission keys.
function requirePerm(...keys) {
  return (req, res, next) => {
    const missing = keys.filter((k) => !req.user.permissions.includes(k));
    if (missing.length) {
      return res.status(403).json({ error: `Missing permission: ${missing.join(', ')}` });
    }
    next();
  };
}

// Requires req.user (must run after requireAuth) to hold AT LEAST ONE of the
// listed permission keys — used where a capability can be reached through
// more than one grant (e.g. adding an Individual via the broad
// manage_org_units OR the narrower, scope-restricted add_individual).
function requireAnyPerm(...keys) {
  return (req, res, next) => {
    if (!keys.some((k) => req.user.permissions.includes(k))) {
      return res.status(403).json({ error: `Requires one of: ${keys.join(', ')}` });
    }
    next();
  };
}

// Requires req.user.role to be one of the listed roles — for capabilities that
// are structurally exclusive to a role and must never be delegable by a
// permission grant (e.g. only ictadmin may ever manage permissions).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action is reserved for: ${roles.join(', ')}.` });
    }
    next();
  };
}

module.exports = { requireAuth, requirePerm, requireAnyPerm, requireRole, loadUser, getUserPermissions, JWT_SECRET };
