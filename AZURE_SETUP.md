# Azure Setup Guide

This app touches Azure in two independent places. You can set up either one
on its own — neither depends on the other, and both degrade gracefully when
unconfigured (the app falls back to local behavior, or returns a clear
`503` rather than crashing).

1. **Azure Database for PostgreSQL** — an optional managed home for the
   database instead of a local Postgres instance. Not Azure-specific code;
   any Postgres works, this just documents the Azure option since it's the
   natural pairing for an org already on Azure.
2. **Microsoft Entra ID (work/school account sign-in)** — how every
   **Individual** account (see `routes/org.js`'s `POST /individuals`) signs
   in. An Individual is created with just a name and a pre-approved email —
   no password is ever set for them — and they complete their own sign-in
   by clicking **"Sign in with Microsoft"** on the login page. No other
   role (exec, CPU, ICT admin, Programme Head, Sub Rep, Unit Head) is
   affected — they keep signing in with a password exactly as before.
3. **Azure App Service** — an optional place to actually host the running
   app (both parts above work the same wherever the app runs). Part C below
   covers this.

---

## Part A — Azure Database for PostgreSQL (optional)

Skip this section entirely if you're running against a local or
self-managed Postgres instance — `backend/src/db.js` reads the standard
`PG*` environment variables (or a single `DATABASE_URL`) and doesn't care
who's hosting the server.

1. In the Azure Portal, create an **Azure Database for PostgreSQL Flexible
   Server**. Any tier works for evaluation; production should size for the
   app's actual write volume (KPI submissions, not high-throughput).
2. Under the server's **Networking** settings, allow the app's outbound IP
   (or, for quick local testing only, allow your own client IP) — Flexible
   Server denies all connections by default.
3. Create a database on the server (e.g. `zou_irbm`) and a login role with
   a strong password.
4. Set these in `backend/.env`:

   ```
   PGHOST=<your-server-name>.postgres.database.azure.com
   PGPORT=5432
   PGUSER=<your-role-name>
   PGPASSWORD=<your-password>
   PGDATABASE=zou_irbm
   DB_SSL=true
   ```

   (Equivalently, a single `DATABASE_URL=postgresql://user:pass@host:5432/zou_irbm?sslmode=require`
   works too — `db.js` accepts either form, and a `DATABASE_URL` takes
   precedence if both are set.)

   Flexible Server requires TLS; `DB_SSL=true` is what turns it on.
   `db.js` sets `rejectUnauthorized: false` when SSL is enabled, so this
   works out of the box without bundling Azure's root CA. If your
   organization's policy requires full certificate-chain verification
   instead, download Azure's current CA bundle and pass it as
   `ssl: { ca: fs.readFileSync('/path/to/DigiCertGlobalRootCA.crt.pem') }`
   in `db.js`'s `poolConfig.ssl` in place of `rejectUnauthorized: false`.
5. Run `node src/seed.js` once against the new database to create its
   schema and demo accounts, the same as for local Postgres.
6. `backend/src/backup.js` (`pg_dump`/`pg_restore`-based) works unchanged
   against a Flexible Server target — it reads the same `PG*` env vars.

---

## Part B — Microsoft Entra ID sign-in for Individuals

This is what actually powers the "Sign in with Microsoft" button. Every
Individual account signs in this way exclusively — there is no password
fallback for them (see `routes/auth.js`'s `/login` guard, which rejects a
password attempt against an `auth_provider = 'azure'` account with a clear
message pointing at this button instead).

### 1. Register the app in Microsoft Entra ID

1. In the [Azure Portal](https://portal.azure.com), go to **Microsoft
   Entra ID → App registrations → New registration**.
2. Name it something recognizable, e.g. "ZOU IRBM Strategic Plan Monitor".
3. Under **Supported account types**, choose **"Accounts in this
   organizational directory only (single tenant)"** — this restricts
   sign-in to your own organization's Microsoft accounts, matching the
   pre-approved-email model (only a name+email an admin already entered in
   Organisation Builder can ever complete this flow successfully — see the
   email-match check in `routes/auth.js`'s `/azure/callback`).
4. Under **Redirect URI**, choose platform **Web** and enter your backend's
   callback URL:
   - Local development: `http://localhost:4000/api/auth/azure/callback`
   - Production: `https://<your-deployed-backend-host>/api/auth/azure/callback`

   You can add both now, or add the production one later under
   **Authentication → Add a platform**.
5. Click **Register**.

### 2. Collect the tenant ID and client ID

On the app registration's **Overview** page, copy:
- **Application (client) ID** → `AZURE_CLIENT_ID`
- **Directory (tenant) ID** → `AZURE_TENANT_ID`

### 3. Create a client secret

1. Go to **Certificates & secrets → Client secrets → New client secret**.
2. Give it a description and an expiry (Azure won't let you pick "never" —
   plan to rotate it before it expires; the app has no auto-rotation).
3. Copy the secret's **Value** immediately — Azure only shows it once.
   This is `AZURE_CLIENT_SECRET`.

### 4. API permissions

The default `User.Read` delegated permission (added automatically on
registration) is all this app needs — it only reads the signed-in user's
own basic profile (`email`/`oid`/`name` from the ID token claims,
extracted in `backend/src/utils/azureAuth.js`). No admin consent or extra
Graph permissions are required.

### 5. Configure the backend

Set these in `backend/.env` (they're pre-listed there, commented out):

```
AZURE_TENANT_ID=<Directory (tenant) ID from step 2>
AZURE_CLIENT_ID=<Application (client) ID from step 2>
AZURE_CLIENT_SECRET=<secret value from step 3>
AZURE_REDIRECT_URI=http://localhost:4000/api/auth/azure/callback
AZURE_POST_LOGIN_REDIRECT=http://localhost:5173/
```

- `AZURE_REDIRECT_URI` must exactly match a redirect URI registered in
  step 1 (scheme, host, port, and path all have to match — Azure rejects a
  mismatch at the authorization step, before it ever reaches this app).
- `AZURE_POST_LOGIN_REDIRECT` is where the *frontend* lives — after a
  successful sign-in, the backend's `/azure/callback` route sends the
  whole browser back here with the app's own session token in the URL
  fragment (`#azure_token=...`), which `frontend/src/pages/Login.jsx`
  picks up on mount and clears immediately. In production this should be
  your deployed frontend's origin (e.g. `https://irbm.zou.ac.zw/`).
- Leaving any of the four unset is fine — `azureAuth.js`'s `isConfigured()`
  checks all four are present, and `GET /api/auth/azure/login` returns a
  clean `503 { error: 'Microsoft sign-in is not configured.' }` instead of
  crashing when they're not. The "Sign in with Microsoft" button is always
  shown on the login page regardless (it's a real navigation, not a
  conditional render), so this is the only signal you'll see locally that
  it still needs configuring.

### 6. Restart the backend

Environment variables are read once at process start
(`backend/src/utils/azureAuth.js`) — restart `node src/server.js` (or your
process manager) after editing `.env` for the new values to take effect.

### 7. Try it

1. Add a test Individual in **Organisation Builder** using a real email
   address that belongs to your Azure AD tenant (any account in the
   directory — it doesn't need to already exist as an app user; the app
   creates the account with `auth_provider = 'azure'` at that point, and
   it's this exact email the person must sign in with).
2. From the login page, click **Sign in with Microsoft**, and sign in with
   that same Microsoft account. On success you land back on the app,
   already authenticated as that Individual, read-only (`default` role —
   `view_overview` + `view_framework` only, per `utils/permissions.js`).
3. If the email you sign in with doesn't match any account in the
   database (or matches one that isn't `auth_provider = 'azure'`), the
   callback redirects back to the login page with a clear error message in
   the URL fragment (`#azure_error=...`) instead of silently failing —
   `Login.jsx` reads and displays it, then clears the fragment.

### Troubleshooting

- **`AADSTS50011` (redirect URI mismatch)** — `AZURE_REDIRECT_URI` in
  `.env` doesn't exactly match a URI registered on the app registration's
  **Authentication** page. Check scheme/host/port/path character-for-
  character.
- **`503` from `/api/auth/azure/login`** — one of the four `AZURE_*` env
  vars is missing or empty; `isConfigured()` requires all four.
- **Signs in successfully but lands on an error screen** — the signed-in
  email doesn't match any `auth_provider = 'azure'` account in `users`.
  Check the email was entered exactly (case-insensitively; `org.js` lowers
  it on creation) when the Individual was added in Organisation Builder.
- **Client secret stopped working** — it expired (step 3's expiry).
  Generate a new one in **Certificates & secrets** and update
  `AZURE_CLIENT_SECRET`.

---

## Part C — Deploying to Azure App Service (optional)

This app is a single Node process (`backend/src/server.js`) that serves
both the REST API and the built React frontend (`frontend/dist`) — see
`server.js`'s own comment above its static-file block. That means it fits
a single **Azure App Service** Web App (Linux, Node runtime) with no
separate static-hosting piece needed; there's nothing here that needs a
Static Web App, Front Door, or a second service.

### 1. Create the App Service

1. In the Azure Portal, **Create a resource → Web App**.
2. **Publish**: Code. **Runtime stack**: Node 22 LTS (matches this
   project's `engines.node: ">=22.5.0"` in `backend/package.json` — check
   `az webapp list-runtimes --os linux` if 22 isn't listed yet in your
   region and pick the newest available 22.x or later). **Operating
   System**: Linux.
3. Pick a region close to your users (and close to the database, if using
   Azure Database for PostgreSQL from Part A — cross-region database calls
   add real latency to every request).
4. Any tier works for evaluation; a tier with **Always On** support (Basic
   B1 or above) is what you want for production — see the note on cold
   starts below.

### 2. Application settings (environment variables)

Under the App Service's **Settings → Environment variables** (Configuration
in older Portal layouts), add the same variables `backend/.env.example`
lists, as **Application settings** (never commit real secrets to `.env` in
the repo — these live only in Azure):

- `JWT_SECRET` — a long random value (see `.env.example`'s comment for how
  to generate one). Required; the app refuses to start without it.
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (or a single
  `DATABASE_URL`) — pointed at your database. `DB_SSL=true` if it's Azure
  Database for PostgreSQL (see Part A) or any other Postgres that requires
  TLS.
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
  `AZURE_REDIRECT_URI`, `AZURE_POST_LOGIN_REDIRECT` — only if enabling
  "Sign in with Microsoft" (Part B). `AZURE_REDIRECT_URI` here is the
  **production** callback URL (`https://<your-app-name>.azurewebsites.net/api/auth/azure/callback`,
  or your custom domain if one is mapped) — remember to also add this
  exact URI to the App Registration's **Authentication → Redirect URIs**
  in Part B, alongside the local one. `AZURE_POST_LOGIN_REDIRECT` becomes
  that same production URL too, since this app serves the frontend from
  the same origin.
- `WEB_CONCURRENCY` — set this **explicitly** on App Service rather than
  leaving it unset. `server.js` defaults to one worker per CPU core
  (`os.cpus().length`), but inside a container that number can reflect the
  underlying host rather than what your App Service Plan's pricing tier
  actually entitles you to, which can over-fork. Match it to your plan's
  actual vCPU count (e.g. `WEB_CONCURRENCY=1` for a B1/S1 plan).
- `WEBSITE_NODE_DEFAULT_VERSION` — only needed if you're not setting the
  Node version via the runtime-stack picker in step 1.

You do **not** need to set `PORT` — Azure's Linux Node containers inject
their own `PORT` and this app already listens on `process.env.PORT` (see
`server.js`), so it picks that up automatically.

### 3. Startup command

Under **Settings → Configuration → General settings → Startup Command**,
set:

```
node backend/src/server.js
```

This assumes the deployed package's root contains `backend/` (with its
`node_modules` already installed) and `frontend/dist/` as siblings — which
is exactly what the deployment package below produces. App Service runs
the startup command from `/home/site/wwwroot`, which is where a deployed
zip's contents land.

### 4. Health check

Set **Settings → Health check** to `/api/health` (already implemented in
`server.js`, returns `{ ok: true, time, worker }`) so App Service can
detect and recycle an unhealthy instance automatically, and so a rolling
deploy or scale-out waits for a new instance to actually be serving before
sending it traffic.

### 5. Always On

Turn on **Settings → Configuration → General settings → Always On** (Basic
tier and above). Without it, App Service unloads an idle app and the next
request pays a real cold-start cost (npm's dependency load, this app's own
`db.ready()` schema check, cluster fork) — this app was measured under
load in `README.md`'s "Performance & caching" section, but always-on state
after idling isn't something either of those measurements covers, and a
monitoring dashboard someone actually depends on shouldn't have a cold
first load.

### 6. A note on local disk

App Service's local filesystem (`/home` inside the container) is **not**
guaranteed durable or shared across scale-out instances the way a
developer's own disk is. That matters for one thing this app writes
locally: `backend/data/backups/` (see `npm run backup` in the README).
Either:
- run backups from somewhere else entirely — a scheduled GitHub Actions
  job, an Azure Automation runbook, or your own machine — pointed at the
  production database via its `PG*`/`DATABASE_URL` variables and writing
  to durable storage (e.g. upload each `.dump` to an Azure Storage blob
  container right after `node src/backup.js` finishes), or
- mount an Azure Storage **File Share** into the App Service (**Settings →
  Path mappings**) and set `BACKUP_DIR` to that mount path.

Either way, do this before relying on backups in production — the default
(`backend/data/backups/` inside the container) is fine for a quick manual
check but not for anything you'd actually restore from later.

### 7. Deploying: GitHub Actions

`.github/workflows/azure-deploy.yml` in this repo builds the frontend,
assembles it next to the backend the way `server.js` expects, and
zip-deploys that package on every push to `main`. One-time setup:

1. Replace `AZURE_WEBAPP_NAME` in the workflow file with your App
   Service's actual name.
2. In the App Service's **Overview**, click **Download publish profile**.
3. In the GitHub repo's **Settings → Secrets and variables → Actions**,
   add a new secret `AZURE_WEBAPP_PUBLISH_PROFILE` with that file's full
   contents.
4. Push to `main` (or run the workflow manually via **Actions → Build and
   deploy to Azure App Service → Run workflow**).

Prefer not to store a publish profile as a long-lived secret? The
`azure/webapps-deploy` action also supports Azure login via OpenID Connect
(a federated credential on a separate App Registration from the Entra ID
one in Part B, scoped to `Website Contributor` on just this App Service) —
see [Azure's GitHub Actions OIDC docs](https://learn.microsoft.com/azure/app-service/deploy-github-actions)
if your organization requires that instead.

If you'd rather deploy by hand once, without CI: build the frontend
(`cd frontend && npm run build`), install backend production dependencies
(`cd backend && npm ci --omit=dev`), zip `backend/` and `frontend/dist/`
together with that same sibling layout, and either `az webapp deploy
--src-path <zip> --name <app-name> --resource-group <rg>` or drag the zip
onto the Portal's **Deployment Center → ZIP Deploy**.

### 8. Verify

After the first deploy: `https://<your-app-name>.azurewebsites.net/api/health`
should return `{ "ok": true, ... }`, and the login page should load at the
site's root. Run `npm run seed` once against the production database
before the first real use (from wherever you can reach it — the App
Service's **SSH** console under **Development Tools**, or from your own
machine with `PG*`/`DATABASE_URL` pointed at it) so there's an initial org
structure and at least one `ictadmin` account to sign in with.
