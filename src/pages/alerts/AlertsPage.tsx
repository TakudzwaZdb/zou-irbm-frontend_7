import { AlertTriangle, Info, AlertCircle, Check, Mail, MailX, ArrowUpCircle } from "lucide-react";
import { useAlerts, useAcknowledgeAlert } from "@/hooks/useAlerts";
import { currentEscalationStep, hasAutoEscalated } from "@/utils/escalation";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

const ICONS = { info: Info, warning: AlertTriangle, critical: AlertCircle };
const STYLE = {
  info: { border: "border-indigo-400", bg: "bg-indigo-50", text: "text-indigo-700" },
  warning: { border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-700" },
  critical: { border: "border-rose-400", bg: "bg-rose-50", text: "text-rose-700" },
};

export default function AlertsPage() {
  const { data: alerts = [] } = useAlerts();
  const acknowledge = useAcknowledgeAlert();

  const unread = alerts.filter((a) => !a.acknowledged);
  const read = alerts.filter((a) => a.acknowledged);

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={["Reporting", "Alerts & escalation"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Alerts &amp; escalation</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Escalation follows the org hierarchy — Unit Head → Sub-programme Head → Programme Head → Vice-Chancellor — and climbs automatically the longer an alert sits unacknowledged</p>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-slate-900">Active ({unread.length})</p>
        {unread.length === 0 ? <EmptyState title="No active alerts" /> : (
          <div className="space-y-2">
            {unread.map((a) => {
              const s = STYLE[a.level];
              const Icon = ICONS[a.level];
              const liveStep = currentEscalationStep(a);
              const escalated = hasAutoEscalated(a);
              return (
                <div key={a.id} className={`flex items-start justify-between gap-3 rounded-xl border-l-4 ${s.border} border border-slate-200 ${s.bg} p-4`}>
                  <div className="flex gap-3">
                    <Icon size={16} className={`mt-0.5 shrink-0 ${s.text}`} />
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{a.kpiName}</p>
                      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{a.message}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span>{a.subProgramme}</span><span>·</span>
                        <span>Escalated to {liveStep}</span>
                        {escalated && <Badge variant="danger"><ArrowUpCircle size={10} /> Auto-escalated</Badge>}
                        <span>·</span>
                        <span>{a.createdAt}</span>
                        {a.emailSent ? (
                          <Badge variant="info"><Mail size={10} /> Email sent</Badge>
                        ) : (
                          <Badge variant="default"><MailX size={10} /> Not sent</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => acknowledge.mutate(a.id)} className="shrink-0"><Check size={12} /> Acknowledge</Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {read.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-medium text-slate-900">Acknowledged ({read.length})</p>
          <div className="space-y-2 opacity-60">
            {read.map((a) => (
              <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{a.kpiName}</p>
                <p className="mt-0.5 text-xs text-slate-500">{a.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
