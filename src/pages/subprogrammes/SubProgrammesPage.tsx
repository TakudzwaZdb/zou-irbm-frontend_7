import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useSubProgrammes } from "@/hooks/useSubProgrammes";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useKpis } from "@/hooks/useKpis";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { TableSkeleton } from "@/components/shared/Skeleton";

export default function SubProgrammesPage() {
  const { data: subs = [], isLoading } = useSubProgrammes();
  const { data: programmes = [] } = useProgrammes();
  const { data: kpis = [] } = useKpis();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={["Structure", "Sub-programmes"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Sub-programmes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Sub-programmes across all three Programmes</p>
      </div>

      {isLoading ? <TableSkeleton /> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {subs.map((s) => {
            const programme = programmes.find((p) => p.id === s.programmeId);
            const sKpis = kpis.filter((k) => k.subProgrammeId === s.id);
            return (
              <Link key={s.id} to={`/sub-programmes/${s.id}`} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300">
                <p className="text-xs text-indigo-600">{programme?.name}</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{s.name}</p>
                <p className="mt-1 text-xs text-slate-400">Head: {s.head}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500">{sKpis.length} KPIs</span>
                  <ChevronRight size={14} className="text-slate-300" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
