import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

const SECTIONS = [
  {
    title: 'RAG thresholds',
    hint: 'Percent of target a KPI must reach to count as on track (green) or at risk (amber); below amber is off track (red).',
    fields: [
      { key: 'ragGreen', label: 'Green threshold (% of target)', fallback: 80 },
      { key: 'ragAmber', label: 'Amber threshold (% of target)', fallback: 50 },
    ],
  },
  {
    title: 'Late-submission cut-offs',
    hint: 'How many days after month-end each tier has to submit before it counts as late.',
    fields: [
      { key: 'lateCutoffIndividual', label: 'Individual (days)', fallback: 3 },
      { key: 'lateCutoffUnit', label: 'Unit (days)', fallback: 5 },
      { key: 'lateCutoffSub', label: 'Sub-programme (days)', fallback: 7 },
    ],
  },
  {
    title: 'Late-submission escalation triggers',
    hint: 'Once a Sub-programme is this many days late, it escalates up the org hierarchy — see Compliance & Escalations.',
    fields: [
      { key: 'escalateProgramme', label: 'Escalate to Programme Head after (days late)', fallback: 6 },
      { key: 'escalateVC', label: 'Escalate to VC / Council after (days late)', fallback: 11 },
    ],
  },
  {
    title: 'Red-KPI performance escalation triggers',
    hint: 'Separate from lateness — a KPI submitted on time but behind target for this many consecutive periods escalates the same way.',
    fields: [
      { key: 'redEscalateProgramme', label: 'Escalate to Programme Head after (consecutive Red periods)', fallback: 2 },
      { key: 'redEscalateVC', label: 'Escalate to VC / Council after (consecutive Red periods)', fallback: 4 },
    ],
  },
];
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);

export default function Settings() {
  const { settings, setSettings } = useApp();
  const toast = useToast();
  const [form, setForm] = useState(() => {
    const f = {};
    ALL_FIELDS.forEach((field) => { f[field.key] = settings[field.key] ?? field.fallback; });
    return f;
  });
  const [busy, setBusy] = useState(null);

  async function submit(e, keys, label) {
    e.preventDefault();
    setBusy(label);
    try {
      const body = {};
      keys.forEach((k) => { body[k] = Number(form[k]); });
      const r = await api('/settings', { method: 'PATCH', body });
      setSettings(r.settings);
      toast(`${label} saved.`);
    } catch (err) { toast(err.message, 'err'); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Settings</h1>
        <p className="text-[13px] text-ink-secondary">RAG thresholds, late-submission cut-offs, and escalation triggers used across the system.</p>
      </div>
      <div className="space-y-4 max-w-lg">
        {SECTIONS.map((section) => (
          <form key={section.title} onSubmit={(e) => submit(e, section.fields.map((f) => f.key), section.title)} className="card space-y-3">
            <div>
              <h2 className="font-display font-bold text-[14px] mb-0.5">{section.title}</h2>
              <p className="text-[11.8px] text-ink-secondary">{section.hint}</p>
            </div>
            {section.fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <label className="field-label">{field.label}</label>
                <input type="number" className="field-input" value={form[field.key]}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))} />
              </div>
            ))}
            <button className="btn btn-primary btn-sm" disabled={busy === section.title}>Save {section.title.toLowerCase()}</button>
          </form>
        ))}
      </div>
    </div>
  );
}
