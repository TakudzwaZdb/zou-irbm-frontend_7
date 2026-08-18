import { useState } from "react";
import { useUnits } from "@/hooks/useUnits";
import { useSubProgrammes } from "@/hooks/useSubProgrammes";
import { useProgrammes } from "@/hooks/useProgrammes";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import type { OrgUnit } from "@/types/organisation";

export default function UnitsPage() {
  const [subFilter, setSubFilter] = useState("all");
  const { data: units = [], isLoading } = useUnits(subFilter === "all" ? undefined : subFilter);
  const { data: subs = [] } = useSubProgrammes();
  const { data: programmes = [] } = useProgrammes();

  const columns: Column<OrgUnit>[] = [
    { key: "name", header: "Unit", sortValue: (u) => u.name, render: (u) => <span className="font-medium text-slate-800">{u.name}</span> },
    { key: "type", header: "Type", render: (u) => <Badge>{u.type}</Badge> },
    { key: "subProgramme", header: "Sub-programme", render: (u) => subs.find((s) => s.id === u.subProgrammeId)?.name ?? "—" },
    { key: "programme", header: "Programme", render: (u) => {
      const sub = subs.find((s) => s.id === u.subProgrammeId);
      return programmes.find((p) => p.id === sub?.programmeId)?.name ?? "—";
    } },
    { key: "head", header: "Head", render: (u) => u.head },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={["Structure", "Organisational units"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Organisational units</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Faculties, Directorates, Regional Campuses and Departments within each Sub-programme</p>
      </div>

      <Select value={subFilter} onValueChange={setSubFilter}>
        <SelectTrigger className="w-56"><SelectValue placeholder="All sub-programmes" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sub-programmes</SelectItem>
          {subs.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <DataTable columns={columns} rows={units} pageSize={10} loading={isLoading} />
    </div>
  );
}
