import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { avatarClass, initialsOf } from '../lib/scope.js';
import PhotoLightbox from '../components/PhotoLightbox.jsx';

const ROLE_LABEL = {
  exec: 'Executive', cpu: 'Corporate Planning Unit', ictadmin: 'ICT Systems Administrator',
  rep: 'Sub-programme Rep', unithead: 'Unit Head', individual: 'Individual', programme: 'Programme Head',
};

// Resizes/compresses an image client-side before it ever reaches the
// network — a real transform (an actual canvas draw + JPEG re-encode), not
// a cosmetic progress bar — so a multi-megabyte phone photo becomes a small
// square thumbnail well under the backend's upload cap.
function resizeImageFile(file, maxSize = 320, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Self-service account settings, open to every role: your profile photo and
// your own password. Name/title/email stay admin-managed (see Users.jsx) —
// this page shows them read-only with a pointer to ICT admin for changes.
export default function Profile() {
  const { user, refreshUser } = useApp();
  const toast = useToast();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState(false);

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please choose an image file.', 'err'); return; }
    setUploading(true);
    try {
      const dataUrl = await resizeImageFile(file);
      await api('/auth/me/avatar', { method: 'PUT', body: { avatarDataUrl: dataUrl } });
      toast('Profile photo updated.');
      await refreshUser();
    } catch (err) { toast(err.message, 'err'); }
    finally { setUploading(false); }
  }

  async function removePhoto() {
    if (!window.confirm('Remove your profile photo?')) return;
    setUploading(true);
    try {
      await api('/auth/me/avatar', { method: 'DELETE' });
      toast('Profile photo removed.');
      await refreshUser();
    } catch (err) { toast(err.message, 'err'); }
    finally { setUploading(false); }
  }

  return (
    <div className="max-w-xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">My Profile</h1>
        <p className="text-[13px] text-ink-secondary">Your photo, password, and two-factor authentication. Everyone can update these for their own account.</p>
      </div>

      <div className="card mb-5">
        <h2 className="font-display font-bold text-[14.5px] mb-3">Profile photo</h2>
        <div className="flex items-center gap-4 flex-wrap">
          {user.avatar ? (
            <button
              type="button"
              onClick={() => setViewingPhoto(true)}
              className="w-16 h-16 rounded-full flex-none cursor-zoom-in ring-offset-2 ring-offset-surface hover:ring-2 hover:ring-accent-500/50 transition-shadow"
              title="View photo"
            >
              <img src={user.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
            </button>
          ) : (
            <span className={`w-16 h-16 rounded-full flex items-center justify-center text-[20px] font-bold flex-none ${avatarClass(user.id)}`}>
              {initialsOf(user.name)}
            </span>
          )}
          <div className="flex gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
            <button className="btn btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Uploading…' : user.avatar ? 'Change photo' : 'Upload photo'}
            </button>
            {user.avatar && <button className="btn btn-sm btn-danger" disabled={uploading} onClick={removePhoto}>Remove photo</button>}
          </div>
        </div>
      </div>

      <div className="card mb-5">
        <h2 className="font-display font-bold text-[14.5px] mb-3">Profile details</h2>
        <dl className="text-[13px] space-y-1.5">
          <Row label="Full name" value={user.name} />
          <Row label="Title" value={user.title || '—'} />
          <Row label="Email" value={user.email} />
          <Row label="Role" value={ROLE_LABEL[user.role] || user.role} />
        </dl>
        <p className="text-[11.5px] text-ink-muted mt-3">
          Ask an ICT Systems Administrator to correct your name, title, or email — they manage those from Permissions.
        </p>
      </div>

      <ChangePasswordCard />
      <MfaCard />
      <SignOutEverywhereCard />

      {viewingPhoto && <PhotoLightbox src={user.avatar} name={user.name} onClose={() => setViewingPhoto(false)} />}
    </div>
  );
}

// Real session revocation for an otherwise-stateless token (see
// SECURITY_REVIEW.md's finding #6 / routes/auth.js's /logout-everywhere) —
// the actual answer to "I think I left myself signed in somewhere" or "my
// laptop was stolen", not just changing the password for next time.
function SignOutEverywhereCard() {
  const { logoutEverywhere } = useApp();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try { await logoutEverywhere(); }
    finally { setBusy(false); }
  }

  return (
    <div className="card mt-5">
      <h2 className="font-display font-bold text-[14.5px] mb-1">Sign out everywhere</h2>
      <p className="text-[11.8px] text-ink-secondary mb-3">
        Left yourself signed in on a shared or lost device? This immediately ends every session for your account,
        including this one — you'll need to sign in again right after.
      </p>
      <button className="btn btn-sm btn-danger" disabled={busy} onClick={go}>
        {busy ? 'Signing out…' : 'Sign out of every session'}
      </button>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted w-20 flex-none">{label}</dt>
      <dd className="font-semibold text-ink truncate">{value}</dd>
    </div>
  );
}

function ChangePasswordCard() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (newPassword !== confirm) { toast('New password and confirmation don\'t match.', 'err'); return; }
    if (newPassword.length < 8) { toast('New password must be at least 8 characters.', 'err'); return; }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      toast('Password changed.');
      setCurrentPassword(''); setNewPassword(''); setConfirm('');
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2 className="font-display font-bold text-[14.5px] mb-1">Change password</h2>
      <p className="text-[11.8px] text-ink-secondary mb-3">
        Forgotten your password entirely? You'll need an ICT Systems Administrator to reset it for you from the
        Permissions page — there's no email/SMS delivery behind this system to send a reset link to.
      </p>
      <form onSubmit={submit} className="space-y-3 max-w-sm">
        <div className="space-y-1">
          <label className="field-label">Current password</label>
          <input type="password" required autoComplete="current-password" className="field-input"
            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="field-label">New password</label>
          <input type="password" required minLength={8} autoComplete="new-password" className="field-input"
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="field-label">Confirm new password</label>
          <input type="password" required minLength={8} autoComplete="new-password" className="field-input"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button className="btn btn-sm btn-primary" disabled={busy}>Change password</button>
      </form>
    </div>
  );
}

// Real, self-contained TOTP-based two-factor authentication (see
// backend/src/utils/totp.js — RFC 6238, the same algorithm every
// authenticator app already speaks) — entirely opt-in per account, never
// forced. Three states: off (just an Enable button), mid-enrollment
// (secret shown for the person to add to their app, waiting on one real
// code back to confirm they captured it correctly), and on (Disable,
// gated behind the current password same as everywhere else in this app).
function MfaCard() {
  const { user, refreshUser } = useApp();
  const toast = useToast();
  const [enrolling, setEnrolling] = useState(null); // { secret, otpauthUrl } while mid-setup
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null); // shown exactly once, right after enabling
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setBusy(true);
    try {
      const r = await api('/auth/mfa/setup', { method: 'POST' });
      setEnrolling(r);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  async function confirmEnroll(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/auth/mfa/enable', { method: 'POST', body: { code: code.trim() } });
      setRecoveryCodes(r.recoveryCodes);
      setEnrolling(null);
      setCode('');
      await refreshUser();
      toast('Two-factor authentication enabled.');
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  async function disable(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/auth/mfa/disable', { method: 'POST', body: { password: disablePassword } });
      setDisablePassword(''); setShowDisable(false);
      await refreshUser();
      toast('Two-factor authentication disabled.');
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  // The one-time reveal of the ten recovery codes — shown right after
  // enabling, never retrievable again afterward (only their bcrypt hashes
  // are ever stored — see db.js's mfa_recovery_codes), same as a generated
  // temporary password elsewhere in this app.
  if (recoveryCodes) {
    return (
      <div className="card mt-5 border-2 border-warning/30">
        <h2 className="font-display font-bold text-[14.5px] mb-1">Save your recovery codes</h2>
        <p className="text-[11.8px] text-ink-secondary mb-3">
          Each code works once, if you ever lose access to your authenticator app. This is the only time they'll be shown —
          save them somewhere safe now.
        </p>
        <div className="grid grid-cols-2 gap-1.5 mb-3 font-mono text-[12.5px]">
          {recoveryCodes.map((c) => <div key={c} className="bg-sunken rounded px-2 py-1 text-center">{c}</div>)}
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => setRecoveryCodes(null)}>I've saved these codes</button>
      </div>
    );
  }

  if (enrolling) {
    return (
      <div className="card mt-5">
        <h2 className="font-display font-bold text-[14.5px] mb-1">Set up two-factor authentication</h2>
        <p className="text-[11.8px] text-ink-secondary mb-3">
          Add this account to your authenticator app (Google Authenticator, Authy, 1Password, etc.) by entering the key below
          manually, then confirm with the 6-digit code it generates.
        </p>
        <div className="bg-sunken rounded-lg px-3 py-2.5 mb-3">
          <p className="text-[10.5px] text-ink-muted uppercase font-semibold tracking-wide mb-1">Secret key</p>
          <p className="font-mono text-[13px] tracking-wider break-all">{enrolling.secret}</p>
        </div>
        <form onSubmit={confirmEnroll} className="space-y-3 max-w-xs">
          <div className="space-y-1">
            <label className="field-label">6-digit code from your app</label>
            <input type="text" required inputMode="numeric" pattern="\d{6}" maxLength={6} className="field-input tracking-widest text-center"
              value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary" disabled={busy}>Confirm &amp; enable</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setEnrolling(null); setCode(''); }}>Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="card mt-5">
      <h2 className="font-display font-bold text-[14.5px] mb-1">Two-factor authentication</h2>
      {user.mfa_enabled ? (
        <>
          <p className="text-[11.8px] text-ink-secondary mb-3">
            <span className="chip chip-st-approved mr-1.5">On</span>
            Your account requires a code from your authenticator app (or a recovery code) every time you sign in.
          </p>
          {!showDisable ? (
            <button className="btn btn-sm btn-danger" onClick={() => setShowDisable(true)}>Disable two-factor authentication</button>
          ) : (
            <form onSubmit={disable} className="space-y-3 max-w-xs">
              <div className="space-y-1">
                <label className="field-label">Confirm your current password</label>
                <input type="password" required autoComplete="current-password" className="field-input"
                  value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-sm btn-danger" disabled={busy}>Disable</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setShowDisable(false); setDisablePassword(''); }}>Cancel</button>
              </div>
            </form>
          )}
          <p className="text-[11.5px] text-ink-muted mt-3">
            Lost your device and your recovery codes? An ICT Systems Administrator can reset this for your account from Permissions.
          </p>
        </>
      ) : (
        <>
          <p className="text-[11.8px] text-ink-secondary mb-3">
            <span className="chip chip-tag mr-1.5">Off</span>
            Add a second step to signing in — a 6-digit code from an authenticator app on your phone, on top of your password.
          </p>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={startEnroll}>Enable two-factor authentication</button>
        </>
      )}
    </div>
  );
}
