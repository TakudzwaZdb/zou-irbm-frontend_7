require('dotenv').config();
const cluster = require('cluster');
const os = require('os');

// Uses every CPU core the host actually has instead of the one Node.js
// uses by default — this app was single-process until now, so a 2-core
// machine was only ever using half of it, and a bigger production host
// would have used even less of its own capacity. Override with
// WEB_CONCURRENCY in .env (e.g. WEB_CONCURRENCY=1 for simpler local
// debugging — one process, no cluster indirection). See
// SECURITY_REVIEW.md / the load-test results shared with the user for the
// measurements that motivated this.
const WORKER_COUNT = Math.max(1, Number(process.env.WEB_CONCURRENCY) || os.cpus().length);

if (cluster.isPrimary) {
  // Every schema migration (backend/src/db.js) runs exactly once, right
  // here, before any worker is forked. node:sqlite's DatabaseSync API is
  // fully synchronous, so this require() doesn't return until every
  // migration has actually committed to disk. That ordering matters: each
  // worker below is a genuinely separate OS process with its own module
  // cache, so each one runs db.js's own migration-guard checks (PRAGMA
  // table_info(...) before an ALTER TABLE) independently — if two of them
  // ever raced on the very first launch, both could see a column missing
  // at the same instant and both try to add it, crashing the second one.
  // Requiring it here first means every worker's own check always finds
  // the schema already migrated and no-ops, safely. SQLite's WAL mode
  // (already enabled in db.js) is explicitly designed for exactly what
  // happens after this: several processes, one file, one writer at a
  // time, unlimited concurrent readers.
  require('./db');

  // Pass the resolved count down to every worker (including the
  // os.cpus().length default, not just an explicit override) — routes/
  // auth.js's login rate limiter reads it back to keep its effective
  // cluster-wide limit close to its intended 8-per-10-minutes even though
  // each worker now keeps its own independent in-memory counter (see the
  // comment there for why that split is necessary at all).
  process.env.WEB_CONCURRENCY = String(WORKER_COUNT);

  console.log(`Primary ${process.pid}: starting ${WORKER_COUNT} worker process(es) (set WEB_CONCURRENCY in .env to override).`);
  for (let i = 0; i < WORKER_COUNT; i++) cluster.fork();

  // A worker that crashes (an uncaught exception escaping a route
  // handler, say) takes only itself down — replace it so the app's real
  // capacity doesn't quietly shrink every time that happens instead of
  // silently running on fewer workers than intended.
  cluster.on('exit', (worker, code, signal) => {
    console.error(`Worker ${worker.process.pid} exited (code ${code}, signal ${signal}) — starting a replacement.`);
    cluster.fork();
  });
} else {
  runWorker();
}

function runWorker() {
  const path = require('path');
  const express = require('express');
  const cors = require('cors');
  const helmet = require('helmet');
  const compression = require('compression');

  const authRoutes = require('./routes/auth');
  const userRoutes = require('./routes/users');
  const orgRoutes = require('./routes/org');
  const kpiRoutes = require('./routes/kpis');
  const kpiTemplateRoutes = require('./routes/kpiTemplates');
  const auditRoutes = require('./routes/audit');
  const settingsRoutes = require('./routes/settings');
  const complianceRoutes = require('./routes/compliance');
  const plansRoutes = require('./routes/plans');
  const messagesRoutes = require('./routes/messages');

  const app = express();

  // If this app ever runs behind a reverse proxy / load balancer, uncomment
  // and set this so req.ip (used by the login rate limiter — see
  // routes/auth.js) reflects the real client rather than the proxy:
  // app.set('trust proxy', 1);

  // helmet's own defaults, unmodified — X-Content-Type-Options, X-Frame-
  // Options/frame-ancestors, and a real Content-Security-Policy. Verified
  // against what the built frontend actually loads: its default
  // style-src/font-src ("'self' https: 'unsafe-inline'" / "'self' https:
  // data:") already cover the Google Fonts <link> in index.html, and
  // img-src's "'self' data:" already covers avatar photos stored as data:
  // URLs. The one thing that needed a real code change rather than a CSP
  // exception was index.html's small inline theme-preference script — moved
  // to frontend/public/theme-init.js so default script-src ("'self'") is
  // never weakened with 'unsafe-inline' just to keep it working.
  app.use(helmet());

  // gzip/brotli-negotiated compression on every response this process
  // sends — JSON API responses and the static frontend build alike. Real,
  // measurable savings on the frontend's ~1.15MB JS bundle in particular;
  // compression's own default threshold (1kb) skips it for tiny responses
  // where the compression overhead would exceed the saving.
  app.use(compression());

  // This app is always served same-origin in real use — Express serves the
  // built frontend itself (see the static block below), and Vite's own dev
  // server proxies /api to this backend rather than calling it cross-origin
  // (see frontend/vite.config.js) — so cross-origin requests are never
  // actually needed and CORS_ORIGIN is unset by default (see
  // SECURITY_REVIEW.md's finding #5: a bare `cors()` sends
  // Access-Control-Allow-Origin: * to every site on the internet). Set
  // CORS_ORIGIN in .env to a comma-separated allowlist only if a separately
  // hosted frontend genuinely needs to call this API cross-origin.
  const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (corsOrigins.length) app.use(cors({ origin: corsOrigins }));

  // Raised from Express's 100kb default so a profile-photo upload (a base64
  // data: URL in the JSON body — see routes/auth.js's /me/avatar) fits; the
  // route itself enforces a tighter real cap on the image data.
  app.use(express.json({ limit: '3mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/org', orgRoutes);
  app.use('/api/kpis', kpiRoutes);
  app.use('/api/kpi-templates', kpiTemplateRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/compliance', complianceRoutes);
  app.use('/api/plans', plansRoutes);
  app.use('/api/messages', messagesRoutes);

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), worker: process.pid }));

  // Serve the built React frontend as static files so `npm start` (backend) is
  // enough to run the whole application from one process — open
  // http://localhost:PORT/. The frontend is a Vite + React + Tailwind app in
  // ../frontend; its production build (frontend/dist) is what's served here.
  // During frontend development, run `npm run dev` in frontend/ instead (Vite
  // dev server on :5173, proxying /api to this backend — see
  // frontend/vite.config.js) for hot reload.
  const frontendDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
  const assetsDir = path.join(frontendDir, 'assets');
  app.use(express.static(frontendDir, {
    setHeaders(res, filePath) {
      // Vite's own build output — frontend/dist/assets/*.js and *.css —
      // has a content hash baked into the filename (e.g.
      // index-RrOGiTXd.js): a code change always produces a different
      // URL, so these specific files are safe to cache for a full year
      // with `immutable` (the browser never even asks the server if its
      // cached copy is still good). This directory also holds files
      // copied verbatim from frontend/public/assets/ (the ZOU logo images)
      // that do NOT have a hash in their name — those, and index.html
      // itself, deliberately fall through to Express's own conservative
      // default (`Cache-Control: public, max-age=0`, revalidated via
      // ETag on every request) so an update to either is never stuck
      // behind a stale year-long cache.
      if (path.dirname(filePath) === assetsDir && /\.(js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontendDir, 'index.html'));
  });

  // Centralized error handler — keeps a stray exception in a route from
  // crashing the process, and never leaks stack traces to the client.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Worker ${process.pid}: ZOU Strategic Plan Monitor API + frontend listening on http://localhost:${PORT}`);
  });
}
