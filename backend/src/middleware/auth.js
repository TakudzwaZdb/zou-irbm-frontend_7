const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production';

function getUserPermissions(userId) {
  return db
    .prepare('SELECT permission_key FROM user_permissions WHERE user_id = ?')
    .all(userId)
    .map((r) => r.permission_key);
}

function loadUser(userId) {
  const user = db.prepare('SELECT id, name, title, email, role, scope_type, scope_id, avatar FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  user.permissions = getUserPermissions(user.id);
  return user;
}

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
  const user = loadUser(payload.sub);
  if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
  req.user = user;
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
