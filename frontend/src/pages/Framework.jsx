import { useApp } from '../context/AppContext.jsx';
import { employeePosition, headPosition } from '../lib/orgDisplay.js';

// Read-only org chart. KPI and organisational-structure changes are managed
// from their dedicated pages, while this page remains visible to every
// signed-in account regardless of role or management permissions.
export default function Framework() {
  const { org, hasPerm } = useApp();
  const canManageAnything = hasPerm('create_kpi') || hasPerm('edit_targets') || hasPerm('manage_org_units') || hasPerm('add_employee');

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-0.5">Framework</h1>
        <p className="text-[13px] text-ink-secondary">Organisational structure and KPI catalogue — read-only.</p>
      </div>

      {canManageAnything && (
        <div className="mb-4 rounded-lg bg-accent-50 text-accent-600 text-[12.3px] px-3.5 py-2.5">
          Looking to make a change? KPIs are created/edited/removed from <b>KPI Management</b>, and Programmes/
          Sub-programmes/Units/Employees/roles are all managed from <b>Organisation Maintenance</b> — see the sidebar.
        </div>
      )}

      <OrgTree org={org} />
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
            <div><b>{p.name}</b> {headPosition(p) && <span className="text-ink-muted text-[12px]">Head: {headPosition(p)}</span>}</div>
            {subs.map((s) => {
              const units = org.units.filter((u) => u.sub_id === s.id);
              return (
                <div key={s.id} className="pl-2 mt-1.5 text-[12.8px]">
                  ◆ <b>{s.name}</b> {headPosition(s) && <span className="text-ink-muted">(Head: {headPosition(s)})</span>}
                  {units.map((u) => {
                    const inds = org.employees.filter((i) => i.unit_id === u.id);
                    return (
                      <div key={u.id} className="pl-5 mt-1 text-[12.8px]">
                        ▸ <b>{u.name}</b> <span className="text-ink-muted">({u.kind}{headPosition(u) ? ` · Head: ${headPosition(u)}` : ''})</span>
                        {inds.map((i) => (
                          <div key={i.id} className="pl-8 text-ink-muted text-[12px]">
                            • {employeePosition(i)}
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
