import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export function StatCard({ label, value, sub, accent, icon }: { label: string; value: string | number; sub?: string; accent?: string; icon?: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900", accent && `border-l-4 ${accent}`)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-medium text-slate-900 dark:text-slate-100">{value}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
          {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
        </div>
        {icon && <div className="text-slate-300">{icon}</div>}
      </div>
    </div>
  );
}
