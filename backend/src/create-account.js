// Creates ONE real account directly — the tool for replacing a fictional
// seed.js persona (or bootstrapping the very first real admin) with an
// actual person, without wiping/rebuilding the whole database the way
// `npm run seed` does. Intentionally narrow: only for the org-wide,
// unscoped roles (exec, vc, cpu, ictadmin, council) — a Programme Head,
// Sub Rep, Unit Head, or Employee needs a real Programme/Sub/Unit id to be
// scoped to, which only Organisation Builder's own flows can supply
// correctly; this script refuses those roles rather than guess.
//
// Two sign-in modes:
//   --azure           auth_provider = 'azure', no password at all — the
//                      person signs in via "Sign in with Microsoft" using
//                      this exact email against your configured Entra ID
//                      tenant (see AZURE_SETUP.md). This is the default
//                      and the recommended mode: nothing here can ever be
//                      guessed or leaked because nothing here IS a
//                      password.
//   --password=<pw>   auth_provider = 'local' — a real bcrypt hash is
//                      stored and the account is flagged
//                      must_change_password, exactly like every other
//                      admin-issued password in this app (see
//                      utils/password.js's convention and routes/
//                      users.js's POST /:id/reset-password) — the value
//                      you pass is a ONE-TIME password the person changes
//                      on first login, never a long-term secret.
//
// Usage:
//   node src/create-account.js --email=zuzet@zou.ac.zw --role=ictadmin \
//     --name="Zuzet ..." [--title="ICT Systems Administrator"] [--azure]
//   node src/create-account.js --email=... --role=cpu --name="..." \
//     --password="<one-time password>"
//
// Safe to run against any database `db.ready()` can reach — it does NOT
// wipe or touch anything else (unlike seed.js), and refuses outright if
// the email is already in use rather than silently overwriting an
// existing account.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { applyRolePermissions } = require('./middleware/auth');

const UNSCOPED_ROLES = new Set(['exec', 'vc', 'cpu', 'ictadmin', 'council']);
const ROLE_LABELS = {
  exec: 'Executive', vc: 'Vice Chancellor', cpu: 'Corporate Planning Unit',
  ictadmin: 'ICT Systems Administrator', council: 'University Council',
};

function parseArgs(argv) {
  const out = { azure: false };
  for (const arg of argv) {
    if (arg === '--azure') { out.azure = true; continue; }
    const m = /^--([a-zA-Z-]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function fail(message) {
  console.error(`\nError: ${message}\n`);
  process.exitCode = 1;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));

  const email = (args.email || '').trim().toLowerCase();
  const role = (args.role || '').trim().toLowerCase();
  const name = (args.name || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail('Pass a real, valid email with --email=someone@zou.ac.zw');
  }
  if (!UNSCOPED_ROLES.has(role)) {
    return fail(
      `--role must be one of: ${[...UNSCOPED_ROLES].join(', ')}. ` +
      `A Programme Head, Sub Rep, Unit Head, or Employee needs a real ` +
      `organisation scope this script can't safely guess — create those ` +
      `through Organisation Builder in the running app instead.`
    );
  }
  if (!name) {
    return fail('Pass the real person\'s name with --name="Full Name" (shown throughout the app and audit log — get it right the first time; it can also be changed later from the Users page).');
  }
  if (!args.azure && !args.password) {
    return fail('Pass either --azure (Microsoft sign-in, no password) or --password="<one-time password>" (they set a real one on first login).');
  }
  if (args.azure && args.password) {
    return fail('Pass --azure OR --password, not both — an account signs in one way or the other.');
  }

  await db.ready();

  const existing = await db.prepare('SELECT id, deleted_at FROM users WHERE email = ?').get(email);
  if (existing) {
    return fail(
      `${email} is already in use by an existing account (id ${existing.id}` +
      `${existing.deleted_at ? ', currently removed — restore it from the Users page instead of creating a new one' : ''}). ` +
      `To rename/re-point an existing account, use the Users page (or PATCH /api/users/:id/profile) instead of this script.`
    );
  }

  const title = (args.title || '').trim() || ROLE_LABELS[role];
  const authProvider = args.azure ? 'azure' : 'local';
  const passwordHash = args.azure ? null : bcrypt.hashSync(args.password, 10);

  const { lastInsertRowid: userId } = await db
    .prepare(
      'INSERT INTO users (name, title, email, password_hash, role, scope_type, scope_id, auth_provider, must_change_password) ' +
      'VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)'
    )
    .run(name, title, email, passwordHash, role, authProvider, args.azure ? 0 : 1);

  await applyRolePermissions(userId, role);

  await db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    userId, 'create_account', 'user', userId,
    `"${name}" (${email}) provisioned directly as ${title} via create-account.js` +
    (args.azure ? ' — signs in with Microsoft, no password set.' : ' — one-time password set, must change on first login.')
  );

  console.log(`\nCreated: ${name} <${email}> — role "${role}" (${title}), id ${userId}.`);
  if (args.azure) {
    console.log('Signs in exclusively via "Sign in with Microsoft" — make sure this email is reachable through your configured Entra ID tenant and (if you\'ve restricted it) on the Enterprise Application\'s assigned users/groups list. See AZURE_SETUP.md.');
  } else {
    console.log('One-time password set — this account must change it on first sign-in.');
  }
  console.log('Rename, change role, or remove this account any time from the Users page.\n');

  await db.close();
})().catch((err) => {
  console.error('\ncreate-account.js failed:', err.message);
  process.exitCode = 1;
});
