import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { avatarClass, initialsOf, ROLE_LABEL } from '../lib/scope.js';
import { playTone } from '../lib/sound.js';
import { readDraft, writeDraft, clearDraft } from '../lib/autosave.js';

// WhatsApp-style delivery/read marker for a sent message — real state, not
// decorative: every recipient row here is backed by an actual
// message_recipients.read_at timestamp from the backend (see
// routes/messages.js), never simulated. Delivery itself isn't a separate
// tracked state in this system (a send is a synchronous DB insert into
// every recipient's inbox, so there's nothing that can be "sent but not yet
// delivered") — so the double tick always means delivered, and its color is
// the only thing that changes: gray until read, accent once it is.
function Ticks({ read, title }) {
  return (
    <span
      className={`inline-block text-[13px] leading-none tracking-[-3px] flex-none ${read ? 'text-accent-500' : 'text-ink-muted'}`}
      title={title || (read ? 'Read' : 'Delivered — not yet read')}
    >✓✓</span>
  );
}

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Real internal messaging — genuinely reaches across every tier (see
// backend/src/routes/messages.js: no scope restriction on who you can
// write to, only real recipient accounts and real read/unread state).
// This is the actual, working "email system" for a deployment with no
// outbound SMTP configured — same reasoning as the admin-assisted password
// reset elsewhere in this app.
export default function Messages() {
  const { reloadUnread } = useApp();
  const toast = useToast();
  const [box, setBox] = useState('inbox');
  const [messages, setMessages] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [composing, setComposing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function load(which) {
    try {
      const r = await api(`/messages?box=${which}`);
      setMessages(r.messages);
    } catch (err) { toast(err.message, 'err'); }
  }
  useEffect(() => { setMessages(null); setOpenId(null); load(box); }, [box]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deletes only THIS caller's own copy (see routes/messages.js) — from
  // their Inbox it never touches the sender's Sent, or anyone else's Inbox;
  // from their Sent it never pulls the message out of any recipient's
  // Inbox. The other side sees no change either way.
  async function remove(m) {
    if (!window.confirm(box === 'inbox' ? `Delete this message from your inbox?` : `Delete this message from Sent? Recipients still keep their own copy.`)) return;
    setBusyId(m.id);
    try {
      await api(`/messages/${m.id}`, { method: 'DELETE' });
      setMessages((list) => list.filter((x) => x.id !== m.id));
      if (openId === m.id) setOpenId(null);
      if (box === 'inbox') await reloadUnread();
      toast('Message deleted.');
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusyId(null); }
  }

  async function open(m) {
    setOpenId(openId === m.id ? null : m.id);
    if (box === 'inbox' && !m.read_at) {
      try {
        await api(`/messages/${m.id}/read`, { method: 'POST' });
        setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, read_at: new Date().toISOString() } : x)));
        await reloadUnread();
      } catch (_) { /* non-critical */ }
    }
  }

  const unreadInInbox = useMemo(() => (box === 'inbox' ? (messages || []).filter((m) => !m.read_at).length : 0), [box, messages]);

  return (
    <div>
      <div className="flex justify-between gap-4 flex-wrap items-start mb-5">
        <div>
          <h1 className="text-xl font-bold mb-0.5">Messages</h1>
          <p className="text-[13px] text-ink-secondary max-w-[62ch]">
            Real internal messaging, open across every tier — write directly to anyone in the system, whatever
            their role or where they sit in the org structure.
          </p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => setComposing(true)}>✎ Compose</button>
      </div>

      <div className="flex gap-1.5 mb-4">
        <button
          className={`btn btn-sm ${box === 'inbox' ? 'btn-primary' : ''}`}
          onClick={() => setBox('inbox')}
        >
          Inbox{unreadInInbox > 0 ? ` (${unreadInInbox})` : ''}
        </button>
        <button className={`btn btn-sm ${box === 'sent' ? 'btn-primary' : ''}`} onClick={() => setBox('sent')}>Sent</button>
      </div>

      {!messages && <div className="text-ink-muted text-[13px]">Loading…</div>}
      {messages && messages.length === 0 && (
        <div className="card text-center text-ink-muted py-8">
          {box === 'inbox' ? "Nothing in your inbox yet." : "You haven't sent anything yet."}
        </div>
      )}

      {(messages || []).map((m) => {
        const isOpen = openId === m.id;
        const unread = box === 'inbox' && !m.read_at;
        const allRead = box === 'sent' && (m.recipients || []).length > 0 && m.recipients.every((r) => r.read);
        return (
          <div key={m.id} className={`rounded-xl border px-3.5 py-2.5 mb-2 ${unread ? 'border-accent-500/30 bg-accent-50/40' : 'border-line bg-surface'}`}>
            <button className="w-full text-left flex items-center gap-2.5" onClick={() => open(m)}>
              {box === 'inbox' ? (
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-none ${avatarClass(m.sender_id)}`}>
                  {initialsOf(m.sender_name)}
                </span>
              ) : (
                <span className="w-7 h-7 rounded-full bg-sunken flex items-center justify-center text-[13px] flex-none">→</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[12.8px] truncate ${unread ? 'font-bold' : 'font-semibold'}`}>
                    {box === 'inbox' ? m.sender_name : (m.recipients || []).map((r) => r.name).join(', ') || '—'}
                  </span>
                  {box === 'inbox' && <span className="chip chip-tag">{ROLE_LABEL[m.sender_role] || m.sender_role}</span>}
                  {unread && <span className="w-1.5 h-1.5 rounded-full bg-accent-500 flex-none" />}
                </div>
                <div className={`text-[12.5px] truncate ${unread ? 'font-semibold' : ''}`}>{m.subject}</div>
              </div>
              {box === 'sent' && (
                <Ticks read={allRead} title={allRead ? 'Read by all recipients' : 'Delivered — not yet read by everyone'} />
              )}
              <span className="text-[11px] text-ink-muted flex-none">{fmtWhen(m.sent_at)}</span>
            </button>
            {isOpen && (
              <div className="mt-2.5 pt-2.5 border-t border-line text-[12.8px] leading-relaxed whitespace-pre-wrap">
                {m.body}
                {box === 'sent' && (m.recipients || []).length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-line text-[11.5px] text-ink-muted flex flex-wrap gap-x-3 gap-y-1 items-center">
                    <span className="flex-none">To:</span>
                    {m.recipients.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1.5">
                        {r.name}
                        <Ticks read={r.read} />
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2.5 pt-2.5 border-t border-line flex justify-end">
                  <button className="btn btn-sm btn-danger" disabled={busyId === m.id} onClick={() => remove(m)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {composing && (
        <ComposeModal
          onClose={() => setComposing(false)}
          onSent={() => { setComposing(false); if (box === 'sent') load('sent'); toast('Message sent.'); }}
        />
      )}
    </div>
  );
}

function ComposeModal({ onClose, onSent }) {
  const { user } = useApp();
  const toast = useToast();
  const [directory, setDirectory] = useState(null);
  const [q, setQ] = useState('');
  const searchRef = useRef(null);

  // Escape closes it (the same expectation PhotoLightbox's own dialog
  // sets), and focus moves to the recipient search the moment it opens so
  // a keyboard/screen-reader user lands inside the dialog immediately
  // rather than staying on whatever "New message" button they just pressed.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    searchRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Same local-only safety net as KPI data entry (see lib/autosave.js) —
  // composing a message can easily run to a few paragraphs, exactly the
  // kind of typing a power cut or a crashed tab shouldn't be able to erase.
  // One slot per user (only one compose window is ever open at a time), so
  // it's read once on mount and restored if it disagrees with the blank
  // form a fresh compose otherwise starts from.
  const draftKey = `u${user.id}-compose`;
  const savedDraft = (() => {
    const raw = readDraft(draftKey);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  })();
  const hasSavedDraft = !!(savedDraft && (savedDraft.subject || savedDraft.body || (savedDraft.selected || []).length));

  const [selected, setSelected] = useState(savedDraft?.selected || []);
  const [subject, setSubject] = useState(savedDraft?.subject || '');
  const [body, setBody] = useState(savedDraft?.body || '');
  const [busy, setBusy] = useState(false);

  function persistDraft(next) {
    writeDraft(draftKey, JSON.stringify({ selected: next.selected ?? selected, subject: next.subject ?? subject, body: next.body ?? body }));
  }

  useEffect(() => {
    api('/messages/directory').then((r) => setDirectory(r.users)).catch((err) => toast(err.message, 'err'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!directory) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return directory;
    return directory.filter((u) => [u.name, u.email, u.title, u.role, ROLE_LABEL[u.role]].join(' ').toLowerCase().includes(needle));
  }, [directory, q]);

  function toggle(id) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    persistDraft({ selected: next });
  }
  function onSubjectChange(v) { setSubject(v); persistDraft({ subject: v }); }
  function onBodyChange(v) { setBody(v); persistDraft({ body: v }); }

  async function send() {
    setBusy(true);
    try {
      await api('/messages', { method: 'POST', body: { recipientIds: selected, subject: subject.trim(), body: body.trim() } });
      playTone('sent');
      clearDraft(draftKey);
      onSent();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label="New message">
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl bg-surface border border-line shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-none">
          <h2 className="font-display font-bold text-[14.5px]">New message</h2>
          <button className="text-ink-muted hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {hasSavedDraft && (
            <div className="rounded-lg bg-accent-50 text-accent-600 text-[11.5px] px-3 py-2">
              Restored an unsaved draft from before — it hadn't been sent yet.
            </div>
          )}
          <div className="space-y-1">
            <label className="field-label">To</label>
            <input ref={searchRef} className="field-input mb-1.5" placeholder="Search name, email, role…" aria-label="Search recipients" value={q} onChange={(e) => setQ(e.target.value)} />
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {selected.map((id) => {
                  const u = directory?.find((x) => x.id === id);
                  if (!u) return null;
                  return (
                    <button key={id} type="button" className="chip chip-tag cursor-pointer" onClick={() => toggle(id)} aria-label={`Remove ${u.name} from recipients`}>
                      {u.name} ✕
                    </button>
                  );
                })}
              </div>
            )}
            <div className="max-h-40 overflow-y-auto rounded-lg border border-line divide-y divide-line">
              {!directory && <div className="px-3 py-2 text-[12px] text-ink-muted">Loading…</div>}
              {directory && filtered.length === 0 && <div className="px-3 py-2 text-[12px] text-ink-muted">No matches.</div>}
              {filtered.map((u) => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-[12.3px] cursor-pointer hover:bg-sunken">
                  <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                  <span className="font-semibold">{u.name}</span>
                  <span className="text-ink-muted">· {ROLE_LABEL[u.role] || u.role}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="field-label">Subject</label>
            <input className="field-input" value={subject} onChange={(e) => onSubjectChange(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="field-label">Message</label>
            <textarea rows={6} className="field-input" value={body} onChange={(e) => onBodyChange(e.target.value)} />
          </div>
        </div>
        <div className="px-4 py-3 border-t border-line flex gap-2 justify-end flex-none">
          <button className="btn btn-sm" disabled={busy} onClick={onClose}>Cancel</button>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || selected.length === 0 || !subject.trim() || !body.trim()}
            onClick={send}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
