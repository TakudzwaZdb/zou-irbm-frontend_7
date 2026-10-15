# How Users Get Into the System — and What's Actually Restricting Them

Status as of this session. Written after the auto-provisioning change made
earlier this session (`backend/src/routes/auth.js`'s `autoProvisionAzureUser`),
which is the main thing this report flags as needing a decision.

## 1. Every way an account can come to exist

There are exactly three paths. No others exist in the running app.

### A. A permission-holder adds them by hand (pre-existing, unchanged)

`POST /api/org/employees` (`backend/src/routes/org.js:523`), reachable by
anyone holding `manage_org_units`, `add_employee`, or `create_employees`.
That's not just "admin" — `add_employee` exists specifically so ICT admin
can hand it to a Unit Head or Sub Rep for their own team
(`org.js:512-522`). Whoever does it supplies just a name + email; the
account is created with:

- role = `default` (bare, read-only, scope-less)
- `password_hash = NULL`, `auth_provider = 'azure'`
- no permissions beyond `view_overview` + `view_framework`
  (`utils/permissions.js`'s `DEFAULT_PERMS_BY_ROLE.default`)

The person then completes their own sign-in via "Sign in with Microsoft" —
no password is ever set or handed to them.

### B. Auto-provisioned on first Microsoft sign-in (added this session)

`GET /api/auth/azure/callback` (`backend/src/routes/auth.js:483`). If the
email Microsoft hands back doesn't match any existing account, this route
now creates one automatically via `autoProvisionAzureUser`
(`auth.js:463-481`) — **no permission check, no admin step, no
pre-registration of any kind.** It gets the exact same bare `default` role
as path A.

**This is the path that needs a decision — see §3.**

### C. Privileged, password-based roles (exec, cpu, ictadmin, council, vc,
rep, unithead, programme, employee)

These are **never created by any API route while the app is running.**
Grepping every `POST`/`PUT` in `routes/users.js` turns up role changes,
permission grants, password resets, MFA management, and restores — never
account creation. The only place any of these roles' accounts are ever
created is `backend/src/seed.js`, a one-time script run by hand against
the database, not reachable over the network. `PATCH /users/:id/role`
changes an *existing* account's role; it cannot create a new one.

## 2. What's already solid

- Every new account, however it's created, starts powerless — read-only,
  no data entry, nothing to approve. Getting an account and getting real
  access are two separate, independently audited steps
  (`applyRolePermissions`, `manage_users`-gated promotion).
- Azure sign-in is pinned to one tenant **in code**, not just Azure Portal
  config: `azureAuth.js`'s authority is
  `https://login.microsoftonline.com/<AZURE_TENANT_ID>` — a personal
  Microsoft account or a different organization's tenant account is
  rejected before Microsoft even shows a sign-in prompt.
- A removed (soft-deleted) account's email is refused on sign-in, not
  silently reprovisioned as a fresh one (`auth.js:508-510`).
- Every auto-provision writes an `audit_log` row, so it's reviewable after
  the fact even though nothing blocks it beforehand.
- Path C's privileged roles are structurally unreachable from outside —
  there is no attack surface there at all.

## 3. The actual gap

Auto-provisioning (path B) has **no allowlist of any kind.** The only
thing standing between "outside the organisation" and "has an account" is
Microsoft Entra ID tenant membership — and that's a wider boundary than
"people the organisation has approved for this system":

- **Guest (B2B) accounts** already invited into your Entra ID tenant for
  something unrelated to this app (a vendor added to a Teams channel, a
  partner given document access) count as "in the tenant" and can
  self-provision here exactly like staff.
- **Any real staff member**, whether or not they were ever meant to touch
  this system, gets an account the instant they click the button — nobody
  in the organisation is making a "should this specific person have IRBM
  access" decision anywhere.
- The one mitigation for this is documented in `AZURE_SETUP.md` (Part B
  §1.3 / Part C §3: Azure Portal → Enterprise Applications → "Assignment
  required" + an explicit user/group list) but it is **Azure-Portal-only
  configuration the app cannot see or verify** — nothing stops someone
  from never doing it, or quietly turning it back off later. There is no
  check in the code itself.

Given how you described it — "only organisation registered people, not
outside the organisation" — auto-provisioning as it stands today does not
meet that bar on its own. It's real-tenant-member-or-guest, not
organisation-approved.

## 4. Options, strongest guarantee first

1. **Revert to pre-registration only (undo path B).** Remove
   auto-provisioning; go back to requiring someone with
   `add_employee`/`create_employees`/`manage_org_units` to add the name +
   email first, exactly as before this session. An unrecognized email is
   refused outright, never created. This is the only option that
   guarantees "nobody outside the organisation ever gets in or gets
   added" without depending on any Azure Portal setting being correctly
   configured and staying that way.
2. **Keep auto-provisioning, but enforce org membership in code.** Reject
   guest accounts using the ID token's membership claim (Microsoft's
   `idtyp`, or checking against a tenant/domain allowlist) so only true
   members — not guests, not anyone outside — can self-provision. Weaker
   than #1 (still no per-person approval), but closes the guest hole
   without removing the "no admin step needed" convenience.
3. **Leave the code as-is; rely entirely on Azure Portal.** Complete the
   "Assignment required" + assigned-group steps already documented. Least
   work, but the guarantee lives outside this app entirely and isn't
   something the app can enforce or verify.

## Bottom line

Option 1 is the one that unambiguously matches "only organisation
registered people... not outside the organisation must [get] access or be
added" — it removes the unattended path entirely rather than trying to
narrow who can use it. Say the word and I'll make that change (revert
`auth.js`'s `/azure/callback` to refuse an unrecognized email again,
remove `autoProvisionAzureUser`) and update `AZURE_SETUP.md` to match.
