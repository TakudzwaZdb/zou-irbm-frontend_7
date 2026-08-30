require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

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
app.use(cors());
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

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve the built React frontend as static files so `npm start` (backend) is
// enough to run the whole application from one process — open
// http://localhost:PORT/. The frontend is a Vite + React + Tailwind app in
// ../frontend; its production build (frontend/dist) is what's served here.
// During frontend development, run `npm run dev` in frontend/ instead (Vite
// dev server on :5173, proxying /api to this backend — see
// frontend/vite.config.js) for hot reload.
const frontendDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDir));
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
  console.log(`ZOU Strategic Plan Monitor API + frontend listening on http://localhost:${PORT}`);
});
