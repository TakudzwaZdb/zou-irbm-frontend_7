// Thin fetch wrapper around the real backend REST API. Relative paths work
// both in dev (Vite proxies /api to the backend — see vite.config.js) and in
// production (Express serves this build and the API from the same origin).
let token = null;
let onUnauthorized = null;
let onPasswordChangeRequired = null;

export function setToken(t) { token = t; }
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }
// Fires on a 403 carrying code: 'PASSWORD_CHANGE_REQUIRED' — the backend's
// real, server-enforced gate on an account still holding a temporary
// password (see middleware/auth.js's requireAuth). AppContext normally
// avoids ever hitting this by checking the same flag before loading
// anything else after login/boot, but this is the defense-in-depth path if
// some other call ever reaches the API first.
export function setPasswordChangeRequiredHandler(fn) { onPasswordChangeRequired = fn; }

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    if (res.status === 403 && data.code === 'PASSWORD_CHANGE_REQUIRED' && onPasswordChangeRequired) onPasswordChangeRequired();
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}
