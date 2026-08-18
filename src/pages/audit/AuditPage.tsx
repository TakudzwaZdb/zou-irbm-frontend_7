import { useState } from "react";
import { Search } from "lucide-react";
import { useAuditLog } from "@/hooks/useAudit";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import type { AuditEntry } from "@/types/audit";

const ACTION_VARIANT: Record<string, "default" | "info" | "success" | "danger" | "warning"> = {
  submitted: "info", approved: "success", rejected: "danger", returned: "danger",
  edited: "warning", overridden: "default", created: "success", "logged in": "default",
};

export default function AuditPage() {
  const { data: entries = [], isLoading } = useAuditLog();
  const [actionFilter, setActionFilter] = useState("all");
  const [query, setQuery] = useState("");

  const filtered = entries
    .filter((e) => actionFilter === "all" || e.action === actionFilter)
    .filter((e) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return e.record.toLowerCase().includes(q) || e.user.toLowerCase().includes(q) || e.module.toLowerCase().includes(q);
    });

  const columns: Column<AuditEntry>[] = [
    { key: "record", header: "Record affected", sortValue: (e) => e.record, render: (e) => <span className="font-medium text-slate-800 dark:text-slate-200">{e.record}</span> },
    { key: "action", header: "Action", render: (e) => <Badge variant={ACTION_VARIANT[e.action]} className="capitalize">{e.action}</Badge> },
    { key: "module", header: "Module", render: (e) => <span className="text-xs text-slate-500">{e.module}</span> },
    { key: "change", header: "Previous → new", render: (e) => (
      <span className="text-xs text-slate-500">{e.previousValue ?? "—"} → <span className="font-medium text-slate-700 dark:text-slate-300">{e.newValue ?? "—"}</span></span>
    ) },
    { key: "user", header: "User", render: (e) => <div><p className="text-slate-700 dark:text-slate-300">{e.user}</p><p className="text-[11px] text-slate-400">{e.role}</p></div> },
    { key: "timestamp", header: "Date / time", sortValue: (e) => e.timestamp, render: (e) => <span className="text-xs text-slate-400">{e.timestamp}</span> },
    { key: "device", header: "Device", render: (e) => <span className="text-[11px] text-slate-400">{e.device}</span> },
    { key: "reason", header: "Reason / comment", render: (e) => <span className="text-xs text-slate-400">{e.reason ?? "—"}</span> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Reporting", "Audit trail"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Audit trail</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every submit, approve, reject, edit and override — with actor, timestamp and old/new values</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex w-64 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <Search size={13} className="shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search record, user, or module…"
            className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All actions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="returned">Returned</SelectItem>
            <SelectItem value="edited">Edited</SelectItem>
            <SelectItem value="overridden">Overridden</SelectItem>
            <SelectItem value="created">Created</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} rows={filtered} pageSize={10} loading={isLoading} />
    </div>
  );
}
