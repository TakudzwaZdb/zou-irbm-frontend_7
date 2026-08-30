import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

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
  const { login, loginError } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    await login(email.trim(), password);
    setBusy(false);
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-[radial-gradient(circle_at_20%_15%,#eaf2fc,transparent_45%)] bg-sunken">
      <div className="w-full max-w-[440px] rounded-2xl border border-line bg-surface shadow-lg p-8 pb-6">
        <img src="/assets/zou-logo.png" alt="Zimbabwe Open University" className="w-full h-auto max-h-14 object-contain mb-7" />

        <h1 className="text-xl font-bold mb-1.5">Sign in</h1>
        <p className="text-[12.8px] text-ink-secondary leading-relaxed mb-5">
          Strategic Plan Monitor · IRBM Monitoring &amp; Evaluation. Enter your ZOU email address and password.
        </p>

        {loginError && (
          <div className="mb-4 rounded-lg bg-critical-soft text-critical text-[12.8px] px-3.5 py-2.5">{loginError}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <label htmlFor="li-email" className="field-label">Email address</label>
            <input
              id="li-email" type="email" required autoComplete="username" placeholder="name@zou.ac.zw"
              className="field-input" value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="li-pass" className="field-label">Password</label>
            <input
              id="li-pass" type="password" required autoComplete="current-password" placeholder="••••••••"
              className="field-input" value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2.5 text-[13.5px]">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <details className="mt-5 pt-4 border-t border-line text-[11.5px] text-ink-secondary leading-relaxed">
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
