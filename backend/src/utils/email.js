const db = require('../db');

function emailFor(name) {
  const n = name.replace(/^(Mr|Mrs|Ms|Dr|Prof|Eng)\.?\s*/, '').split(/[—(]/)[0].trim();
  const parts = n.split(/\s+/).filter(Boolean);
  const first = (parts[0] || 'user').replace(/\W/g, '').toLowerCase();
  const last = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || 'user').replace(/\W/g, '').toLowerCase();
  return `${(first.charAt(0) || 'u')}.${last || 'user'}@zou.ac.zw`;
}

// Guarantees the returned address isn't already taken in the users table.
function uniqueEmailFor(name) {
  let email = emailFor(name);
  const taken = (e) => !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(e);
  if (!taken(email)) return email;
  let n = 2;
  while (taken(email.replace('@', `${n}@`))) n++;
  return email.replace('@', `${n}@`);
}

module.exports = { emailFor, uniqueEmailFor };
