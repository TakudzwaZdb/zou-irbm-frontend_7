import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

const SECTIONS = [
  {
    id: 'performance-status',
    title: 'KPI status thresholds',
    shortTitle: 'KPI status',
    hint: 'Set the percentage of target a KPI must reach to be classified as green or amber. Results below amber are red.',
    fields: [
      {
        key: 'ragGreen',
        label: 'Green threshold',
        description: 'Minimum achievement required for a KPI to be on track.',
        unit: '% of target',
        fallback: 80,
      },
      {
        key: 'ragAmber',
        label: 'Amber threshold',
        description: 'Minimum achievement required for a KPI to be at risk rather than off track.',
        unit: '% of target',
        fallback: 50,
      },
    ],
  },
  {
    id: 'submission-deadlines',
    title: 'Submission deadlines',
    shortTitle: 'Deadlines',
    hint: 'Set how long each reporting tier has to submit after the reporting month ends.',
    fields: [
      {
        key: 'lateCutoffEmployee',
        label: 'Employee submission deadline',
        description: 'Days after month-end before an Employee submission is considered late.',
        unit: 'days',
        fallback: 3,
      },
      {
        key: 'lateCutoffUnit',
        label: 'Unit submission deadline',
        description: 'Days after month-end before a Unit submission is considered late.',
        unit: 'days',
        fallback: 5,
      },
      {
        key: 'lateCutoffSub',
        label: 'Sub-programme submission deadline',
        description: 'Days after month-end before a Sub-programme submission is considered late.',
        unit: 'days',
        fallback: 7,
      },
    ],
  },
  {
    id: 'late-escalations',
    title: 'Late submission escalations',
    shortTitle: 'Late escalations',
    hint: 'Choose when overdue submissions are escalated to senior leadership.',
    fields: [
      {
        key: 'escalateProgramme',
        label: 'Escalate to Programme Head',
        description: 'Trigger an escalation after a Sub-programme has been late for this many days.',
        unit: 'days late',
        fallback: 6,
      },
      {
        key: 'escalateVC',
        label: 'Escalate to VC / Council',
        description: 'Trigger a senior escalation after a submission has been late for this many days.',
        unit: 'days late',
        fallback: 11,
      },
    ],
  },
  {
    id: 'red-kpi-escalations',
    title: 'Red KPI escalations',
    shortTitle: 'Red KPIs',
    hint: 'Set how many consecutive red reporting periods trigger an escalation.',
    fields: [
      {
        key: 'redEscalateProgramme',
        label: 'Escalate to Programme Head',
        description: 'Trigger an escalation after this many consecutive red periods.',
        unit: 'periods',
        fallback: 2,
      },
      {
        key: 'redEscalateVC',
        label: 'Escalate to VC / Council',
        description: 'Trigger a senior escalation after this many consecutive red periods.',
        unit: 'periods',
        fallback: 4,
      },
    ],
  },
  {
    id: 'submission-window',
    title: 'KPI submission window',
    shortTitle: 'Submission window',
    hint: 'Control when KPI figures may be submitted for review each month.',
    fields: [
      {
        key: 'submissionOpenDay',
        label: 'Window opens',
        description: 'Calendar day of the reporting month when the submission window opens.',
        unit: 'day of month',
        fallback: 25,
        dayOfMonth: true,
      },
      {
        key: 'submissionCloseDay',
        label: 'Window closes',
        description: 'Calendar day of the following month when the submission window closes.',
        unit: 'next-month day',
        fallback: 3,
        dayOfMonth: true,
      },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((section) => section.fields);

function isValidValue(field, value) {
  if (value === '' || !Number.isFinite(Number(value))) return false;
  if (!field.dayOfMonth) return true;
  return Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31;
}

export default function Settings() {
  const { settings, setSettings } = useApp();
  const toast = useToast();
  const [form, setForm] = useState(() => Object.fromEntries(
    ALL_FIELDS.map((field) => [field.key, settings[field.key] ?? field.fallback])
  ));
  const [busy, setBusy] = useState(null);
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  const filteredSections = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return SECTIONS;

    return SECTIONS.map((section) => {
      const sectionMatches = `${section.title} ${section.hint}`.toLowerCase().includes(term);
      const fields = section.fields.filter((field) => (
        `${field.label} ${field.description} ${field.key} ${field.unit}`.toLowerCase().includes(term)
      ));

      if (sectionMatches) return section;
      return fields.length ? { ...section, fields } : null;
    }).filter(Boolean);
  }, [search]);

  const pendingCount = ALL_FIELDS.filter((field) => (
    Number(form[field.key]) !== Number(settings[field.key] ?? field.fallback)
  )).length;
  const resultCount = filteredSections.reduce((total, section) => total + section.fields.length, 0);

  function navigateToSection(section) {
    setActiveSection(section.id);
    document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveSetting(field) {
    if (!isValidValue(field, form[field.key])) {
      toast(
        field.dayOfMonth
          ? 'Enter a whole day between 1 and 31.'
          : 'Enter a valid number.',
        'err'
      );
      return;
    }

    setBusy(field.key);
    try {
      const response = await api('/settings', {
        method: 'PATCH',
        body: { [field.key]: Number(form[field.key]) },
      });
      setSettings(response.settings);
      toast(`${field.label} saved.`);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-accent-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-accent-700">
            Administration
          </span>
          <span className="text-[12px] text-ink-muted">System-wide configuration</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-extrabold">Settings</h1>
            <p className="max-w-2xl text-[14px] leading-relaxed text-ink-secondary">
              Configure KPI performance thresholds, submission timing, and escalation rules.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface px-4 py-2.5 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Configuration</div>
            <div className="mt-0.5 text-[14px] font-bold text-ink">
              {SECTIONS.length} categories <span className="mx-1 text-ink-muted">·</span> {ALL_FIELDS.length} settings
            </div>
          </div>
        </div>
      </header>

      <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4">
        <label className="relative min-w-[220px] flex-1 sm:max-w-xl">
          <span className="sr-only">Search settings</span>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearch('');
            }}
            placeholder="Search thresholds, deadlines, or a setting name"
            className="field-input pl-10 pr-10"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </label>
        <div className="flex items-center gap-2 text-[12px] text-ink-secondary" aria-live="polite">
          {pendingCount > 0 ? (
            <>
              <span className="h-2 w-2 rounded-full bg-warning" />
              {pendingCount} unsaved {pendingCount === 1 ? 'change' : 'changes'}
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-good" />
              All changes saved
            </>
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="card p-3 lg:sticky lg:top-4">
          <div className="mb-2 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-muted">
            Settings categories
          </div>
          <nav aria-label="Settings categories" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {filteredSections.map((section) => {
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => navigateToSection(section)}
                  aria-current={active ? 'location' : undefined}
                  className={`flex flex-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors lg:w-full ${
                    active
                      ? 'bg-accent-50 text-accent-700'
                      : 'text-ink-secondary hover:bg-sunken hover:text-ink'
                  }`}
                >
                  <span>{section.shortTitle}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? 'bg-white/70 text-accent-700' : 'bg-sunken text-ink-muted'}`}>
                    {section.fields.length}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="mt-4 hidden border-t border-line px-2 pt-3 text-[11px] leading-relaxed text-ink-muted lg:block">
            Changes take effect immediately and are recorded in the audit log.
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          {filteredSections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="card scroll-mt-4 overflow-hidden p-0"
            >
              <div className="flex items-start gap-3 border-b border-line px-4 py-4 sm:px-5">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent-50 text-[12px] font-extrabold text-accent-700">
                  {String(SECTIONS.findIndex((item) => item.id === section.id) + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 id={`${section.id}-title`} className="text-[16px] font-bold text-ink">
                      {section.title}
                    </h2>
                    <span className="rounded-full bg-sunken px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                      {section.fields.length} {section.fields.length === 1 ? 'setting' : 'settings'}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
                    {section.hint}
                  </p>
                </div>
              </div>

              <div className="divide-y divide-line px-4 sm:px-5">
                {section.fields.map((field) => {
                  const changed = Number(form[field.key]) !== Number(settings[field.key] ?? field.fallback);
                  const valid = isValidValue(field, form[field.key]);
                  const saving = busy === field.key;

                  return (
                    <form
                      key={field.key}
                      className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,285px)] sm:items-center"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveSetting(field);
                      }}
                    >
                      <div className="min-w-0">
                        <label htmlFor={field.key} className="text-[13px] font-bold text-ink">
                          {field.label}
                        </label>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
                          {field.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="relative min-w-0 flex-1">
                          <input
                            id={field.key}
                            type="number"
                            min={field.dayOfMonth ? 1 : undefined}
                            max={field.dayOfMonth ? 31 : undefined}
                            step={field.dayOfMonth ? 1 : 'any'}
                            value={form[field.key]}
                            onChange={(event) => setForm((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))}
                            aria-describedby={`${field.key}-unit`}
                            className="field-input pr-24 text-right font-semibold tabular-nums"
                          />
                          <span id={`${field.key}-unit`} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-ink-muted">
                            {field.unit}
                          </span>
                        </div>
                        <button
                          type="submit"
                          disabled={busy !== null || !changed || !valid}
                          className="btn btn-primary min-w-[82px] justify-center"
                        >
                          {saving ? 'Saving…' : changed ? 'Save' : 'Saved'}
                        </button>
                      </div>

                      {!valid && (
                        <p className="text-[11px] font-medium text-critical sm:col-start-2">
                          {field.dayOfMonth ? 'Enter a whole day from 1 to 31.' : 'Enter a valid number.'}
                        </p>
                      )}
                    </form>
                  );
                })}
              </div>
            </section>
          ))}

          {filteredSections.length === 0 && (
            <div className="card flex flex-col items-center px-5 py-12 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-xl text-ink-muted" aria-hidden="true">
                ?
              </span>
              <h2 className="text-[16px] font-bold">No matching settings</h2>
              <p className="mt-1 max-w-sm text-[13px] text-ink-secondary">
                No results for “{search}”. Try another term or clear your search.
              </p>
              <button type="button" className="btn mt-4" onClick={() => setSearch('')}>
                Clear search
              </button>
            </div>
          )}

          {search && filteredSections.length > 0 && (
            <p className="px-1 text-[11px] text-ink-muted" aria-live="polite">
              Showing {resultCount} matching {resultCount === 1 ? 'setting' : 'settings'}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
