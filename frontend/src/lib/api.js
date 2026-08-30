// Thin fetch wrapper around the real backend REST API. Relative paths work
// both in dev (Vite proxies /api to the backend — see vite.config.js) and in
// production (Express serves this build and the API from the same origin).
let token = null;
let onUnauthorized = null;

export function setToken(t) { token = t; }
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

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
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
