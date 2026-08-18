import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useProgrammes } from "@/hooks/useProgrammes";
import { useKpis } from "@/hooks/useKpis";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { TableSkeleton } from "@/components/shared/Skeleton";

export default function ProgrammesPage() {
  const { data: programmes = [], isLoading } = useProgrammes();
  const { data: kpis = [] } = useKpis();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={["Structure", "Programmes"]} />
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Programmes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">ZOU's three Programme pillars, cascading into Sub-programmes, Units and KPIs</p>
      </div>

      {isLoading ? <TableSkeleton /> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {programmes.map((p) => {
            const pKpis = kpis.filter((k) => k.programmeId === p.id);
            const onTrack = pKpis.filter((k) => k.status === "on-track").length;
            return (
              <Link key={p.id} to={`/programmes/${p.id}`} className="rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-indigo-300">
                <p className="text-xs font-medium text-indigo-600">{p.code}</p>
                <p className="mt-1 text-sm font-medium text-slate-900">{p.name}</p>
                <p className="mt-1 text-xs text-slate-400">{p.description}</p>
                <p className="mt-1 text-xs text-slate-400">Head: {p.head}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-slate-500">{pKpis.length} KPIs · {onTrack} on track</span>
                  <ChevronRight size={15} className="text-slate-300" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
