import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../lib/api.js';

// The real, server-enforced stop between "signed in with a temporary
// password" and "using the app" (see SECURITY_REVIEW.md's finding #1 / db.js's
// must_change_password migration). Rendered by App.jsx in place of Layout
// whenever user.must_change_password is set — a new Unit Head/Individual
// account just provisioned, or any account an ICT admin just reset — and
// there's no way around it from here: every other API route 403s until this
// actually succeeds (see middleware/auth.js's requireAuth), this screen just
// makes that visible instead of the app quietly failing to load.
export default function ForcedPasswordChange() {
  const { user, completePasswordChange, logout } = useApp();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) { setError("New password and confirmation don't match."); return; }
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPassword === currentPassword) { setError('Choose a new password different from the temporary one.'); return; }
    setBusy(true);
    try {
      const r = await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      await completePasswordChange(r);
    } catch (err) {
      setError(err.message || 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-[radial-gradient(circle_at_20%_15%,#eaf2fc,transparent_45%)] bg-sunken">
      <div className="w-full max-w-[440px] rounded-2xl border border-line bg-surface shadow-lg p-8 pb-6">
        <img src="/assets/zou-logo.png" alt="Zimbabwe Open University" className="w-full h-auto max-h-14 object-contain mb-7" />

        <h1 className="text-xl font-bold mb-1.5">Choose a new password</h1>
        <p className="text-[12.8px] text-ink-secondary leading-relaxed mb-5">
          {user?.name ? `Welcome, ${user.name}. ` : ''}Your account is still on a temporary password. Set your own
          before continuing — this only takes a moment.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-critical-soft text-critical text-[12.8px] px-3.5 py-2.5">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-3.5">
          <div className="space-y-1">
            <label htmlFor="fc-current" className="field-label">Temporary password</label>
            <input
              id="fc-current" type="password" required autoComplete="current-password" placeholder="••••••••"
              className="field-input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="fc-new" className="field-label">New password</label>
            <input
              id="fc-new" type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters"
              className="field-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="fc-confirm" className="field-label">Confirm new password</label>
            <input
              id="fc-confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••"
              className="field-input" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2.5 text-[13.5px]">
            {busy ? 'Setting password…' : 'Set password and continue'}
          </button>
        </form>

        <button type="button" onClick={logout} className="mt-4 text-[11.8px] text-ink-muted hover:text-ink-secondary underline underline-offset-2">
          Not you? Sign in as someone else
        </button>
      </div>
    </div>
  );
}
