import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

// Read-only org chart + the structural-change proposal log. Every
// creation/edit/deletion action that used to live here — KPIs, Programmes/
// Sub-programmes/Units, and Individuals/roles — now has its own dedicated
// admin page (see KpiManagement.jsx, OrgStructure.jsx),
// reached from the sidebar for whoever holds the relevant permission. This
// page stays what its own nav entry has always promised everyone: the org
// chart they're part of, visible to every signed-in account regardless of
// role or permissions to manage anything in it.
export default function Framework() {
  const { org, hasPerm } = useApp();
  const canManageAnything = hasPerm('create_kpi') || hasPerm('edit_targets') || hasPerm('manage_org_units') || hasPerm('add_individual');
  const canPropose = hasPerm('manage_framework');

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Framework</h1>
        <p className="text-[13px] text-ink-secondary">Organisational structure and KPI catalogue — read-only.</p>
      </div>

      {canManageAnything && (
        <div className="mb-4 rounded-lg bg-accent-50 text-accent-600 text-[12.3px] px-3.5 py-2.5">
          Looking to make a change? KPIs are created/edited/removed from <b>KPI Management</b>, and Programmes/
          Sub-programmes/Units/Individuals/roles are all managed from <b>Organisation Maintenance</b> — see the sidebar.
        </div>
      )}

      <OrgTree org={org} />
      <ProposalsSection canPropose={canPropose} />
    </div>
  );
}

// A real, persisted queue of structural-change proposals — distinct from
// the direct unit/KPI creation on the dedicated admin pages, which takes
// effect immediately. Nothing currently auto-actions an entry here (no
// approval workflow is wired to it); it's a durable record for CPU/exec to
// review, e.g. "split this Sub-programme into two" ahead of a planning
// checkpoint.
function ProposalsSection({ canPropose }) {
  const toast = useToast();
  const [proposals, setProposals] = useState(null);
  const [scope, setScope] = useState('sub');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const r = await api('/org/proposals'); setProposals(r.proposals); } catch (_) { setProposals([]); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api('/org/proposals', { method: 'POST', body: { scope, text: text.trim() } });
      toast('Proposal recorded.');
      setText('');
      await load();
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-6">
      <h2 className="font-display font-bold text-[14.5px] mb-2.5">Propose a structural change</h2>
      {canPropose ? (
        <form onSubmit={submit} className="rounded-xl bg-sunken border border-line p-4 mb-3 space-y-3">
          <Field label="Scope">
            <select className="field-input" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="sub">Sub-programme / Unit-level (ZOU's own checkpoint)</option>
              <option value="programme">Programme-level (needs Ministry / PM&amp;E sign-off)</option>
            </select>
          </Field>
          <Field label="Proposal">
            <textarea rows={2} required className="field-input" placeholder="e.g. Split Innovation & Enterprises into two Sub-programmes"
              value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-sm" disabled={busy}>Record proposal</button>
        </form>
      ) : (
        <div className="card text-[12.5px] text-ink-muted mb-3">Only users granted the "Propose structural changes" permission can submit a proposal here.</div>
      )}
      {proposals?.length > 0 && (
        <div className="space-y-2">
          {proposals.map((p) => (
            <div key={p.id} className="card flex items-start gap-2.5 flex-wrap">
              <span className={`chip ${p.scope === 'programme' ? 'chip-rag-red' : 'chip-rag-green'}`}>
                {p.scope === 'programme' ? 'Programme-level — routed to Ministry/PM&E' : 'Sub-programme/Unit-level — ZOU checkpoint'}
              </span>
              <span className="flex-1 text-[12.6px]">{p.text}</span>
              <span className="text-[11px] text-ink-muted whitespace-nowrap">{p.created_by_name || 'System'} · {p.created_at}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrgTree({ org }) {
  return (
    <div className="space-y-3 mb-3">
      {org.programmes.map((p) => {
        const subs = org.subs.filter((s) => s.programme_id === p.id);
        return (
          <div key={p.id} className="card">
            <div><b>{p.name}</b> <span className="text-ink-muted text-[12px]">Head: {p.head}</span></div>
            {subs.map((s) => {
              const units = org.units.filter((u) => u.sub_id === s.id);
              return (
                <div key={s.id} className="pl-2 mt-1.5 text-[12.8px]">
                  ◆ <b>{s.name}</b> <span className="text-ink-muted">(Head: {s.head})</span>
                  {units.map((u) => {
                    const inds = org.individuals.filter((i) => i.unit_id === u.id);
                    return (
                      <div key={u.id} className="pl-5 mt-1 text-[12.8px]">
                        ▸ <b>{u.name}</b> <span className="text-ink-muted">({u.kind} · Head: {u.head})</span>
                        {inds.map((i) => (
                          <div key={i.id} className="pl-8 text-ink-muted text-[12px]">
                            • {i.name} — {i.role_title || ''}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1 min-w-[160px] flex-1">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
