
import { Fragment, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';

const SECTIONS = [
  {
    title: 'RAG thresholds',
    hint: 'Percent of target a KPI must reach to count as on track (green) or at risk (amber); below amber is off track (red).',
    fields: [
      {
        key: 'ragGreen',
        label: 'Green threshold (% of target)',
        fallback: 80,
      },
      {
        key: 'ragAmber',
        label: 'Amber threshold (% of target)',
        fallback: 50,
      },
    ],
  },
  {
    title: 'Late-submission cut-offs',
    hint: 'How many days after month-end each tier has to submit before it counts as late.',
    fields: [
      {
        key: 'lateCutoffIndividual',
        label: 'Individual (days)',
        fallback: 3,
      },
      {
        key: 'lateCutoffUnit',
        label: 'Unit (days)',
        fallback: 5,
      },
      {
        key: 'lateCutoffSub',
        label: 'Sub-programme (days)',
        fallback: 7,
      },
    ],
  },
  {
    title: 'Late-submission escalation triggers',
    hint: 'Once a Sub-programme is this many days late, it escalates up the org hierarchy.',
    fields: [
      {
        key: 'escalateProgramme',
        label: 'Escalate to Programme Head after (days late)',
        fallback: 6,
      },
      {
        key: 'escalateVC',
        label: 'Escalate to VC / Council after (days late)',
        fallback: 11,
      },
    ],
  },
  {
    title: 'Red-KPI performance escalation triggers',
    hint: 'A KPI submitted on time but behind target for this many consecutive periods escalates the same way.',
    fields: [
      {
        key: 'redEscalateProgramme',
        label: 'Escalate to Programme Head after (consecutive Red periods)',
        fallback: 2,
      },
      {
        key: 'redEscalateVC',
        label: 'Escalate to VC / Council after (consecutive Red periods)',
        fallback: 4,
      },
    ],
  },
  {
    title: 'Submission window',
    hint: 'Controls when KPI figures may be submitted for review.',
    fields: [
      {
        key: 'submissionOpenDay',
        label: 'Opens on day (of the reporting month)',
        fallback: 25,
      },
      {
        key: 'submissionCloseDay',
        label: 'Closes on day (of the following month)',
        fallback: 3,
      },
    ],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((section) => section.fields);

export default function Settings() {
  const { settings, setSettings } = useApp();
  const toast = useToast();

  /* --------------------------------
     FORM STATE
  -------------------------------- */
  const [form, setForm] = useState(() => {
    const initialForm = {};

    ALL_FIELDS.forEach((field) => {
      initialForm[field.key] =
        settings[field.key] ?? field.fallback;
    });

    return initialForm;
  });

  /* --------------------------------
     SAVE STATE
  -------------------------------- */
  const [busy, setBusy] = useState(null);

  /* --------------------------------
     SEARCH STATE
  -------------------------------- */
  const [search, setSearch] = useState('');

  /* --------------------------------
     COLLAPSIBLE SECTION STATE
  -------------------------------- */
  const [openSections, setOpenSections] = useState({});

  function toggleSection(title) {
    setOpenSections((current) => ({
      ...current,
      [title]: !current[title],
    }));
  }

  /* --------------------------------
     FILTER SETTINGS
  -------------------------------- */
  const filteredSections = useMemo(() => {
    const term = search.trim().toLowerCase();

    /* No search = show all sections */
    if (!term) {
      return SECTIONS;
    }

    return SECTIONS
      .map((section) => {
        const sectionMatches =
          section.title.toLowerCase().includes(term) ||
          section.hint.toLowerCase().includes(term);

        const matchingFields = section.fields.filter(
          (field) =>
            field.label.toLowerCase().includes(term) ||
            field.key.toLowerCase().includes(term)
        );

        /*
         * If the section name or description matches,
         * show the entire section.
         */
        if (sectionMatches) {
          return section;
        }

        /*
         * Otherwise show only matching settings.
         */
        if (matchingFields.length > 0) {
          return {
            ...section,
            fields: matchingFields,
          };
        }

        return null;
      })
      .filter(Boolean);
  }, [search]);

  /* --------------------------------
     SAVE INDIVIDUAL SETTING
  -------------------------------- */
  async function saveSetting(key, sectionTitle) {
    setBusy(key);

    try {
      const body = {
        [key]: Number(form[key]),
      };

      const response = await api('/settings', {
        method: 'PATCH',
        body,
      });

      setSettings(response.settings);

      toast(`${sectionTitle} setting saved.`);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>

      {/* =========================================
          PAGE HEADER
      ========================================== */}
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">
          Settings
        </h1>

        <p className="text-[13px] text-ink-secondary">
          RAG thresholds, late-submission cut-offs, and
          escalation triggers used across the system.
        </p>
      </div>

      {/* =========================================
          SEARCH FILTER
      ========================================== */}
      <div className="card mb-4 p-4">
        <div className="relative">

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings..."
            className="field-input w-full pl-10 pr-10"
          />

          {/* Search icon */}
          <span
            className="
              absolute
              left-3
              top-1/2
              -translate-y-1/2
              text-ink-secondary
              pointer-events-none
            "
          >
            🔍
          </span>

          {/* Clear search */}
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="
                absolute
                right-3
                top-1/2
                -translate-y-1/2
                text-ink-secondary
                hover:text-ink
              "
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Search status */}
        {search && (
          <div className="text-[12px] text-ink-secondary mt-2">
            Showing results for:
            <span className="font-semibold ml-1">
              "{search}"
            </span>
          </div>
        )}
      </div>

      {/* =========================================
          SETTINGS TABLE
      ========================================== */}
      <div className="card overflow-hidden">

        <div className="overflow-x-auto">

          <table className="w-full text-sm">

            {/* =====================================
                TABLE HEADER
            ====================================== */}
            <thead>
              <tr className="border-b border-border bg-surface-muted">

                {/* SETTING COLUMN */}
                <th
                  className="
                    text-left
                    px-4
                    py-3
                    font-black
                    text-sky-600
                  "
                >
                  Setting
                </th>

                {/* DESCRIPTION COLUMN */}
                <th
                  className="
                    text-left
                    px-4
                    py-3
                    font-semibold
                  "
                >
                  Description
                </th>

                {/* VALUE COLUMN */}
                <th
                  className="
                    text-left
                    px-4
                    py-3
                    font-semibold
                    w-40
                  "
                >
                  Value
                </th>

                {/* ACTION COLUMN */}
                <th
                  className="
                    text-right
                    px-4
                    py-3
                    font-semibold
                    w-28
                  "
                >
                  Action
                </th>

              </tr>
            </thead>

            {/* =====================================
                TABLE BODY
            ====================================== */}
            <tbody>

              {filteredSections.map((section) => {

                /*
                 * During search, automatically expand
                 * matching sections.
                 */
                const isOpen =
                  search.trim().length > 0
                    ? true
                    : Boolean(
                        openSections[section.title]
                      );

                return (
                  <Fragment key={section.title}>

                    {/* =================================
                        COLLAPSIBLE SECTION HEADER
                    ================================== */}
                    <tr
                      className="
                        bg-gray-50
                        border-b
                        border-border
                        cursor-pointer
                        hover:bg-gray-100
                        select-none
                      "
                      onClick={() =>
                        toggleSection(section.title)
                      }
                    >
                      <td
                        colSpan={4}
                        className="px-4 py-3"
                      >

                        <div
                          className="
                            flex
                            items-center
                            justify-between
                            gap-4
                          "
                        >

                          {/* Section information */}
                          <div>

                            <div
                              className="
                                flex
                                items-center
                                gap-2
                              "
                            >

                              {/* Arrow */}
                              <span
                                className={`
                                  inline-flex
                                  text-[10px]
                                  transition-transform
                                  duration-200
                                  ${
                                    isOpen
                                      ? 'rotate-90'
                                      : ''
                                  }
                                `}
                              >
                                ▶
                              </span>

                              {/* Section title */}
                              <span
                                className="
                                  font-black
                                  text-[14px]
                                "
                              >
                                {section.title}
                              </span>

                            </div>

                            {/* Section description */}
                            <div
                              className="
                                text-[11.8px]
                                text-ink-secondary
                                mt-1
                                ml-5
                              "
                            >
                              {section.hint}
                            </div>

                          </div>

                          {/* Number of settings */}
                          <span
                            className="
                              text-[11px]
                              px-2
                              py-1
                              rounded-full
                              bg-gray-200
                              text-ink-secondary
                              whitespace-nowrap
                            "
                          >
                            {section.fields.length}{' '}
                            {section.fields.length === 1
                              ? 'setting'
                              : 'settings'}
                          </span>

                        </div>

                      </td>
                    </tr>

                    {/* =================================
                        SETTINGS
                    ================================== */}
                    {isOpen &&
                      section.fields.map((field) => (
                        <tr
                          key={field.key}
                          className="
                            border-b
                            border-border
                            hover:bg-gray-50
                          "
                        >

                          {/* ===========================
                              SETTING NAME
                          ============================ */}
                          <td className="px-4 py-3">

                            <span
                              className="
                                font-black
                                text-sky-600
                              "
                            >
                              {field.label}
                            </span>

                          </td>

                          {/* ===========================
                              DESCRIPTION
                          ============================ */}
                          <td
                            className="
                              px-4
                              py-3
                              text-[12px]
                              text-ink-secondary
                            "
                          >
                            {section.hint}
                          </td>

                          {/* ===========================
                              VALUE
                          ============================ */}
                          <td className="px-4 py-3">

                            <input
                              type="number"
                              className="
                                field-input
                                w-full
                              "
                              value={form[field.key]}
                              onChange={(e) =>
                                setForm((current) => ({
                                  ...current,
                                  [field.key]:
                                    e.target.value,
                                }))
                              }
                            />

                          </td>

                          {/* ===========================
                              ACTION
                          ============================ */}
                          <td
                            className="
                              px-4
                              py-3
                              text-right
                            "
                          >

                            <button
                              type="button"
                              className="
                                btn
                                btn-primary
                                btn-sm
                              "
                              disabled={
                                busy === field.key
                              }
                              onClick={(e) => {
                                /*
                                 * Prevent the Save button
                                 * from collapsing the section.
                                 */
                                e.stopPropagation();

                                saveSetting(
                                  field.key,
                                  section.title
                                );
                              }}
                            >
                              {busy === field.key
                                ? 'Saving...'
                                : 'Save'}
                            </button>

                          </td>

                        </tr>
                      ))}

                  </Fragment>
                );
              })}

              {/* =====================================
                  NO RESULTS
              ====================================== */}
              {filteredSections.length === 0 && (
                <tr>

                  <td
                    colSpan={4}
                    className="
                      px-4
                      py-10
                      text-center
                    "
                  >

                    <div
                      className="
                        text-sm
                        font-semibold
                      "
                    >
                      No settings found
                    </div>

                    <div
                      className="
                        text-[12px]
                        text-ink-secondary
                        mt-1
                      "
                    >
                      Try a different search term.
                    </div>

                  </td>

                </tr>
              )}

            </tbody>

          </table>

        </div>

      </div>

    </div>
  );
}
