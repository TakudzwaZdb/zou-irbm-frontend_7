// Applied before first paint so an explicit light/dark choice never
// flashes the wrong theme for a moment while React boots. 'system'
// (the default, nothing stored) leaves no attribute — index.css's
// prefers-color-scheme media query then decides.
//
// A real external file rather than an inline <script> in index.html so it
// can run under a real script-src Content-Security-Policy (see
// backend/src/server.js's helmet() — 'self' only, no 'unsafe-inline')
// without needing an exception carved out for it.
(function () {
  try {
    var t = localStorage.getItem('zou-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
