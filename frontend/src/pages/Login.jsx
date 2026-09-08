import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';

const DEMO_ACCOUNTS = [
  { role: 'Vice Chancellor (Executive)', email: 'l.chareka@zou.ac.zw', note: 'Read-only reports view' },
  { role: 'Corporate Planning Unit (CPU)', email: 't.moyo@zou.ac.zw', note: 'Approves sub-programmes, manages org & KPIs' },
  { role: 'ICT Systems Administrator', email: 'l.chikomo@zou.ac.zw', note: 'Only role that can grant/revoke permissions' },
  { role: 'Programme Head', email: 's.chitiyo@zou.ac.zw', note: 'Oversees one Programme\'s Sub-programmes; approves their Annual Plans' },
  { role: 'Sub-programme Representative', email: 'b.gwatidzo@zou.ac.zw', note: 'Enters sub-owned KPIs, approves units below' },
  { role: 'Unit Head', email: 'f.rusike@zou.ac.zw', note: 'Enters unit-owned KPIs, approves individuals below' },
  { role: 'Individual Staff Member', email: 'n.moyana@zou.ac.zw', note: 'Enters their own KPI data only' },
];

export default function Login() {
  const { login, verifyMfa, loginError } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Set once /login comes back asking for a second factor (see
  // AppContext's login()) — swaps the form below for the code-entry step
  // instead of navigating anywhere, so a wrong/expired code just re-shows
  // this same screen rather than bouncing back to re-enter the password.
  const [mfaToken, setMfaToken] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    const r = await login(email.trim(), password);
    if (r?.mfaRequired) setMfaToken(r.mfaToken);
    setBusy(false);
  }

  if (mfaToken) {
    return <MfaStep mfaToken={mfaToken} loginError={loginError} onBack={() => setMfaToken(null)} verifyMfa={verifyMfa} />;
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-[radial-gradient(circle_at_20%_15%,#eaf2fc,transparent_45%)] bg-sunken">
      <div className="w-full max-w-[360px] rounded-2xl border border-line bg-surface shadow-lg p-5 pb-4">
        <img src="/assets/zou-logo.png" alt="Zimbabwe Open University" className="w-full h-auto max-h-9 object-contain mb-4" />

        <h1 className="text-[15.5px] font-bold mb-1">Sign in</h1>
        <p className="text-[11.5px] text-ink-secondary leading-relaxed mb-3.5">
          Strategic Plan Monitor · IRBM Monitoring &amp; Evaluation. Enter your ZOU email address and password.
        </p>

        {loginError && (
          <div className="mb-3 rounded-lg bg-critical-soft text-critical text-[11.8px] px-3 py-2">{loginError}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="space-y-0.5">
            <label htmlFor="li-email" className="field-label">Email address</label>
            <input
              id="li-email" type="email" required autoComplete="username" placeholder="name@zou.ac.zw"
              className="field-input" value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-0.5">
            <label htmlFor="li-pass" className="field-label">Password</label>
            <input
              id="li-pass" type="password" required autoComplete="current-password" placeholder="••••••••"
              className="field-input" value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2 text-[13px]">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <ForgotPassword />

        <details className="mt-3 pt-3 border-t border-line text-[11px] text-ink-secondary leading-relaxed">
          <summary className="cursor-pointer font-semibold text-ink-secondary select-none">
            Demo accounts for testing (one per access level)
          </summary>
          <div className="mt-2.5 space-y-2">
            {DEMO_ACCOUNTS.map((a) => (
              <div key={a.email} className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="font-semibold text-ink-secondary">{a.role}</div>
                  <div className="text-ink-secondary">{a.note}</div>
                </div>
                <code className="shrink-0 bg-sunken rounded px-1.5 py-0.5 text-[10.5px] text-ink-secondary">{a.email}</code>
              </div>
            ))}
            <div className="pt-1">Password for every account: <code className="bg-sunken rounded px-1.5 py-0.5 text-[10.5px] text-ink-secondary">Zou@2026</code></div>
          </div>
        </details>
      </div>
    </div>
  );
}

// The second step of signing in to an account that's opted into two-factor
// authentication (see Profile.jsx's MfaPanel for enrollment). Accepts
// either a real 6-digit authenticator code or one of the ten recovery
// codes issued at enrollment — the backend (POST /auth/mfa/verify) treats
// both the same way, so this is a single input either way.
function MfaStep({ mfaToken, loginError, onBack, verifyMfa }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    await verifyMfa(mfaToken, code.trim());
    setBusy(false);
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-[radial-gradient(circle_at_20%_15%,#eaf2fc,transparent_45%)] bg-sunken">
      <div className="w-full max-w-[360px] rounded-2xl border border-line bg-surface shadow-lg p-5 pb-4">
        <img src="/assets/zou-logo.png" alt="Zimbabwe Open University" className="w-full h-auto max-h-9 object-contain mb-4" />
        <h1 className="text-[15.5px] font-bold mb-1">Two-factor verification</h1>
        <p className="text-[11.5px] text-ink-secondary leading-relaxed mb-3.5">
          Enter the 6-digit code from your authenticator app, or one of your recovery codes if you've lost access to it.
        </p>

        {loginError && (
          <div className="mb-3 rounded-lg bg-critical-soft text-critical text-[11.8px] px-3 py-2">{loginError}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="space-y-0.5">
            <label htmlFor="li-mfa" className="field-label">Verification code</label>
            <input
              id="li-mfa" type="text" inputMode="text" required autoComplete="one-time-code" placeholder="123456 or XXXX-XXXX"
              className="field-input tracking-widest text-center" value={code} onChange={(e) => setCode(e.target.value)} autoFocus
            />
          </div>
          <button type="submit" disabled={busy || !code.trim()} className="btn btn-primary w-full justify-center py-2 text-[13px]">
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button type="button" onClick={onBack} className="btn w-full justify-center py-2 text-[12.5px]">
            Back to sign in
          </button>
        </form>
      </div>
    </div>
  );
}

// The real answer to "I forgot my password", not a fake "enter your email"
// form — this app has no email/SMS delivery behind it (see backend's
// GET /api/auth/ict-admins and routes/users.js's admin-assisted reset for
// the full reasoning), so pretending to send a reset link nobody receives
// would be worse than no form at all. Fetched fresh, lazily, only once
// this is actually opened — real current ICT admin accounts, never a
// hardcoded name that could go stale the day staff changes.
function ForgotPassword() {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState(null);

  async function onToggle(e) {
    if (!e.target.open || admins !== null) return;
    try {
      const r = await api('/auth/ict-admins');
      setAdmins(r.admins);
    } catch (err) {
      setError(err.message || 'Could not load contact details.');
    }
  }

  return (
    <details className="mt-3 text-[11.5px] text-ink-secondary leading-relaxed" onToggle={onToggle}>
      <summary className="cursor-pointer font-semibold text-accent-600 select-none">
        Forgot your password?
      </summary>
      <div className="mt-2 rounded-lg bg-sunken px-3 py-2.5 space-y-2">
        <p>
          There's no automatic reset link in this system — an ICT Systems Administrator resets it for you directly.
          Reach out to one of them:
        </p>
        {error && <p className="text-critical">{error}</p>}
        {admins === null && !error && <p className="text-ink-muted">Loading…</p>}
        {admins?.length === 0 && <p className="text-ink-muted">No ICT Systems Administrator account is set up yet.</p>}
        {admins && admins.length > 0 && (
          <ul className="space-y-1">
            {admins.map((a) => (
              <li key={a.email} className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-ink-secondary">{a.name}</span>
                <a href={`mailto:${a.email}`} className="shrink-0 text-accent-600 hover:underline">{a.email}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
