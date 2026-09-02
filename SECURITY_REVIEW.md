# ZOU IRBM Strategic Plan Monitor — Security Review

Date: 2026-09-01 (updated same day — findings #1, #2, #3, #5, #6, and the
settings/KPI-value input-validation notes below are now fixed; see each
finding for what changed and where. README.md's "Before using this for
anything real" section has the same list in one place. Finding #4 — GET
endpoints not scope-filtered server-side — remains open by deliberate
choice; see that finding.)
Scope: full source review of `backend/src` (Express + `node:sqlite`) and `frontend/src` (React), plus `npm audit` on both packages. This is a manual code review, not a penetration test — it covers what's in the codebase, not runtime/deployment hardening (TLS termination, firewall, hosting config), which is outside this review's reach.

Findings are ordered by severity. Each one names the exact file/line, explains the real-world impact, and suggests a fix.

---

## High

### 1. Every new account is provisioned with a shared, predictable default password — FIXED
**Files:** `backend/src/routes/org.js:44,63,92,111`, `backend/src/seed.js:11`

**Fixed:** `POST /api/org/units` and `POST /api/org/individuals` now generate a
real random one-time password (`utils/password.js`'s `generateTempPassword`)
and set the new `must_change_password` flag; `POST /api/users/:id/reset-password`
does the same for admin resets. `middleware/auth.js`'s `requireAuth` blocks
every route except `GET /api/auth/me` and `POST /api/auth/change-password`
while that flag is set, and the frontend renders a real forced
`pages/ForcedPasswordChange.jsx` screen instead of the app. Seeded demo
accounts deliberately keep the documented shared password — see
README.md's "Before using this for anything real" for why that's a
conscious exception, not an oversight.

Both `POST /api/org/units` (creates a Unit Head account) and `POST /api/org/individuals` (creates an Individual account) hash the password with:
```js
bcrypt.hashSync(process.env.SEED_PASSWORD || 'Zou@2026', 10)
```
`.env` does not set `SEED_PASSWORD`, so in the current configuration **every account ever created — seeded or provisioned later — gets the literal password `Zou@2026`.** There is no `must_change_password` flag in the `users` table and no forced-rotation flow; a new user can sign in and simply never change it. `change-password` (auth.js) is the only route that updates it, and it's entirely opt-in.

Combined with finding #2 below (predictable emails, `f.lastname@zou.ac.zw`) and #3 (no login rate-limiting), this is a real credential-stuffing path: anyone who knows or guesses a handful of staff names can try `Zou@2026` against their derived email with no lockout.

**Fix:** generate a random per-account password (the same `crypto.randomBytes(...).toString('base64url')` pattern already used in `users.js`'s admin reset-password route), add a `must_change_password` column, and force a change on first login before any other route is reachable.

### 2. `JWT_SECRET` is left at its documented placeholder value — FIXED
**Files:** `backend/.env`, `backend/.env.example`, `backend/src/middleware/auth.js:4`

**Fixed:** rotated to a fresh random 64-character value in `backend/.env`
(invalidating every previously-issued token — everyone needs to sign in
again, which is the correct response to a compromised secret). The
`dev-secret-do-not-use-in-production` fallback is gone entirely —
`middleware/auth.js` now throws on startup if `JWT_SECRET` is unset,
instead of silently signing tokens with a guessable value.

The deployed `.env` still has `JWT_SECRET=change-this-to-a-long-random-string-in-production` — the exact text that ships in `.env.example` (and in the README). Anyone who has seen the example file or the docs knows the production secret. Whoever holds it can forge a valid JWT for any user id (`jwt.sign({ sub: <any id> }, knownSecret)`) and get a fully authenticated session as anyone, including an ICT System Administrator, without ever touching a password.

**Fix:** generate a long random value (`openssl rand -hex 32`) and set it in the real `.env` before any real deployment; treat the current value as already compromised and rotate it (this invalidates all existing sessions, which is the correct response).

### 3. No rate limiting or lockout on login — FIXED
**File:** `backend/src/routes/auth.js:11` (`POST /login`)

**Fixed:** `POST /api/auth/login` is now behind `express-rate-limit` — 8
attempts per 10 minutes per IP, returning a clear 429 once exceeded.
Verified live: the 9th rapid attempt in this session's own testing was
correctly rejected.

`POST /api/auth/login` has no attempt throttling, no CAPTCHA, and no account lockout — nothing in `server.js` applies rate limiting to any route (`express-rate-limit` isn't even a dependency). An attacker can attempt unlimited password guesses per account, per second, bounded only by network throughput. This is what turns finding #1's shared default password into a practical attack rather than a theoretical one.

**Fix:** add `express-rate-limit` (or an equivalent) on `/api/auth/login`, keyed by IP and/or email, with a short lockout/backoff after repeated failures.

---

## Medium

### 4. Read endpoints are authenticated but not authorized — any signed-in account can read the whole university's data
**Files:** `backend/src/routes/kpis.js:194,198,209,220,230,281`, `org.js:15`, `plans.js` (GET `/`), `compliance.js:53`, `kpiTemplates.js:29`

Every `GET` in these files sits behind `requireAuth` only — no `requirePerm`/role/scope check. So `GET /api/kpis`, `GET /api/kpis/values`, `GET /api/kpis/contributions`, `GET /api/org`, `GET /api/plans`, and `GET /api/compliance` all return **every KPI, every value, every contribution, the full org tree, and the full budget/compliance picture, system-wide**, to any authenticated user regardless of role or scope. The frontend narrows what it *shows* per role (an Individual's UI only browses their own branch), and the "view_overview" / "view_framework" / newly-added "view_institutional_performance" permissions gate *navigation*, but none of it is enforced server-side — a scoped user (e.g. an Individual or Unit Head) can call these endpoints directly (browser devtools, curl with their own real token) and get data far outside what the UI ever shows them: other units' and other Programmes' KPI figures, other people's submitted explanations, and the full budget roll-up.

This is a real, working codebase, and the code comments show it's a deliberate, acknowledged simplification ("the frontend narrows what it SHOWS... a larger deployment would filter server-side too" — `org.js:11-14`), not an oversight nobody noticed. I'm flagging it because "acceptable for a reference build" and "acceptable once this is used with real staff performance data" are different bars, and worth a conscious decision rather than an inherited default.

**Fix (if this app is going into real use):** add scope filtering to these GET handlers — reuse the same `isOwner`/`inJurisdiction`/scope-chain helpers already written for the mutating routes (`kpis.js`'s `inJurisdiction`, `kpiSubId`, etc.) to filter the SQL by the caller's role/scope, the same way the write endpoints already do.

### 5. Permissive CORS with no security headers — FIXED
**File:** `backend/src/server.js:18`

**Fixed:** `cors()` is no longer applied unconditionally — it only runs
(with a real allowlist) if `CORS_ORIGIN` is set in `.env`, which it isn't
by default, since this app is always same-origin in real use. `helmet()`
now runs on every response (CSP, `X-Frame-Options`, `X-Content-Type-Options`,
etc.) — verified live via response headers. The one real code change this
needed: `index.html`'s inline theme-preference script moved to
`public/theme-init.js` so `script-src` could stay at helmet's default
`'self'` rather than needing an `'unsafe-inline'` exception.

`app.use(cors())` with no options sends `Access-Control-Allow-Origin: *` — any website can make cross-origin requests to this API from a visitor's browser and read the JSON response. Real-world risk here is currently limited (auth is a manually-attached Bearer token from `localStorage`, not an ambient cookie, so a third-party site can't ride an authenticated session without also stealing the token), but it's an unnecessary door left open, and it stacks with #4: a malicious page could ask a signed-in visitor's browser to fetch `/api/org` or `/api/kpis` cross-origin — normally CORS would prevent that page from reading the response for a credentialed request, but since this API doesn't use cookies for auth (the token has to be manually sent), realistically the wildcard alone isn't directly exploitable without a token. Still worth restricting.

Separately, there's no `helmet` (or equivalent) — no `X-Content-Type-Options`, `X-Frame-Options`/frame-ancestors, HSTS, or CSP headers on any response.

**Fix:** `cors({ origin: <your real frontend origin(s)> })`, and add `helmet()`.

### 6. JWT has no revocation path — FIXED
**File:** `backend/src/middleware/auth.js:22-36`

**Fixed:** every user row now has a `token_version`; each JWT embeds the
value it was signed against, and `requireAuth` rejects a token whose
embedded version no longer matches the account's current one. It bumps on
a password change, an admin password reset, and a new self-service "Sign
out everywhere" action (`POST /api/auth/logout-everywhere`, exposed on My
Profile) — verified live in this session: an old token stopped working
immediately after each of those, well before its 12h natural expiry.

Tokens are stateless, 12-hour bearer tokens with no server-side session/allow-list. Permissions are correctly re-checked live from the DB on every request (a revoked permission takes effect immediately — verified in this review), but the token itself can't be invalidated: if a device is lost, or an account is deleted mid-session, the bearer token stays cryptographically valid until it naturally expires up to 12 hours later (account deletion is actually handled — `loadUser` returns `null` for a missing user id and `requireAuth` correctly 401s — so that specific case is fine). The real gap is "someone's laptop with an open, still-valid session is stolen" — there's no way to force that one token dead early.

**Fix:** track a `token_version` (or `sessions`) column per user, embed it in the JWT payload, and bump it on demand (a "sign me out everywhere" action) to invalidate outstanding tokens without waiting for expiry.

---

## Low / hardening notes

- **`frontend/.env`-served JWT in `localStorage`** (`frontend/src/context/AppContext.jsx:81,86,223`): standard for a token-based SPA, but it means any future XSS becomes a full account-takeover primitive (token is readable by any script on the page), whereas an `httpOnly` cookie wouldn't be. I found no actual XSS sink in this review (see below) — this is a defense-in-depth note, not an active bug.
- **No XSS sinks found.** Grepped the whole frontend for `dangerouslySetInnerHTML`, raw `innerHTML`, `eval`, and `new Function` — none exist. Message bodies, KPI names, comments, etc. are all rendered through normal JSX text interpolation (e.g. `Messages.jsx:150`'s `{m.body}`), which React auto-escapes. Good.
- **No SQL injection found.** Every `db.prepare(...)` in the codebase binds user-supplied values through `?` placeholders; the few template-literal SQL strings that exist either build `?`-placeholder lists dynamically (`messages.js:51,85` — safe, only the placeholder count varies) or interpolate **hardcoded** column names supplied by the route code itself, never by the request body (`plans.js:24-34`'s `upsertDraft` — every call site passes a fixed object literal, e.g. `{ narrative, budget, status }`, never `req.body` directly). That said, `upsertDraft` taking a raw `fields` object and turning its keys into column names was a fragile pattern. **FIXED** — `upsertDraft` now throws if `fields` contains any key outside `{ narrative, budget, status }`, so a future careless call site can't quietly reintroduce a column-name injection.
- **`PATCH /api/settings`** (`settings.js:15-18`) writes every key in the request body straight into the `settings` table with no whitelist. **FIXED** — now checks every key against a fixed set of the 9 real setting keys this app reads anywhere, rejecting anything else with a 400.
- **`PUT /api/kpis/:id/value`** (`kpis.js:497-518`) and **`PUT /api/kpis/:id/contribution`** stored `value`/`entered_value` with no type or bounds validation. **FIXED** — both now reject a non-`null` value that isn't a finite number.
- **Frontend dependency: `vite`/`esbuild` (dev-server only) — 1 high, 1 moderate advisory** (`npm audit` on `frontend/`): the known esbuild dev-server CORS issue (GHSA-67mh-4wv8-2f99), fixed only by a breaking `vite@8` upgrade. This only matters when running `vite dev` (`npm run dev`); the shipped production build (`frontend/dist`, served statically by Express in `server.js`) is unaffected. Backend dependencies: `npm audit` reports **0** known vulnerabilities.
- **Admin-set passwords accepted without a strength check beyond length** (`users.js:83-98`, `org.js`'s provisioning routes): only a `length >= 8` floor. Not unusual for an internal tool, but worth pairing with the forced-rotation fix in finding #1 rather than leaving it as the only bar.

---

## What's already solid

Worth saying plainly, since a security review can read as all-bad-news otherwise: the things that matter most here are done right.

- **Passwords are real bcrypt hashes** (`bcryptjs`, cost factor 10), never stored or compared in plaintext; login always returns the same generic "Incorrect email or password" error whether the email doesn't exist or the password is wrong, so the login form doesn't leak which accounts exist.
- **Every mutating (`POST`/`PUT`/`PATCH`/`DELETE`) endpoint I checked re-derives ownership/scope from the database and checks it against `req.user`, never trusting anything the client claims** — `kpis.js`'s `isOwner`/`isApprover`/`isUnitHeadOwner`/`inJurisdiction`, `plans.js`'s `isUnitOwner`/`isSubOwner`/`isProgrammeHeadOwner`, and `org.js`'s inline scope check on `POST /individuals` are all real, server-side, can't-be-bypassed-from-devtools checks, not decorative ones.
- **Permission checks are live, not cached in the token.** `requireAuth` reloads `req.user.permissions` from the `user_permissions` table on every single request (`middleware/auth.js:13-18`), so revoking a permission takes effect on the very next request — I confirmed this behavior directly in this session's earlier grant/revoke testing of `view_institutional_performance`.
- **Messaging is correctly scoped**: inbox/sent queries filter by `recipient_id`/`sender_id = req.user.id`, and read/delete both re-check that the caller is actually a party to the message before acting (`messages.js:103-140`) — no IDOR there.
- **The centralized error handler never leaks stack traces** (`server.js:53-56`) — every unhandled exception becomes a generic `Internal server error` to the client while the real error is logged server-side only.
- **A real, append-only audit log** records who did what to whom for every sensitive action (permission grants/revokes, role changes, password resets, approvals, deletions) — genuinely useful for after-the-fact investigation, not just decorative.
- **No SQL injection, no XSS sink, and 0 backend dependency vulnerabilities**, as detailed above.

---

## Priority if you want to act on this

If this is heading toward real deployment with real staff data:

1. ~~Rotate `JWT_SECRET` to a real random value (#2)~~ — done.
2. ~~Kill the shared default password — random per-account password + forced change on first login (#1)~~ — done.
3. ~~Add login rate limiting (#3)~~ — done. These three together were the chain that mattered most.
4. ~~`helmet()` + real CORS origin (#5) and a token-revocation path (#6)~~ — done.
5. ~~Settings-key whitelist, KPI-value bounds validation, `upsertDraft` field whitelist~~ — done.
6. **Still open, on purpose:** decide whether finding #4 (server-side read scoping across `/api/kpis`, `/api/org`, `/api/plans`, `/api/compliance`) is acceptable for how this will actually be used, and filter those GET endpoints if not. This is the one remaining item and it's a real, separate piece of work — touches most read routes, needs re-testing across all 8 roles.

Everything remaining in "Low / hardening notes" (MFA, HTTPS/hosting, a real backup strategy for the SQLite file, a formal IT/security sign-off) is worth doing but isn't urgent and is outside what source-code changes alone can fix.
